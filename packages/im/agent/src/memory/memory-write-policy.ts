/**
 * Semantic-memory write policy (#733).
 *
 * Every `memory_upsert` is attributed to the turn that made it: the source,
 * turn id and trust level come from the turn's ingress, never from model
 * input. On top of that:
 *
 * - Only owner / trusted_member turns may write `global` or `platform`
 *   memory. A group member can write only to their own `user` scope or the
 *   current `session` scope.
 * - `user_fact` and `preference` entries written at a higher trust level
 *   cannot be overwritten by a lower one, so a group member cannot rewrite
 *   what the owner recorded. Same-or-higher writes replace the content and
 *   the previous version is kept in the entry's history (newest wins).
 * - `task_state` always expires: it is bound to a task id when one is given
 *   and gets a bounded TTL (default 24h, at most 7 days).
 */
import type { MemoryEntryKind, MemoryEntryRecord, MemoryEntryScope, MemoryEntryTrustLevel } from '@zhin.js/ai';
import type { InitiatorTrustLevel } from '../security/trust-level.js';

export const TASK_STATE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const TASK_STATE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TRUST_RANK: Readonly<Record<MemoryEntryTrustLevel, number>> = Object.freeze({
  owner: 3,
  trusted_member: 2,
  group_member: 1,
  // Legacy rows predate attribution; treat them as trusted so existing facts keep
  // their protection from group members without locking out the owner.
  '': 2,
});

const SHARED_SCOPES: ReadonlySet<MemoryEntryScope> = new Set(['global', 'platform']);
const PROTECTED_KINDS: ReadonlySet<MemoryEntryKind> = new Set(['user_fact', 'preference']);

export interface MemoryWriteRequest {
  readonly level: InitiatorTrustLevel;
  readonly scope: MemoryEntryScope;
  readonly kind: MemoryEntryKind;
  readonly existing: MemoryEntryRecord | null;
}

export type MemoryWriteDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: string }>;

export function decideMemoryWrite(request: MemoryWriteRequest): MemoryWriteDecision {
  const { level, scope, kind, existing } = request;
  if (level === 'group_member' && SHARED_SCOPES.has(scope)) {
    return deny(`${scope === 'global' ? '全局' : '平台'}记忆仅主人或信任成员可写入；可改为写入 user 或 session 范围。`);
  }
  if (existing && (PROTECTED_KINDS.has(existing.kind) || PROTECTED_KINDS.has(kind))
    && TRUST_RANK[level] < TRUST_RANK[existing.trust_level]) {
    return deny(`记忆 "${existing.key}" 由更高信任级别写入，当前发起者无权覆盖。`);
  }
  return Object.freeze({ allowed: true });
}

/** Default scope when the model omits one: shared memory only for trusted writers. */
export function defaultMemoryScope(level: InitiatorTrustLevel): MemoryEntryScope {
  return level === 'group_member' ? 'user' : 'global';
}

/** Absolute expiry for an entry; only task_state gets one by default. */
export function memoryExpiry(kind: MemoryEntryKind, ttlHours: number | undefined, now: number): number | null | undefined {
  if (kind !== 'task_state') {
    return ttlHours === undefined ? undefined : now + clampTtl(ttlHours * 3_600_000, Number.POSITIVE_INFINITY);
  }
  const ttl = ttlHours === undefined ? TASK_STATE_DEFAULT_TTL_MS : ttlHours * 3_600_000;
  return now + clampTtl(ttl, TASK_STATE_MAX_TTL_MS);
}

function clampTtl(ttl: number, max: number): number {
  if (!Number.isFinite(ttl) || ttl <= 0) return Math.min(TASK_STATE_DEFAULT_TTL_MS, max);
  return Math.min(ttl, max);
}

function deny(reason: string): MemoryWriteDecision {
  return Object.freeze({ allowed: false, reason });
}
