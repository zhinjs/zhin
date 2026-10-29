import {
  isMemoryEntryKind,
  MEMORY_ENTRY_KINDS,
  parseMemoryTags,
  type MemoryEntryKind,
  type MemoryEntryListInput,
  type MemoryEntryLocator,
  type MemoryEntryRecord,
  type MemoryEntryRepository,
  type MemoryEntryScope,
  type MemoryEntrySearchInput,
  type MemoryEntryUpsertInput,
} from '@zhin.js/ai';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  recallRelevantMemory,
  type RecallResult,
  type RecallTurnView,
  type SemanticRecallOptions,
} from '../memory/semantic-recall.js';
import { resolveTurnTrustLevel } from '../security/trust-level.js';
import { decideMemoryWrite, defaultMemoryScope, memoryExpiry } from '../memory/memory-write-policy.js';
import { rerankDecisionMatches, resolveSearchDecision, type NativeSearchDecisionResolver } from '../decision/retrieval.js';

export interface NativeSemanticMemoryToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export interface SemanticMemoryRuntimeOptions {
  /**
   * Whether the task a `task_state` entry is bound to still exists. When it
   * returns false the entry is hidden from recall (it also expires by TTL).
   * Without a resolver, bound task state lives until its TTL.
   */
  readonly isTaskActive?: (taskId: string) => boolean;
  /** Per-turn recall (#734); see `ai.memory.semantic.recall`. */
  readonly recall?: SemanticRecallOptions;
}

/** Candidate-owned semantic-memory authority. It becomes ready during required DB activation. */
export class SemanticMemoryRuntime {
  #repository: MemoryEntryRepository | undefined;
  readonly #options: SemanticMemoryRuntimeOptions;

  constructor(options: SemanticMemoryRuntimeOptions = {}) {
    this.#options = options;
  }

  activate(repository: MemoryEntryRepository): void {
    if (this.#repository) throw new Error('Semantic memory runtime is already active');
    this.#repository = repository;
  }

  dispose(): void {
    this.#repository = undefined;
  }

  async search(input: MemoryEntrySearchInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = await this.#requireRepository().search(input);
    signal.throwIfAborted();
    const isTaskActive = this.#options.isTaskActive;
    return isTaskActive
      ? result.filter((entry) => entry.kind !== 'task_state' || !entry.task_id || isTaskActive(entry.task_id))
      : result;
  }

  async find(locator: MemoryEntryLocator, signal: AbortSignal) {
    signal.throwIfAborted();
    return this.#requireRepository().find(locator);
  }

  /** Whether the database repository is active (recall is skipped otherwise). */
  get active(): boolean {
    return this.#repository !== undefined;
  }

  /**
   * BM25 top-k memory relevant to `query`, rendered within the recall budget.
   * Returns null when recall is off, the runtime is inactive, or nothing matches.
   */
  async recall(view: RecallTurnView, query: string, signal: AbortSignal): Promise<RecallResult | null> {
    if (!this.#repository) return null;
    const result = await recallRelevantMemory(this, view, query, signal, this.#options.recall);
    if (result) await this.markUsed(result.entries.map((entry) => entry.id));
    return result;
  }

  /** Live entries in one scope, newest first (management view). */
  async list(input: MemoryEntryListInput, signal: AbortSignal) {
    signal.throwIfAborted();
    return this.#requireRepository().list(input);
  }

  /** Deletes one entry; it is never recalled again. */
  async delete(id: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return this.#requireRepository().delete(id);
  }

  /** Best-effort recall bookkeeping; never fails the search that triggered it. */
  async markUsed(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.#requireRepository().markUsed(ids);
    } catch {
      // last_used_at is advisory.
    }
  }

  async upsert(input: MemoryEntryUpsertInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = await this.#requireRepository().upsert(input);
    signal.throwIfAborted();
    return result;
  }

  #requireRepository(): MemoryEntryRepository {
    if (!this.#repository) throw new Error('Semantic memory database is not active');
    return this.#repository;
  }
}

export function createNativeSemanticMemoryToolFeatures(
  runtime: SemanticMemoryRuntime,
  resolveDecision?: NativeSearchDecisionResolver,
): readonly NativeSemanticMemoryToolFeature[] {
  return Object.freeze([
    feature('memory_search', defineAgentTool({
      description: 'Search durable semantic memory visible to the current canonical session.',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          query: Object.freeze({ type: 'string' }),
          scope: Object.freeze({ type: 'string', enum: Object.freeze(['global', 'platform', 'session', 'user']) }),
          limit: Object.freeze({ type: 'number', minimum: 1, maximum: 20 }),
        }),
        required: Object.freeze(['query']),
      }),
      requiresApproval: 'never',
      readOnly: true,
      execute: (input, context) => searchMemory(runtime, input, context, resolveDecision),
    })),
    feature('memory_upsert', defineAgentTool({
      description: 'Create or update one durable semantic-memory entry in an authorized scope. '
        + 'kind: user_fact (stable fact), preference, task_state (temporary, expires), episodic (a past event).',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          key: Object.freeze({ type: 'string' }),
          content: Object.freeze({ type: 'string' }),
          scope: Object.freeze({ type: 'string', enum: Object.freeze(['global', 'platform', 'session', 'user']) }),
          kind: Object.freeze({ type: 'string', enum: MEMORY_ENTRY_KINDS }),
          tags: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }), maxItems: 20 }),
          confidence: Object.freeze({ type: 'number', minimum: 0, maximum: 1 }),
          task_id: Object.freeze({ type: 'string', description: 'Task a task_state entry belongs to.' }),
          ttl_hours: Object.freeze({ type: 'number', minimum: 0, description: 'Expiry; task_state defaults to 24h (max 168h).' }),
        }),
        required: Object.freeze(['key', 'content']),
      }),
      requiresApproval: 'on-risk',
      execute: (input, context) => upsertMemory(runtime, input, context),
    })),
  ]);
}

