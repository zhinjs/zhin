/**
 * ADR 0060 §2 / §7: people behind chat identities — a person (`cp_…`) owns one or more platform
 * identities `(adapter alias, userId)`, holds the chat role grants (ADR 0056) and may be linked
 * one-to-one to a Console user. A link never carries permissions either way.
 */
import type { ConsoleChatRoleEntry } from './chat-roles.js';
import type { ConsoleFeatureLevel } from './feature.js';

export const CHAT_PRINCIPALS_RPC = Object.freeze({
  LIST: 'chat-principals.list',
  GET: 'chat-principals.get',
  MERGE: 'chat-principals.merge',
  SPLIT: 'chat-principals.split',
  RENAME: 'chat-principals.rename',
  LINK_CONSOLE: 'chat-principals.link-console',
  UNLINK_CONSOLE: 'chat-principals.unlink-console',
  /** ADR 0060 §4.5: people, identities, grants and links as JSON (`zhin chat-roles export`). */
  EXPORT: 'chat-principals.export',
  /** ADR 0060 §4.5: merges an export back in (`zhin chat-roles import`); never lowers or removes. */
  IMPORT: 'chat-principals.import',
  /** Identities that spoke recently at a scope (display name cache, ADR 0060 Q11). */
  IDENTITIES_RECENT: 'chat-identities.recent',
  /** A one-time code that binds the chat identity it is sent from to the caller (ADR 0060 §2.4). */
  BIND_CODE_CREATE: 'chat-identities.bind-code.create',
  /** The caller's own link: person, identities, roles and the open bind code. */
  ME: 'chat-identities.me',
} as const);

export type ConsoleChatPrincipalsRpcType = typeof CHAT_PRINCIPALS_RPC[keyof typeof CHAT_PRINCIPALS_RPC];

/**
 * - `chat-principals.*` / `chat-identities.recent`: `iam.manage`; adapter / endpoint bindings
 *   count for the identities on that adapter. Merging, splitting or renaming a person that holds a
 *   global grant, linking / unlinking a Console user, export and import need a **global**
 *   `iam.manage` binding (ADR 0060 §5.2).
 * - `chat-identities.bind-code.create` / `chat-identities.me`: `self.chat-identity` (every built-in
 *   role has it, ADR 0060 Q4); only the caller's own link.
 */
export const CHAT_PRINCIPALS_RPC_PERMISSIONS: Readonly<Record<ConsoleChatPrincipalsRpcType, 'iam.manage' | 'self.chat-identity'>> = Object.freeze({
  [CHAT_PRINCIPALS_RPC.LIST]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.GET]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.MERGE]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.SPLIT]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.RENAME]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.LINK_CONSOLE]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.UNLINK_CONSOLE]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.EXPORT]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.IMPORT]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.IDENTITIES_RECENT]: 'iam.manage',
  [CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE]: 'self.chat-identity',
  [CHAT_PRINCIPALS_RPC.ME]: 'self.chat-identity',
});

export function isConsoleChatPrincipalsRpcType(value: unknown): value is ConsoleChatPrincipalsRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHAT_PRINCIPALS_RPC_PERMISSIONS, value);
}

/**
 * How an identity came to its person: `implicit` (its own single-identity person, created on first
 * need or by the migration), `code` (the identity's holder sent a bind code in a private chat),
 * `manual` (merged by an operator, not proven by the holder), `import`.
 */
export type ConsoleChatIdentityLinkMethod = 'implicit' | 'code' | 'manual' | 'import';

export interface ConsoleChatIdentity {
  readonly adapter: string;
  readonly userId: string;
  readonly linkMethod?: ConsoleChatIdentityLinkMethod;
  readonly linkedAt?: number;
  /** Last inbound message (within the last 90 days). */
  readonly lastSeenAt?: number;
  /** Display name cache (cleared after 90 days); never used for authorization. */
  readonly lastDisplayName?: string;
}

/** `code` (self-service bind code), `manual` (an operator with global `iam.manage`), `import`. */
export type ConsoleChatConsoleLinkVia = 'code' | 'manual' | 'import';

export interface ConsoleChatConsoleLink {
  readonly consoleUserId: string;
  /** Console display name cached when linked / when that user last called the instance. */
  readonly consoleDisplayName?: string;
  readonly linkedAt: number;
  readonly linkedVia: ConsoleChatConsoleLinkVia;
}

export interface ConsoleChatPrincipal {
  /** `cp_…` for a stored person; `implicit:<alias>:<userId>` for an identity without one. */
  readonly id: string;
  readonly displayName?: string;
  readonly createdBy?: string;
  readonly createdAt?: number;
  /** Identities on adapters the caller manages. */
  readonly identities: readonly ConsoleChatIdentity[];
  /** Identities on other adapters (not shown). */
  readonly hiddenIdentities?: number;
  /** Grants held by the person, as `chat-roles.list` shows them. */
  readonly roles: readonly ConsoleChatRoleEntry[];
  /** Global `iam.manage` callers only. */
  readonly consoleLink?: ConsoleChatConsoleLink;
  /** Some identity was merged by an operator without proof (`manual`). */
  readonly unverified?: boolean;
}

