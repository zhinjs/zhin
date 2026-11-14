/**
 * #1250 usage-cache-unsupported-hint: spots a provider that never reports prompt-cache reads
 * although its adjacent requests share the cacheable prefix (system prompt + tool definitions,
 * recorded per model call as `prefix_hash`). Read-only over the trace archive records.
 */
import type { UsageProviderResolver } from './aggregate.js';

/** Defaults: at least 20 consecutive zero-cache calls across at least 3 sessions. */
export const PROMPT_CACHE_HINT_MIN_CALLS = 20;
export const PROMPT_CACHE_HINT_MIN_SESSIONS = 3;
/** Share of adjacent same-session requests with an identical prefix needed as evidence. */
export const PROMPT_CACHE_HINT_MIN_SAME_PREFIX = 0.5;

export interface PromptCacheHint {
  /** Merge key: resolved service id, else the recorded provider id. */
  readonly provider: string;
  /** Service display name when resolvable. */
  readonly label?: string;
  /** Recorded provider ids merged into this row. */
  readonly providerIds: readonly string[];
  /** Most recent run of consecutive calls without a cache read. */
  readonly zeroCacheCalls: number;
  /** Sessions those calls came from. */
  readonly sessions: number;
  /** Calls in that run that reported `cacheRead = 0` (the rest did not report it at all). */
  readonly reportedZeroCalls: number;
  /** Adjacent same-session request pairs in that run whose prefix hashes were compared. */
  readonly comparedPairs: number;
  /** Of those, pairs with an identical prefix. */
  readonly samePrefixPairs: number;
  /** samePrefixPairs / comparedPairs. */
  readonly samePrefixRatio: number;
  /** Readable hint, e.g. for CLI output. */
  readonly message: string;
}

export interface PromptCacheProbeOptions {
  readonly resolveProvider?: UsageProviderResolver;
  readonly minCalls?: number;
  readonly minSessions?: number;
  readonly minSamePrefixRatio?: number;
}

interface Streak {
  label?: string;
  providerIds: Set<string>;
  calls: number;
  reportedZero: number;
  sessions: Set<string>;
  compared: number;
  same: number;
  /** Last prefix hash per session within the streak. */
  lastPrefix: Map<string, string>;
}

function emptyStreak(label?: string): Streak {
  return { ...(label ? { label } : {}), providerIds: new Set(), calls: 0, reportedZero: 0, sessions: new Set(), compared: 0, same: 0, lastPrefix: new Map() };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Feed trace records in chronological order ({@link visit}), then read {@link hints}.
 * Sub-agent turns are included with their own session keys.
 */
export class PromptCacheProbe {
  readonly #streaks = new Map<string, Streak>();
  readonly #resolved = new Map<string, Readonly<{ key: string; label: string }> | undefined>();
  readonly #options: PromptCacheProbeOptions;

  constructor(options: PromptCacheProbeOptions = {}) {
    this.#options = options;
  }

  visit(trace: any): void {
    if (!trace || typeof trace !== 'object') return;
    const session = typeof trace.session_key === 'string' ? trace.session_key : '';
    const calls: unknown[] = Array.isArray(trace.model_calls) ? trace.model_calls : [];
    for (const raw of calls) this.#call(raw as Record<string, unknown>, session);
    const children: unknown[] = Array.isArray(trace.subagents) ? trace.subagents : [];
    for (const child of children) this.visit(child);
  }

  hints(): PromptCacheHint[] {
    const minCalls = this.#options.minCalls ?? PROMPT_CACHE_HINT_MIN_CALLS;
    const minSessions = this.#options.minSessions ?? PROMPT_CACHE_HINT_MIN_SESSIONS;
    const minRatio = this.#options.minSamePrefixRatio ?? PROMPT_CACHE_HINT_MIN_SAME_PREFIX;
    const out: PromptCacheHint[] = [];
    for (const [provider, streak] of this.#streaks) {
      if (streak.calls < minCalls || streak.sessions.size < minSessions || streak.compared === 0) continue;
      const ratio = streak.same / streak.compared;
      if (ratio < minRatio) continue;
      const name = streak.label ?? provider;
      const percent = Math.round(ratio * 100);
      out.push(Object.freeze({
        provider,
        ...(streak.label ? { label: streak.label } : {}),
        providerIds: Object.freeze([...streak.providerIds].sort()),
        zeroCacheCalls: streak.calls,
        sessions: streak.sessions.size,
        reportedZeroCalls: streak.reportedZero,
        comparedPairs: streak.compared,
        samePrefixPairs: streak.same,
        samePrefixRatio: ratio,
        message: `${name}：最近连续 ${streak.calls} 次请求（${streak.sessions.size} 个会话）没有命中提示缓存，`
          + `而相邻请求有 ${percent}%（${streak.same}/${streak.compared}）前缀相同——该服务可能不支持或未透传 prompt 缓存。`,
      }));
    }
    return out.sort((a, b) => b.zeroCacheCalls - a.zeroCacheCalls);
  }

  #resolve(recorded: string): Readonly<{ key: string; label: string }> | undefined {
    const resolveProvider = this.#options.resolveProvider;
    if (!resolveProvider) return undefined;
    if (!this.#resolved.has(recorded)) {
      let value: Readonly<{ key: string; label: string }> | undefined;
      try { value = resolveProvider(recorded); } catch { value = undefined; }
      this.#resolved.set(recorded, value);
    }
    return this.#resolved.get(recorded);
  }

  #call(call: Record<string, unknown>, session: string): void {
    const prompt = num(call.prompt_tokens);
    if (prompt === undefined || prompt === 0) return;
    const recorded = typeof call.provider === 'string' && call.provider ? call.provider : 'unknown';
    const service = this.#resolve(recorded);
    const key = service?.key ?? recorded;
    const cacheRead = num(call.cache_read_tokens);
    if (cacheRead !== undefined && cacheRead > 0) {
      // A cache hit ends the run: this provider does cache.
      this.#streaks.set(key, emptyStreak(service?.label));
      return;
    }
    let streak = this.#streaks.get(key);
    if (!streak) {
      streak = emptyStreak(service?.label);
      this.#streaks.set(key, streak);
    }
    streak.providerIds.add(recorded);
    streak.calls += 1;
    if (cacheRead === 0) streak.reportedZero += 1;
    streak.sessions.add(session);
    const prefix = typeof call.prefix_hash === 'string' && call.prefix_hash ? call.prefix_hash : undefined;
    if (prefix) {
      const previous = streak.lastPrefix.get(session);
      if (previous !== undefined) {
        streak.compared += 1;
        if (previous === prefix) streak.same += 1;
      }
      streak.lastPrefix.set(session, prefix);
    }
  }
}