async function searchMemory(
  runtime: SemanticMemoryRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  resolveDecision?: NativeSearchDecisionResolver,
): Promise<string> {
  const query = requiredString(input.query, 'query');
  const scope = optionalScope(input.scope);
  const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 5;
  const decision = resolveSearchDecision(resolveDecision, context);
  const candidateLimit = decision ? 20 : limit;
  const candidates = scope
    ? await runtime.search({
        query,
        scope,
        scope_key: scopeKey(scope, context),
        limit: candidateLimit,
      }, context.signal)
    : await searchVisibleMemory(runtime, query, candidateLimit, context);
  const hits = await rerankDecisionMatches(decision, query, candidates,
    entry => `${entry.key}: ${entry.content}\nTags: ${parseMemoryTags(entry.tags).join(', ')}`, limit, context.signal);
  if (hits.length === 0) return `未找到与 "${query}" 相关的记忆条目。`;
  await runtime.markUsed(hits.map((entry) => entry.id));
  return `找到 ${hits.length} 条记忆：\n${hits.map((entry) => {
    const tags = parseMemoryTags(entry.tags);
    return `- [${entry.scope}${entry.scope_key ? `:${entry.scope_key}` : ''}] ${entry.key}=${entry.content}`
      + (entry.kind !== 'user_fact' ? ` (${entry.kind})` : '')
      + (tags.length ? ` (tags: ${tags.join(', ')})` : '');
  }).join('\n')}`;
}

async function searchVisibleMemory(
  runtime: SemanticMemoryRuntime,
  query: string,
  limit: number,
  context: ToolExecutionContext,
): Promise<MemoryEntryRecord[]> {
  const selectors: ReadonlyArray<readonly [MemoryEntryScope, string]> = [
    ['session', context.sessionKey],
    ['user', context.principal.subjectId],
    ...(context.origin.kind === 'im'
      ? [['platform', context.origin.platform] as const]
      : []),
    ['global', ''],
  ];
  const buckets = await Promise.all(selectors.map(([scope, scope_key]) => runtime.search({
    query,
    scope,
    scope_key,
    limit,
  }, context.signal)));

  // Preserve each repository query's relevance order while allowing every visible
  // scope to contribute before a single busy scope consumes the result budget.
  const seen = new Set<string>();
  const merged: MemoryEntryRecord[] = [];
  for (let index = 0; merged.length < limit; index += 1) {
    let found = false;
    for (const bucket of buckets) {
      const entry = bucket[index];
      if (!entry) continue;
      found = true;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
      if (merged.length === limit) break;
    }
    if (!found) break;
  }
  return merged;
}

async function upsertMemory(
  runtime: SemanticMemoryRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const key = requiredString(input.key, 'key');
  const content = requiredString(input.content, 'content');
  const level = resolveTurnTrustLevel(context);
  const scope = optionalScope(input.scope) ?? defaultMemoryScope(level);
  const kind = optionalKind(input.kind) ?? 'user_fact';
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : undefined;
  const confidence = typeof input.confidence === 'number' ? input.confidence : 1;
  const ttlHours = typeof input.ttl_hours === 'number' ? input.ttl_hours : undefined;
  const taskId = kind === 'task_state' && typeof input.task_id === 'string' ? input.task_id.trim() : '';
  const locator = { scope, scope_key: scopeKey(scope, context), key };

  const existing = await runtime.find(locator, context.signal);
  const decision = decideMemoryWrite({ level, scope, kind, existing });
  if (!decision.allowed) return `未写入记忆：${decision.reason}`;

  const expiresAt = memoryExpiry(kind, ttlHours, Date.now());
  const record = await runtime.upsert({
    ...locator,
    content,
    tags,
    kind,
    // Attribution comes from the turn, never from model input.
    source: `turn:${context.turnId}`,
    source_turn: context.turnId,
    trust_level: level,
    task_id: taskId,
    confidence,
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
  }, context.signal);
  const replaced = existing && existing.content !== record.content ? '（已覆盖旧值，旧版本保留在历史中）' : '';
  return `已写入记忆 ${record.id}: [${record.scope}] ${record.key}=${record.content}${replaced}`;
}

function scopeKey(scope: MemoryEntryScope, context: ToolExecutionContext): string {
  if (scope === 'global') return '';
  if (scope === 'session') return context.sessionKey;
  if (scope === 'user') return context.principal.subjectId;
  if (context.origin.kind !== 'im') {
    throw new Error('Platform-scoped semantic memory requires an IM turn origin');
  }
  return context.origin.platform;
}

function optionalScope(value: unknown): MemoryEntryScope | undefined {
  if (value === undefined) return undefined;
  if (value === 'global' || value === 'platform' || value === 'session' || value === 'user') return value;
  throw new TypeError('scope must be global, platform, session, or user');
}

function optionalKind(value: unknown): MemoryEntryKind | undefined {
  if (value === undefined) return undefined;
  if (isMemoryEntryKind(value)) return value;
  throw new TypeError(`kind must be one of ${MEMORY_ENTRY_KINDS.join(', ')}`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function feature(
  name: string,
  definition: AgentToolDefinition<Record<string, unknown>, string>,
): NativeSemanticMemoryToolFeature {
  return Object.freeze({ feature: toolFeatureId, name, definition: Object.freeze(definition) });
}
