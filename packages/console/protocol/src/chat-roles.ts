/**
 * ADR 0056 §2–§3: zhin chat roles (`owner` ⊃ `admin` ⊃ `trusted`) held by a platform identity
 * `(adapter alias, userId)` at one scope of the four-level chain (ADR 0050 / 0055); a role is
 * effective at its scope and every scope under it. Platform standing is a separate dimension
 * (`platform:*` / `bot:*` permits) and never becomes a zhin role.
 */
import type { ConsoleFeatureLevel } from './feature.js';

export const CHAT_ROLES_RPC = Object.freeze({
  LIST: 'chat-roles.list',
  GRANT: 'chat-roles.grant',
  REVOKE: 'chat-roles.revoke',
} as const);

export type ConsoleChatRolesRpcType = typeof CHAT_ROLES_RPC[keyof typeof CHAT_ROLES_RPC];

/**
 * Every `chat-roles.*` RPC needs `iam.manage`; adapter / endpoint bindings count for scopes under
 * them. Granting / revoking `owner` (or replacing / removing an existing owner grant) needs a
 * **global** `iam.manage` binding whatever the target level (ADR 0056 §3).
 */
export const CHAT_ROLES_RPC_PERMISSIONS: Readonly<Record<ConsoleChatRolesRpcType, 'iam.manage'>> = Object.freeze({
  [CHAT_ROLES_RPC.LIST]: 'iam.manage',
  [CHAT_ROLES_RPC.GRANT]: 'iam.manage',
  [CHAT_ROLES_RPC.REVOKE]: 'iam.manage',
});

export function isConsoleChatRolesRpcType(value: unknown): value is ConsoleChatRolesRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHAT_ROLES_RPC_PERMISSIONS, value);
}

export type ConsoleChatRole = 'owner' | 'admin' | 'trusted';
export const CONSOLE_CHAT_ROLES: readonly ConsoleChatRole[] = Object.freeze(['owner', 'admin', 'trusted']);

/**
 * Where an entry comes from: `grant` (the `chat_roles` table, including grants migrated from the
 * old configuration lists). Platform standing is never mapped into a zhin role (ADR 0056 §4,
 * revised 2026-11-12), so there is no other source.
 */
export type ConsoleChatRoleSource = 'grant';

export interface ConsoleChatRoleEntry {
  readonly level: ConsoleFeatureLevel;
  /** `''` (global), `<alias>`, `<alias>/<endpointId>` or a conversation key. */
  readonly key: string;
  /** Absent on a `redacted` entry. */
  readonly adapter?: string;
  /** Absent on a `redacted` entry. */
  readonly userId?: string;
  /**
   * `chat-roles.list` only: the entry is at a scope the caller does not manage (inherited from
   * above), so only its role and level are shown, not who holds it.
   */
  readonly redacted?: true;
  readonly role: ConsoleChatRole;
  readonly source: ConsoleChatRoleSource;
  /** Audit id of the grantor (`user:<id>`, `api-token:<id>`, `chat:<adapter>:<userId>`, `migration:<source>`, `bootstrap`). */
  readonly grantedBy?: string;
  /**
   * Readable grantor label when the instance can tell it without reading other accounts (#1250):
   * the caller's own display name for grants they made, `<adapter> 用户 <id>` for chat grants,
   * `配置迁移`, `初始化令牌`. Absent otherwise — show `grantedBy` (e.g. a short id) then.
   */
  readonly grantedByDisplayName?: string;
  readonly grantedAt?: number;
}

/** `chat-roles.list`: entries effective at `key` (its own and inherited from above). */
export interface ConsoleChatRolesListRequest {
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  /** Also list entries of scopes below `key` (default false). */
  readonly descendants?: boolean;
}

export interface ConsoleChatRolesListResult {
  readonly roles: readonly ConsoleChatRoleEntry[];
}

/**
 * `chat-roles.grant`: sets the identity's role at the scope (replaces a different stored role).
 * Refused with 503 `chat-roles-unpersisted` without a relational project database.
 */
export interface ConsoleChatRoleGrantRequest {
  readonly level: ConsoleFeatureLevel;
  /** Omitted for `global`. */
  readonly key?: string;
  /** Adapter instance alias of the identity; below global it must be the scope's own alias. */
  readonly adapter: string;
  readonly userId: string;
  readonly role: ConsoleChatRole;
}

/** `chat-roles.revoke`: removes the stored grant of the identity at the scope. */
export interface ConsoleChatRoleRevokeRequest {
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  readonly adapter: string;
  readonly userId: string;
}

export type ConsoleChatRoleChangeResult = Readonly<{ status: 'saved' | 'unchanged'; entry?: ConsoleChatRoleEntry }>;
