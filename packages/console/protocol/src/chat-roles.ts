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
  MAPPINGS: 'chat-roles.mappings',
  SET_MAPPINGS: 'chat-roles.set-mappings',
} as const);

export type ConsoleChatRolesRpcType = typeof CHAT_ROLES_RPC[keyof typeof CHAT_ROLES_RPC];

/** Every `chat-roles.*` RPC needs `iam.manage`; adapter / endpoint bindings count for scopes under them. */
export const CHAT_ROLES_RPC_PERMISSIONS: Readonly<Record<ConsoleChatRolesRpcType, 'iam.manage'>> = Object.freeze({
  [CHAT_ROLES_RPC.LIST]: 'iam.manage',
  [CHAT_ROLES_RPC.GRANT]: 'iam.manage',
  [CHAT_ROLES_RPC.REVOKE]: 'iam.manage',
  [CHAT_ROLES_RPC.MAPPINGS]: 'iam.manage',
  [CHAT_ROLES_RPC.SET_MAPPINGS]: 'iam.manage',
});

export function isConsoleChatRolesRpcType(value: unknown): value is ConsoleChatRolesRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHAT_ROLES_RPC_PERMISSIONS, value);
}

export type ConsoleChatRole = 'owner' | 'admin' | 'trusted';
export const CONSOLE_CHAT_ROLES: readonly ConsoleChatRole[] = Object.freeze(['owner', 'admin', 'trusted']);

/**
 * Where an entry comes from: `grant` (the `chat_roles` table; the only revocable source) and
 * `mapping` (a mapping rule matched the sender's platform standing in that conversation; evaluated
 * live per message, never stored, listed only for senders seen recently there; `detail` names the
 * rule, e.g. `mapping:default standing=admin|owner`).
 */
export type ConsoleChatRoleSource = 'grant' | 'mapping';

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
  /** Origin hint of `mapping` entries: `mapping:<level> <match>`. */
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

// ============================================================================
// Mapping rules (ADR 0056 §4)
// ============================================================================

export type ConsolePlatformStanding = 'owner' | 'admin' | 'member' | 'guest';

export interface ConsoleChatRoleMappingMatch {
  /** Normalized standings, any of. */
  readonly standing?: readonly ConsolePlatformStanding[];
  /** Platform role ids, any of. */
  readonly role?: readonly string[];
  /** Platform permissions, any of. */
  readonly permission?: readonly string[];
}

/**
 * Platform standing → zhin role. Every given `match` criterion must hold; `grant: 'none'` removes
 * an inherited rule with the same `match`. `trusted` / `owner` grants are allowed only in
 * conversation-level rules.
 */
export interface ConsoleChatRoleMappingRule {
  readonly match: ConsoleChatRoleMappingMatch;
  readonly grant: ConsoleChatRole | 'none';
}

/** Where rules are declared: built-in default, the adapter / account configuration block, or the database (conversation). */
export type ConsoleChatRoleMappingLevel = 'default' | 'adapter' | 'endpoint' | 'conversation';

export interface ConsoleChatRoleMappingLayer {
  readonly level: ConsoleChatRoleMappingLevel;
  readonly rules: readonly ConsoleChatRoleMappingRule[];
  /** False: rules from the levels above (the default rule included) are dropped. */
  readonly inherit: boolean;
  /** Conversation layer only. */
  readonly revision?: number;
  readonly updatedAt?: number;
  readonly updatedBy?: string;
}

/** `chat-roles.mappings`: the layers on the chain of `key` (adapter, endpoint or conversation) and the merged result. */
export interface ConsoleChatRoleMappingsRequest {
  readonly level: Exclude<ConsoleFeatureLevel, 'global'>;
  readonly key: string;
}

export interface ConsoleChatRoleMappingsResult {
  /** `default` first, then the configured adapter / endpoint layers and, for a conversation, its stored layer. */
  readonly layers: readonly ConsoleChatRoleMappingLayer[];
  /** Rules in effect at `key` after overriding and `none` removal, with the level each comes from. */
  readonly effective: readonly (ConsoleChatRoleMappingRule & { readonly level: ConsoleChatRoleMappingLevel })[];
}

/**
 * `chat-roles.set-mappings`: replaces the conversation's stored rules (adapter / account rules live
 * in the configuration file). Empty `mappings` with `inherit` true deletes the stored layer.
 */
export interface ConsoleChatRoleSetMappingsRequest {
  readonly level: 'conversation';
  readonly key: string;
  readonly mappings: readonly ConsoleChatRoleMappingRule[];
  /** Default true. */
  readonly inherit?: boolean;
  /** Revision read from `chat-roles.mappings` (0: no stored layer yet); a mismatch returns `conflict`. */
  readonly expectedRevision?: number;
}

export type ConsoleChatRoleSetMappingsResult =
  | Readonly<{ status: 'saved' | 'unchanged'; layer?: ConsoleChatRoleMappingLayer }>
  | Readonly<{ status: 'conflict'; layer?: ConsoleChatRoleMappingLayer }>
  | Readonly<{ status: 'invalid'; error: string }>;