/** `chat-principals.list`: people with an identity on an adapter under the scope (default global: all). */
export interface ConsoleChatPrincipalsListRequest {
  readonly level?: ConsoleFeatureLevel;
  readonly key?: string;
}

export interface ConsoleChatPrincipalsListResult {
  readonly principals: readonly ConsoleChatPrincipal[];
}

/** `chat-principals.get`: by `principalId`, or by an identity (`adapter` + `userId`). */
export interface ConsoleChatPrincipalGetRequest {
  readonly principalId?: string;
  readonly adapter?: string;
  readonly userId?: string;
}

/**
 * `chat-principals.merge`: moves every identity of `from` to `into` (grants kept; where both hold
 * a scope the higher role stays). Refused when both are linked to different Console users.
 */
export interface ConsoleChatPrincipalMergeRequest {
  readonly into: ConsoleChatPrincipalRef;
  readonly from: ConsoleChatPrincipalRef;
}

/** A person by id, or the person an identity belongs to. */
export type ConsoleChatPrincipalRef =
  | Readonly<{ principalId: string }>
  | Readonly<{ adapter: string; userId: string }>;

/**
 * `chat-principals.split`: gives the identity its own new person. Its person's global grants stay;
 * grants below global on the identity's adapter move with it when the person keeps no other
 * identity on that adapter.
 */
export interface ConsoleChatPrincipalSplitRequest {
  readonly adapter: string;
  readonly userId: string;
}

export interface ConsoleChatPrincipalRenameRequest {
  readonly principalId: string;
  /** Empty clears the name. */
  readonly displayName: string;
}

/** `chat-principals.link-console`: operator link (`manual`); one Console user ↔ one person. */
export interface ConsoleChatPrincipalLinkRequest {
  readonly principalId: string;
  readonly consoleUserId: string;
  readonly consoleDisplayName?: string;
}

/** `chat-principals.unlink-console`: by `principalId` or `consoleUserId`. */
export interface ConsoleChatPrincipalUnlinkRequest {
  readonly principalId?: string;
  readonly consoleUserId?: string;
}

export interface ConsoleChatPrincipalChangeResult {
  readonly status: 'saved' | 'unchanged';
  readonly principal?: ConsoleChatPrincipal;
}

/** `chat-identities.recent`: identities seen at the scope within the last 90 days, newest first. */
export interface ConsoleChatIdentitiesRecentRequest {
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  /** Default 50, at most 200. */
  readonly limit?: number;
}

export interface ConsoleChatRecentIdentity extends ConsoleChatIdentity {
  readonly principalId: string;
  readonly lastSeenAt: number;
}

export interface ConsoleChatIdentitiesRecentResult {
  readonly identities: readonly ConsoleChatRecentIdentity[];
}

/**
 * `chat-identities.bind-code.create` (no input): 8 symbols, valid 10 minutes, single use; a new
 * code replaces the caller's previous one. Sent as `绑定 <码>` / `bind <code>` in a **private** chat
 * with the bot; a correct code sent in a group is revoked.
 */
export interface ConsoleChatBindCodeResult {
  readonly code: string;
  readonly expiresAt: number;
}

/** `chat-identities.me` (no input). */
export interface ConsoleChatIdentityMeResult {
  readonly principal?: ConsoleChatPrincipal;
  /** The caller's open bind code (expiry only, never the code). */
  readonly pendingCode?: Readonly<{ expiresAt: number }>;
  /**
   * No global owner exists yet and the caller holds global `iam.manage`: the Console may offer to
   * make the linked person the global owner (`chat-roles.grant`, ADR 0060 §3.1).
   */
  readonly suggestGlobalOwner?: boolean;
}

/** ADR 0060 §4.5 export format (`zhin chat-roles export` / `import`). */
export interface ConsoleChatRolesExport {
  readonly format: 'zhin.chat-roles';
  readonly version: 1;
  readonly exportedAt: number;
  readonly principals: readonly Readonly<{ id: string; displayName?: string; createdBy?: string; createdAt?: number }>[];
  readonly identities: readonly Readonly<{
    adapter: string; userId: string; principalId?: string; linkMethod?: ConsoleChatIdentityLinkMethod;
    linkedBy?: string; linkedAt?: number;
  }>[];
  /** `principalId` is absent in a backup taken before the person model (grants by identity). */
  readonly roles: readonly Readonly<{
    level: ConsoleFeatureLevel; key: string; principalId?: string; adapter: string; userId: string;
    role: 'owner' | 'admin' | 'trusted'; grantedBy?: string; grantedAt?: number;
  }>[];
  readonly consoleLinks: readonly Readonly<{
    principalId: string; consoleUserId: string; consoleDisplayName?: string; linkedAt?: number; linkedVia?: ConsoleChatConsoleLinkVia;
  }>[];
}

/** `chat-principals.import`: `data` is a {@link ConsoleChatRolesExport}. */
export interface ConsoleChatRolesImportRequest {
  readonly data: ConsoleChatRolesExport;
}

export interface ConsoleChatRolesImportResult {
  readonly principals: number;
  readonly identities: number;
  /** Grants written or raised (an equal or higher stored grant is kept). */
  readonly roles: number;
  readonly consoleLinks: number;
  /** Entries left out (identity owned by another person, link conflicts, malformed rows). */
  readonly skipped: readonly string[];
}
