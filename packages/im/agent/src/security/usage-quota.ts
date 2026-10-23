/**
 * Per-user and per-group usage quotas (#727, cost / abuse control).
 *
 * Two independent limits, both off by default:
 * - token quota:   total tokens a user, or a whole group, may spend within a
 *                  rolling fixed window (default 24 h);
 * - group rate:    turns a single group may start per minute (the existing
 *                  `ai.agent.rateLimit` already limits each user).
 *
 * A user over their quota is told so and nobody else is affected; a group
 * over its quota stops only that group. The owner is exempt by default.
 */

export interface UsageQuotaSettings {
  /** Length of the quota window in ms (default 24 h). */
  readonly windowMs: number;
  /** Tokens one user may use per window across all chats; 0 = unlimited (default). */
  readonly perUserTokens: number;
  /** Tokens one group may use per window across all members; 0 = unlimited (default). */
  readonly perGroupTokens: number;
  /** Turns one group may start per minute; 0 = unlimited (default). */
  readonly perGroupRequestsPerMinute: number;
  /** The owner is never limited (default true). */
  readonly exemptOwner: boolean;
}

export const DEFAULT_USAGE_QUOTA: UsageQuotaSettings = Object.freeze({
  windowMs: 24 * 60 * 60 * 1000,
  perUserTokens: 0,
  perGroupTokens: 0,
  perGroupRequestsPerMinute: 0,
  exemptOwner: true,
});

export function resolveUsageQuota(raw?: Partial<UsageQuotaSettings>): UsageQuotaSettings {
  const count = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  return Object.freeze({
    windowMs: Math.max(60_000, count(raw?.windowMs, DEFAULT_USAGE_QUOTA.windowMs)),
    perUserTokens: count(raw?.perUserTokens, 0),
    perGroupTokens: count(raw?.perGroupTokens, 0),
    perGroupRequestsPerMinute: count(raw?.perGroupRequestsPerMinute, 0),
    exemptOwner: raw?.exemptOwner !== false,
  });
}

/** One counter window. */
export interface UsageBucket {
  readonly windowStart: number;
  readonly used: number;
}

/** Storage for quota counters; the default keeps them in memory (reset on restart). */
export interface UsageQuotaStore {
  get(key: string): UsageBucket | undefined;
  set(key: string, bucket: UsageBucket): void;
  delete(key: string): void;
  keys(): Iterable<string>;
}

