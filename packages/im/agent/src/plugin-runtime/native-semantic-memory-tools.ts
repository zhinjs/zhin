import {
  parseMemoryTags,
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

export interface NativeSemanticMemoryToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Candidate-owned semantic-memory authority. It becomes ready during required DB activation. */
export class SemanticMemoryRuntime {
  #repository: MemoryEntryRepository | undefined;

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
    return result;
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
      approval: 'never',
      execute: (input, context) => searchMemory(runtime, input, context),
    })),
    feature('memory_upsert', defineAgentTool({
      description: 'Create or update one durable semantic-memory fact in an authorized scope.',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          key: Object.freeze({ type: 'string' }),
          content: Object.freeze({ type: 'string' }),
          scope: Object.freeze({ type: 'string', enum: Object.freeze(['global', 'platform', 'session', 'user']) }),
          tags: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }), maxItems: 20 }),
          source: Object.freeze({ type: 'string' }),
          confidence: Object.freeze({ type: 'number', minimum: 0, maximum: 1 }),
        }),
        required: Object.freeze(['key', 'content']),
      }),
      approval: 'on-risk',
      execute: (input, context) => upsertMemory(runtime, input, context),
    })),
  ]);
}

async function searchMemory(
  runtime: SemanticMemoryRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const query = requiredString(input.query, 'query');
  const scope = optionalScope(input.scope);
  const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 5;
  const hits = scope
    ? await runtime.search({
        query,
        scope,
        scope_key: scopeKey(scope, context),
        limit,
      }, context.signal)
    : await searchVisibleMemory(runtime, query, limit, context);
  if (hits.length === 0) return `未找到与 "${query}" 相关的记忆条目。`;
  return `找到 ${hits.length} 条记忆：\n${hits.map((entry) => {
    const tags = parseMemoryTags(entry.tags);
    return `- [${entry.scope}${entry.scope_key ? `:${entry.scope_key}` : ''}] ${entry.key}=${entry.content}`
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
  const scope = optionalScope(input.scope) ?? 'global';
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : undefined;
  const confidence = typeof input.confidence === 'number' ? input.confidence : 1;
  const record = await runtime.upsert({
    scope,
    scope_key: scopeKey(scope, context),
    key,
    content,
    tags,
    source: typeof input.source === 'string' ? input.source : 'tool:memory_upsert',
    confidence,
  }, context.signal);
  return `已写入记忆 ${record.id}: [${record.scope}] ${record.key}=${record.content}`;
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
