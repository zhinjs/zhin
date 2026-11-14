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
  /** ADR 0060 §4: the configuration import — first import and re-appeared candidates. */
  IMPORTS_LIST: 'chat-roles.imports.list',
  /** ADR 0060 §4.2: 「导入」/「忽略」 one candidate, or mark the first import as read. */
  IMPORTS_RESOLVE: 'chat-roles.imports.resolve',
} as const);

export type ConsoleChatRolesRpcType = typeof CHAT_ROLES_RPC[keyof typeof CHAT_ROLES_RPC];

/**
 * Every `chat-roles.*` RPC needs `iam.manage`; adapter / endpoint bindings count for scopes under
 * them. Granting / revoking `owner` (or replacing / removing an existing owner grant) needs a
 * **global** `iam.manage` binding whatever the target level (ADR 0056 §3). `chat-roles.imports.*`
 * always need a **global** `iam.manage` binding (ADR 0060 §4.2: imports may carry `owner`).
 */
export const CHAT_ROLES_RPC_PERMISSIONS: Readonly<Record<ConsoleChatRolesRpcType, 'iam.manage'>> = Object.freeze({
  [CHAT_ROLES_RPC.LIST]: 'iam.manage',
  [CHAT_ROLES_RPC.GRANT]: 'iam.manage',
  [CHAT_ROLES_RPC.REVOKE]: 'iam.manage',
  [CHAT_ROLES_RPC.IMPORTS_LIST]: 'iam.manage',
  [CHAT_ROLES_RPC.IMPORTS_RESOLVE]: 'iam.manage',
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
  readonly grantedBy?: string;
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

/** A configured grant (ADR 0060 §4): where it came from and what it grants. */
export interface ConsoleChatRoleImportGrant {
  /** Idempotency key `(source, adapter, userId, level, key)`; the id `chat-roles.imports.resolve` takes. */
  readonly id: string;
  /** Configuration path, e.g. `qq.endpoints[0].master`, `ai.trigger.masters`. */
  readonly source: string;
  readonly level: Exclude<ConsoleFeatureLevel, 'conversation'>;
  readonly key: string;
  readonly adapter: string;
  readonly userId: string;
  readonly role: Extract<ConsoleChatRole, 'owner' | 'trusted'>;
}

/**
 * Outcome of importing one grant: `written` (new), `upgraded` (a lower stored role was raised),
 * `kept` (an equal or higher stored role was kept: imports never lower or remove), `memory` (no
 * relational database: in memory only), `skipped` (see `reason`).
 */
export type ConsoleChatRoleImportResult = 'written' | 'upgraded' | 'kept' | 'memory' | 'skipped';

/** `skipped`: a local simulation adapter (clients choose the sender id), or an adapter that was not loaded. */
export type ConsoleChatRoleImportSkipReason = 'simulated' | 'unknown-adapter';

export interface ConsoleChatRoleImportedGrant extends ConsoleChatRoleImportGrant {
  readonly result: ConsoleChatRoleImportResult;
  readonly reason?: ConsoleChatRoleImportSkipReason;
  readonly at: number;
}

export interface ConsoleChatRoleImportCandidate extends ConsoleChatRoleImportGrant {
  /** When the configuration first named it again. */
  readonly seenAt: number;
}

/** `chat-roles.imports.list` (no input). */
export interface ConsoleChatRoleImportsListResult {
  /** Grants of the first import (automatic, ADR 0060 §4.1). */
  readonly imported: readonly ConsoleChatRoleImportedGrant[];
  readonly importedAt?: number;
  /** Set once a Console user marked the first import as read (`acknowledge`). */
  readonly acknowledgedAt?: number;
  /** Re-appeared configured grants: never granted until imported here (ADR 0060 §4.2). */
  readonly pending: readonly ConsoleChatRoleImportCandidate[];
  /**
   * Whether any global `owner` exists. Without one, an imported account-level `owner` may be
   * promoted with `chat-roles.grant` at `global` (ADR 0060 Q1); never automatic.
   */
  readonly hasGlobalOwner: boolean;
}

export type ConsoleChatRoleImportDecision = 'import' | 'ignore' | 'acknowledge';

/** `chat-roles.imports.resolve`: `import` / `ignore` need `id`; `acknowledge` marks the first import as read. */
export interface ConsoleChatRoleImportsResolveRequest {
  readonly decision: ConsoleChatRoleImportDecision;
  readonly id?: string;
}

export interface ConsoleChatRoleImportsResolveResult {
  readonly status: 'imported' | 'ignored' | 'acknowledged' | 'unchanged';
  /** `imported` only. */
  readonly result?: ConsoleChatRoleImportResult;
  readonly reason?: ConsoleChatRoleImportSkipReason;
}