export class InMemoryUsageQuotaStore implements UsageQuotaStore {
  readonly #buckets = new Map<string, UsageBucket>();
  get(key: string) { return this.#buckets.get(key); }
  set(key: string, bucket: UsageBucket) { this.#buckets.set(key, bucket); }
  delete(key: string) { this.#buckets.delete(key); }
  keys() { return this.#buckets.keys(); }
}

/** Defined in `@zhin.js/core` (#877) so plugins can build one with `usageSubjectFromMessage`. */
import type { UsageSubject } from '@zhin.js/core';
export type { UsageSubject };

export type UsageQuotaDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; scope: 'user' | 'group'; reason: 'tokens' | 'rate'; message: string; retryAfterSeconds: number }>;

const RATE_WINDOW_MS = 60_000;

export class UsageQuota {
  readonly settings: UsageQuotaSettings;
  readonly #store: UsageQuotaStore;
  readonly #now: () => number;

  constructor(settings?: Partial<UsageQuotaSettings>, store: UsageQuotaStore = new InMemoryUsageQuotaStore(), now: () => number = Date.now) {
    this.settings = resolveUsageQuota(settings);
    this.#store = store;
    this.#now = now;
  }

  get enabled(): boolean {
    const s = this.settings;
    return s.perUserTokens > 0 || s.perGroupTokens > 0 || s.perGroupRequestsPerMinute > 0;
  }

  /** Checks a turn before it starts; an allowed group turn counts against the group's rate. */
  check(subject: UsageSubject): UsageQuotaDecision {
    return this.#check(subject, true, this.#now());
  }

  /** Preflight the whole request before consuming one rate slot per non-exempt group. */
  checkBatch(subjects: readonly UsageSubject[]): UsageQuotaDecision & { readonly deniedUserIds?: readonly string[] } {
    const now = this.#now();
    const denied = subjects.map(subject => ({ subject, decision: this.#check(subject, false, now) }))
      .filter((entry): entry is { subject: UsageSubject; decision: Extract<UsageQuotaDecision, { allowed: false }> } => !entry.decision.allowed);
    const groupDenial = denied.find(entry => entry.decision.scope === 'group');
    if (groupDenial) return groupDenial.decision;
    if (denied.length) return { ...denied[0]!.decision, deniedUserIds: [...new Set(denied.map(entry => entry.subject.userId))] };
    if (this.settings.perGroupRequestsPerMinute > 0) {
      const groups = new Set(subjects.filter(subject => !(subject.owner && this.settings.exemptOwner))
        .map(subject => subject.groupId).filter((id): id is string => !!id));
      for (const group of groups) this.#add(`rate:group:${group}`, RATE_WINDOW_MS, now, 1);
    }
    return { allowed: true };
  }

  #check(subject: UsageSubject, countRequest: boolean, now: number): UsageQuotaDecision {
    if (!this.enabled || (subject.owner && this.settings.exemptOwner)) return { allowed: true };
    const { perUserTokens, perGroupTokens, perGroupRequestsPerMinute, windowMs } = this.settings;
    if (perUserTokens > 0) {
      const bucket = this.#current(`tokens:user:${subject.userId}`, windowMs, now);
      if (bucket.used >= perUserTokens) {
        return deny('user', 'tokens', bucket, windowMs, now,
          `你在本周期内的 AI 用量已达上限（${perUserTokens} tokens），约 ${formatWait(bucket, windowMs, now)}后恢复。其他人不受影响。`);
      }
    }
    if (subject.groupId && perGroupTokens > 0) {
      const bucket = this.#current(`tokens:group:${subject.groupId}`, windowMs, now);
      if (bucket.used >= perGroupTokens) {
        return deny('group', 'tokens', bucket, windowMs, now,
          `本群在本周期内的 AI 用量已达上限，约 ${formatWait(bucket, windowMs, now)}后恢复。私聊和其他群不受影响。`);
      }
    }
    if (subject.groupId && perGroupRequestsPerMinute > 0) {
      const key = `rate:group:${subject.groupId}`;
      const bucket = this.#current(key, RATE_WINDOW_MS, now);
      if (bucket.used >= perGroupRequestsPerMinute) {
        return deny('group', 'rate', bucket, RATE_WINDOW_MS, now,
          `本群消息太多啦，请约 ${formatWait(bucket, RATE_WINDOW_MS, now)}后再试。`);
      }
      if (countRequest) this.#store.set(key, { windowStart: bucket.windowStart, used: bucket.used + 1 });
    }
    return { allowed: true };
  }

  /** Adds a finished turn's token usage to the user's and the group's counters. */
  record(subject: UsageSubject, totalTokens: number): void {
    if (!this.enabled || totalTokens <= 0 || (subject.owner && this.settings.exemptOwner)) return;
    const now = this.#now();
    const { perUserTokens, perGroupTokens, windowMs } = this.settings;
    if (perUserTokens > 0) this.#add(`tokens:user:${subject.userId}`, windowMs, now, totalTokens);
    if (subject.groupId && perGroupTokens > 0) this.#add(`tokens:group:${subject.groupId}`, windowMs, now, totalTokens);
  }

  /** Drops expired counters. */
  prune(): void {
    const now = this.#now();
    for (const key of [...this.#store.keys()]) {
      const bucket = this.#store.get(key);
      const windowMs = key.startsWith('rate:') ? RATE_WINDOW_MS : this.settings.windowMs;
      if (!bucket || now - bucket.windowStart >= windowMs) this.#store.delete(key);
    }
  }

  #current(key: string, windowMs: number, now: number): UsageBucket {
    const bucket = this.#store.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) return { windowStart: now, used: 0 };
    return bucket;
  }

  #add(key: string, windowMs: number, now: number, amount: number): void {
    const bucket = this.#current(key, windowMs, now);
    this.#store.set(key, { windowStart: bucket.windowStart, used: bucket.used + amount });
  }
}

function deny(
  scope: 'user' | 'group',
  reason: 'tokens' | 'rate',
  bucket: UsageBucket,
  windowMs: number,
  now: number,
  message: string,
): UsageQuotaDecision {
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  return Object.freeze({ allowed: false, scope, reason, message, retryAfterSeconds });
}

function formatWait(bucket: UsageBucket, windowMs: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${Math.ceil(seconds / 3600)} 小时`;
}
