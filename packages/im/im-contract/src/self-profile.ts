import type { MediaRef } from './segment.js';

/** Public account facts, distinct from a member's scene-specific nickname or role. */
export interface SelfProfile {
  readonly nickname?: string | null;
  readonly gender?: 'male' | 'female' | 'other' | 'unknown' | null;
  readonly age?: number | null;
  /** Calendar date supplied by the platform/user; never inferred from an age. */
  readonly birthday?: string | null;
  readonly signature?: string | null;
  /** Image URL only. Image bytes and inline base64 never belong in account facts. */
  readonly avatar?: string | null;
  readonly interests?: readonly string[] | null;
  readonly bio?: string | null;
}

export const SELF_PROFILE_FIELDS = [
  'nickname', 'gender', 'age', 'birthday', 'signature', 'avatar', 'interests', 'bio',
] as const satisfies readonly (keyof SelfProfile)[];

export type SelfProfileField = (typeof SELF_PROFILE_FIELDS)[number];

/** A single platform effect; unsupported fields are rejected before submission. */
export type SelfProfileChange = {
  [K in SelfProfileField]: Readonly<{
    field: K;
    value: K extends 'avatar' ? MediaRef : NonNullable<SelfProfile[K]>;
  }>
}[SelfProfileField];

export interface SelfProfileReadRequest {
  readonly signal: AbortSignal;
  /** Explicitly query the platform instead of reusing this account incarnation's last facts. */
  readonly refresh?: boolean;
}

export interface SelfProfileWriteRequest {
  readonly change: SelfProfileChange;
  readonly signal: AbortSignal;
}

export interface SelfProfileWriteResult {
  readonly status: 'updated' | 'rejected' | 'unknown';
  readonly message?: string;
  /** Only fields actually confirmed by the platform; never echo unrelated configured defaults. */
  readonly profile?: Readonly<SelfProfile>;
}

export interface SelfProfileSnapshot {
  readonly values: Readonly<SelfProfile>;
  readonly sources: Readonly<Partial<Record<SelfProfileField, 'platform' | 'configured'>>>;
  readonly writableFields: readonly SelfProfileField[];
  /** Describes the adapter's read capability, not whether the platform supports an undocumented API. */
  readonly platformStatus: 'unread' | 'available' | 'unsupported';
}

/** One source account's scoped profile capability; it never accepts an account selector. */
export interface SelfProfilePort {
  /** Last observed facts and configured fallbacks. No IO and no implied freshness. */
  peek(): SelfProfileSnapshot;
  read(request: SelfProfileReadRequest): Promise<SelfProfileSnapshot>;
  write?(request: SelfProfileWriteRequest): Promise<SelfProfileWriteResult>;
}
