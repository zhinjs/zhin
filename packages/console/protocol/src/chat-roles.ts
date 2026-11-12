/**
 * ADR 0056 §2–§3: zhin chat roles (`owner` ⊃ `admin` ⊃ `trusted`) held by a platform identity
 * `(adapter alias, userId)` at one scope of the four-level chain (ADR 0050 / 0055); a role is
 * effective at its scope and every scope under it.
 */
import type { ConsoleFeatureLevel } from './feature.js';

export const CHAT_ROLES_RPC = Object.freeze({
  LIST: 'chat-roles.list',
  GRANT: 'chat-roles.grant',
  REVOKE: 'chat-roles.revoke',
} as const);

export type ConsoleChatRolesRpcType = typeof CHAT_ROLES_RPC[keyof typeof CHAT_ROLES_RPC];

/** Every `chat-roles.*` RPC needs `iam.manage`; adapter / endpoint bindings count for scopes under them. */
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
 * Where an entry comes from: `grant` (the `chat_roles` table; the only revocable source),
 * `config` (account `owner` / `trusted` → endpoint, `ai.trigger.masters|trusted` → global, with
 * `adapter: '*'` meaning every platform) and `mapping` (platform group owner / admin → conversation
 * `admin`; evaluated live per message, listed only for senders seen recently in that conversation).
 */
export type ConsoleChatRoleSource = 'grant' | 'config' | 'mapping';

export interface ConsoleChatRoleEntry {
  readonly level: ConsoleFeatureLevel;
  /** `''` (global), `<alias>`, `<alias>/<endpointId>` or a conversation key. */
  readonly key: string;
  readonly adapter: string;
  readonly userId: string;
  readonly role: ConsoleChatRole;
  readonly source: ConsoleChatRoleSource;
  readonly grantedBy?: string;
  readonly grantedAt?: number;
  /** Short origin hint for `config` / `mapping` entries (e.g. `qq.endpoints[bot-1].owner`). */
  readonly detail?: string;
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

/** `chat-roles.grant`: sets the identity's role at the scope (replaces a different stored role). */
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
