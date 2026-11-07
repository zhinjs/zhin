import { createRootPrivateToken, encodeStorageIdentity, type DatabaseHost } from '@zhin.js/plugin-runtime';
import { createHash } from 'node:crypto';
import type { TurnEvent } from '../event/turn-event.js';
import type { TurnRequest } from '../turn/turn-ingress.js';
import { traceScopeTurnId } from '../trace/turn-trace-registry.js';

const text = { type: 'text', nullable: true } as const;
const count = { type: 'bigint', nullable: true } as const;
export const AGENT_USAGE_TURN_MODEL = {
  id: { type: 'text', length: 64, primary: true }, fingerprint: { type: 'text', length: 64, nullable: false },
  owner: text, trace_id: text, turn_id: text, session_key: text, principal_id: text,
  origin_kind: text, endpoint_adapter: text, endpoint_id: text, conversation_kind: text, conversation_id: text,
  parent_kind: text, parent_id: text, thread_id: text, source_id: text,
  selected_provider: text, selected_model: text, status: text,
  started_at: count, ended_at: count, duration_ms: count, call_count: count,
} as const;
export const AGENT_USAGE_CALL_MODEL = {
  id: { type: 'text', length: 64, primary: true }, root_id: { type: 'text', length: 64, nullable: false },
  turn_id: text, call_index: { type: 'integer', nullable: false }, provider: text, model: text, stop_reason: text,
  duration_ms: count, input_tokens: count, output_tokens: count, total_tokens: count,
  cache_read_tokens: count, cache_write_tokens: count, reasoning_tokens: count, ended_at: count, root_ended_at: count,
} as const;
export type UsageRow = Record<string, string | number | null>;
export interface AgentUsageRecord { readonly turn: UsageRow; readonly calls: readonly UsageRow[] }
export interface AgentUsageStore { save(record: AgentUsageRecord): Promise<void>; prune(): Promise<void> }
export const agentUsageStoreToken = createRootPrivateToken<AgentUsageStore>('zhin.agent.usage-store', 'Generation-owned structured usage persistence');

const tokenFields = {
  input_tokens: ['promptTokens', 'input'], output_tokens: ['completionTokens', 'output'], total_tokens: ['totalTokens', 'totalTokens'],
  cache_read_tokens: ['cacheReadTokens', 'cacheRead'], cache_write_tokens: ['cacheWriteTokens', 'cacheWrite'], reasoning_tokens: ['reasoningTokens', 'reasoning'],
} as const;
function nonnegative(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
const identity = (value: string | undefined) => value === undefined ? null : encodeStorageIdentity(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Minimal numeric facts, independent of log level and trace archive size limits. */
export class AgentUsageCollector {
  readonly #calls: UsageRow[] = [];
  readonly #indexes = new Map<string, number>();
  readonly #startedAt = Date.now();
  readonly #id: string;
  constructor(private readonly owner: string, private readonly request: TurnRequest,
    private readonly selected: { provider: string; model: string }) {
    this.#id = digest([owner, request.identity.turnId]);
  }
  record(event: TurnEvent): void {
    if (event.type !== 'usage') return;
    const turnId = traceScopeTurnId(event) ?? this.request.identity.turnId;
    const index = (this.#indexes.get(turnId) ?? 0) + 1;
    this.#indexes.set(turnId, index);
    const row: UsageRow = { id: digest([this.#id, turnId, index]), root_id: this.#id, turn_id: identity(turnId), call_index: index,
      provider: event.provider ?? null, model: event.model ?? null, stop_reason: event.stopReason ?? null,
      duration_ms: typeof event.durationMs === 'number' ? nonnegative(Math.round(event.durationMs)) : null, ended_at: Date.now() };
    for (const [column, [source, availability]] of Object.entries(tokenFields)) {
      const value = nonnegative(event.usage[source]);
      const reported = event.usage.reported?.[availability]
        ?? (availability === 'input' || availability === 'output' || availability === 'totalTokens' ? value !== null && value > 0 : value !== null);
      row[column] = reported ? value : null;
    }
    this.#calls.push(row);
  }
  finish(status: string): AgentUsageRecord {
    const endedAt = Date.now(), origin = this.request.origin, im = origin.kind === 'im' ? origin : undefined;
    const turn: UsageRow = { id: this.#id, owner: identity(this.owner), trace_id: identity(this.request.identity.traceId), turn_id: identity(this.request.identity.turnId),
      session_key: identity(this.request.session.key), principal_id: identity(this.request.principal.subjectId),
      origin_kind: origin.kind, endpoint_adapter: identity(im?.conversation?.endpoint.adapter ?? im?.platform), endpoint_id: identity(im?.conversation?.endpoint.id ?? im?.endpoint),
      conversation_kind: im?.conversation?.kind ?? im?.scope ?? null, conversation_id: identity(im?.conversation?.id ?? im?.sceneId), parent_kind: im?.conversation?.parent?.kind ?? null,
      parent_id: identity(im?.conversation?.parent?.id), thread_id: identity(im?.conversation?.threadId ?? im?.threadId),
      source_id: identity(origin.kind === 'schedule' ? origin.jobId : origin.kind === 'a2a' ? origin.taskId : origin.kind === 'http' ? origin.sessionId : origin.kind === 'internal' ? origin.source : undefined),
      selected_provider: this.selected.provider, selected_model: this.selected.model, status,
      started_at: this.#startedAt, ended_at: endedAt, duration_ms: endedAt - this.#startedAt, call_count: this.#calls.length,
    };
    const calls = this.#calls.map(row => ({ ...row, root_ended_at: endedAt }));
    turn.fingerprint = digest([turn, calls]);
    return { turn, calls };
  }
}

/** Tables contain no payload JSON, chat content, prompt, tool arguments or error text. */
export class DatabaseAgentUsageStore implements AgentUsageStore {
  constructor(private readonly database: DatabaseHost, readonly retentionDays = 30, private readonly now = Date.now) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) throw new TypeError('ai.usage.retentionDays must be a positive integer');
    if (!database.transaction) throw new Error('Agent usage requires transactional database storage');
  }
  async save(record: AgentUsageRecord): Promise<void> {
    try {
      await this.database.transaction!(async transaction => {
        const turns = transaction.model('agent_usage_turns');
        const existing = (await turns.select('fingerprint').where({ id: record.turn.id }))[0];
        if (existing) {
          if (existing.fingerprint !== record.turn.fingerprint) throw new Error('Conflicting usage record for the same turn');
          return;
        }
        await turns.insert(record.turn);
        for (const call of record.calls) await transaction.model('agent_usage_calls').insert(call);
      });
    } catch (error) {
      // A concurrent writer may have committed the same complete record.
      const existing = (await this.database.models.get('agent_usage_turns')!.select('fingerprint').where({ id: record.turn.id }).limit(1))[0];
      if (existing?.fingerprint === record.turn.fingerprint) return;
      throw error;
    }
  }
  async prune(): Promise<void> {
    const cutoff = this.now() - this.retentionDays * 86_400_000;
    await this.database.transaction!(async transaction => {
      await transaction.model('agent_usage_calls').delete().where({ root_ended_at: { $lt: cutoff } });
      await transaction.model('agent_usage_turns').delete().where({ ended_at: { $lt: cutoff } });
    });
  }
}
