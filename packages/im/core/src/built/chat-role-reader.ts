/**
 * ADR 0060 §6: the public read side of chat roles for plugins.
 *
 * - {@link isOwner} / {@link hasChatRole}: pure checks of the current message's sender, from the
 *   facts the Runtime wrote (`sender.chatRole` / `sender.chatRoleLevels`); no database access.
 * - {@link chatRolesToken}: a read-only {@link ChatRoleReader} for code outside a message context
 *   (schedules, webhooks, notifications): who holds a role, what a platform identity holds, change
 *   notifications. Writes stay with the Console RPC and the chat commands (thresholds + audit).
 *
 * Plugins should read roles here instead of keeping their own `masters` / admin lists.
 */
import {
  CHAT_ROLE_LEVELS, chatRoleHeldAt, normalizeChatRoleLevels,
  type ChatRoleLevel, type ChatRoleLevels, type ChatRoleName, type ConversationRef,
} from '@zhin.js/im-contract';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  chatPrincipalOf, chatRoleEntryAppliesTo, chatRoleEntryPrincipalId, chatRoleIncludes, chatScopeChain, higherChatRole,
  implicitChatPrincipalId, isChatIdentity, normalizeChatRoleScope,
  type ChatIdentity, type ChatRole, type ChatRoleEntry, type ChatRoleService,
} from './roles.js';

export { implicitChatPrincipalId } from './roles.js';

/** The sender facts the Runtime writes on every inbound message (`sender.chatRole` / `sender.chatRoleLevels`). */
export interface ChatRoleSenderFacts {
  readonly chatRole?: unknown;
  readonly chatRoleLevels?: unknown;
}

/**
 * Whether the sender is an `owner` at `level` or above on this conversation's chain. The default
 * level `global` means "the owner of this host" (exec, files, restart …); a conversation- or
 * account-level owner is not.
 */
export function isOwner(
  sender: ChatRoleSenderFacts | null | undefined,
  options?: Readonly<{ level?: ChatRoleLevel }>,
): boolean {
  return chatRoleHeldAt(sender, 'owner', options?.level ?? 'global');
}

/**
 * Whether the sender holds `role` (or a higher one) at `level` or above on this conversation's
 * chain. The default level `conversation` accepts a role held anywhere on the chain. Same rule as
 * {@link chatRoleHeldAt}, which stays exported.
 */
export function hasChatRole(
  sender: ChatRoleSenderFacts | null | undefined,
  role: ChatRole,
  options?: Readonly<{ level?: ChatRoleLevel }>,
): boolean {
  return chatRoleHeldAt(sender, role, options?.level ?? 'conversation');
}

/** A scope of the four-level chain (ADR 0056 §2). */
export type ChatScopeRef =
  | { readonly level: 'global' }
  | { readonly level: 'adapter'; readonly adapter: string }
  | { readonly level: 'endpoint'; readonly adapter: string; readonly endpointId: string }
  | { readonly level: 'conversation'; readonly conversation: ConversationRef };

/**
 * A person (ADR 0060 §2): a stored person has a `cp_…` id; an identity without one is its own
 * implicit single-identity person, with the id `implicit:<alias>:<userId>`.
 */
export interface ChatPrincipalView {
  readonly id: string;
  readonly displayName?: string;
  readonly identities: readonly ChatIdentity[];
}

/** A stored grant was written (`grant`, including a changed role) or removed (`revoke`). */
export interface ChatRoleGrantChange {
  readonly kind: 'grant' | 'revoke';
  /** The identity the grant was written for. */
  readonly identity: ChatIdentity;
  /** The person holding the grant (ADR 0060 §2.3). */
  readonly principalId?: string;
  readonly level: ChatRoleLevel;
  /** Normalized scope key (`''` for global). */
  readonly key: string;
  /** The role after a `grant`; absent on a `revoke`. */
  readonly role?: ChatRole;
}

/**
 * Who belongs to whom changed (ADR 0060 §2.2): `merge` moved every identity of `from` to
 * `principalId` (grants kept, the higher one where both held a scope); `split` gave `identities`
 * their own new person `principalId`, out of `from`.
 */
export interface ChatPrincipalChange {
  readonly kind: 'merge' | 'split';
  readonly principalId: string;
  readonly from: string;
  readonly identities: readonly ChatIdentity[];
}

/** Role or ownership changes (`ChatRoleReader.subscribe`). */
export type ChatRoleChange = ChatRoleGrantChange | ChatPrincipalChange;

/** The sender facts of one identity in one conversation (what the Runtime writes on `sender`). */
export interface ChatRoleFacts {
  readonly identity: ChatIdentity;
  /** The person the identity belongs to (what the Runtime writes as `sender.chatPrincipal`). */
  readonly chatPrincipal?: string;
  readonly chatRole?: ChatRole;
  readonly chatRoleLevels?: ChatRoleLevels;
}

export interface ChatRoleHoldersOptions {
  /** Only grants held at this level or above (default: `global` without `scope`, any level with it). */
  readonly level?: ChatRoleLevel;
  /** Grants effective at this scope (its own and inherited from above); default global. */
  readonly scope?: ChatScopeRef;
  /** Only identities on this adapter instance alias. */
  readonly adapter?: string;
}

/** Read-only chat roles (ADR 0060 §6). Plugins are trusted code and may read every holder. */
export interface ChatRoleReader {
  /** Highest role of a platform identity effective at `scope` (default global). */
  roleOf(identity: ChatIdentity, scope?: ChatScopeRef): ChatRole | undefined;
  /** The person an identity belongs to (its implicit single-identity person when none is stored). */
  principalOf(identity: ChatIdentity): ChatPrincipalView;
  /** People holding `role` (or a higher one), with their identities — e.g. whom to notify. */
  holders(role: ChatRole, options?: ChatRoleHoldersOptions): readonly ChatPrincipalView[];
  /**
   * The facts the Runtime writes on `sender` for `userId` speaking in `conversation`; undefined
   * when the conversation cannot be addressed.
   */
  factsOf(conversation: ConversationRef, userId: string): ChatRoleFacts | undefined;
  /** Grant / revoke / merge / split notifications; returns the unsubscribe function. */
  subscribe(listener: (change: ChatRoleChange) => void): () => void;
  /**
   * ADR 0060 §5.4: the identity on `conversation`'s adapter of the person linked to Console user
   * `consoleUserId` (the first one when the person has several there); undefined when the user is
   * not linked or the person has no identity on that adapter. A local simulation (the Console
   * Sandbox) speaks as it for an authenticated Console user who chose 「以我的聊天身份发言」.
   * Optional for readers built before P3.
   */
  consoleSpeaker?(conversation: ConversationRef, consoleUserId: string): ChatIdentity | undefined;
}

export const chatRolesToken = createToken<ChatRoleReader>(
  'zhin.chat-roles',
  'Read-only chat roles (ADR 0060 §6): roleOf / principalOf / holders / factsOf / subscribe',
);

export interface ChatRoleReaderOptions {
  /** The role resolution (undefined while the stores are not loaded: nothing is held). */
  readonly roles: () => ChatRoleService | undefined;
  /** Scope key of a conversation in the current generation (conversation key, else the endpoint key). */
  readonly conversationKey: (conversation: ConversationRef) => string | undefined;
  readonly subscribe?: (listener: (change: ChatRoleChange) => void) => () => void;
  /** Stored person linked to a Console user id (ADR 0060 §2.4); absent: no Console links. */
  readonly consolePrincipal?: (consoleUserId: string) => string | undefined;
}

const LEVEL_INDEX = (level: ChatRoleLevel) => CHAT_ROLE_LEVELS.indexOf(level);

/** The read side over a {@link ChatRoleService}; the instance provides it as {@link chatRolesToken}. */
export function createChatRoleReader(options: ChatRoleReaderOptions): ChatRoleReader {
  const scopeKey = (scope: ChatScopeRef | undefined): string | undefined => {
    if (!scope || scope.level === 'global') return '';
    try {
      if (scope.level === 'adapter') return normalizeChatRoleScope('adapter', scope.adapter);
      if (scope.level === 'endpoint') {
        if (typeof scope.endpointId !== 'string' || !scope.endpointId || typeof scope.adapter !== 'string' || scope.adapter.includes('/')) return undefined;
        return normalizeChatRoleScope('endpoint', `${scope.adapter}/${scope.endpointId}`);
      }
      return options.conversationKey(scope.conversation);
    } catch { return undefined; }
  };
  const chainOf = (key: string): readonly string[] => key === '' ? [''] : chatScopeChain(key);
  const view = (identity: ChatIdentity, service: ChatRoleService | undefined): ChatPrincipalView => {
    const record = service ? chatPrincipalOf(service.store, identity) : undefined;
    return Object.freeze({
      id: record?.id ?? implicitChatPrincipalId(identity),
      ...(record?.displayName ? { displayName: record.displayName } : {}),
      identities: Object.freeze((record?.identities ?? [identity]).map(held => Object.freeze({ adapter: held.adapter, userId: held.userId }))),
    });
  };
  const api: ChatRoleReader = {
    roleOf(identity, scope) {
      const service = options.roles();
      const key = scopeKey(scope);
      if (!service || key === undefined || !isChatIdentity(identity)) return undefined;
      try { return service.roleAt(identity, key); } catch { return undefined; }
    },
    principalOf(identity) {
      let service: ChatRoleService | undefined;
      try { service = options.roles(); } catch { service = undefined; }
      return view(identity, isChatIdentity(identity) ? service : undefined);
    },
    holders(role, holderOptions = {}) {
      const service = options.roles();
      const key = scopeKey(holderOptions.scope);
      if (!service || key === undefined) return Object.freeze([]);
      const chain = chainOf(key);
      const minimum = holderOptions.level ?? (holderOptions.scope ? 'conversation' : 'global');
      // Per person, the identities the matching grants count for (ADR 0060 Q10: below global
      // only those on the scope's adapter), optionally narrowed to one adapter.
      const seen = new Map<string, { view: ChatPrincipalView; identities: Map<string, ChatIdentity> }>();
      const entries: readonly ChatRoleEntry[] = service.store.list();
      for (const entry of entries) {
        if (!chain.includes(entry.key) || !chatRoleIncludes(entry.role, role)) continue;
        if (LEVEL_INDEX(entry.level as ChatRoleLevel) > LEVEL_INDEX(minimum)) continue;
        const id = chatRoleEntryPrincipalId(entry);
        const stored = entry.principalId ? service.store.principal?.(entry.principalId) : undefined;
        const principal = stored
          ? Object.freeze({ id: stored.id, ...(stored.displayName ? { displayName: stored.displayName } : {}), identities: stored.identities })
          : view(entry, undefined);
        const holder = seen.get(id) ?? { view: principal, identities: new Map<string, ChatIdentity>() };
        for (const identity of principal.identities) {
          if (!chatRoleEntryAppliesTo(entry, identity)) continue;
          if (holderOptions.adapter !== undefined && identity.adapter !== holderOptions.adapter) continue;
          holder.identities.set(`${identity.adapter}\0${identity.userId}`, Object.freeze({ adapter: identity.adapter, userId: identity.userId }));
        }
        seen.set(id, holder);
      }
      return Object.freeze([...seen.values()].filter(holder => holder.identities.size > 0)
        .map(holder => Object.freeze({ ...holder.view, identities: Object.freeze([...holder.identities.values()]) })));
    },
    factsOf(conversation, userId) {
      const key = scopeKey({ level: 'conversation', conversation });
      if (key === undefined) return undefined;
      const adapter = chainOf(key)[1];
      const identity = { adapter, userId };
      if (!adapter || !isChatIdentity(identity)) return undefined;
      const service = options.roles();
      let entries: readonly ChatRoleEntry[] = [];
      let chatPrincipal: string | undefined;
      try {
        chatPrincipal = service?.principalOf(identity).id;
        entries = service?.entriesFor(identity, key) ?? [];
      } catch { entries = []; }
      let chatRole: ChatRole | undefined;
      const levels: Partial<Record<ChatRoleName, ChatRoleLevel>> = {};
      for (const entry of entries) chatRole = higherChatRole(chatRole, entry.role);
      for (const candidate of ['owner', 'admin', 'trusted'] as const) {
        // Entries come sorted global first: the first holder is the topmost level.
        const top = entries.find(entry => chatRoleIncludes(entry.role, candidate));
        if (top) levels[candidate] = top.level as ChatRoleLevel;
      }
      const chatRoleLevels = normalizeChatRoleLevels(levels);
      return Object.freeze({ identity: Object.freeze(identity), ...(chatPrincipal ? { chatPrincipal } : {}),
        ...(chatRole ? { chatRole } : {}), ...(chatRole && chatRoleLevels ? { chatRoleLevels } : {}) });
    },
    subscribe(listener) {
      return options.subscribe ? options.subscribe(listener) : () => undefined;
    },
    consoleSpeaker(conversation, consoleUserId) {
      if (typeof consoleUserId !== 'string' || !consoleUserId || !options.consolePrincipal) return undefined;
      const key = scopeKey({ level: 'conversation', conversation });
      if (key === undefined) return undefined;
      const adapter = chainOf(key)[1];
      if (!adapter) return undefined;
      let principalId: string | undefined;
      let service: ChatRoleService | undefined;
      try { principalId = options.consolePrincipal(consoleUserId); service = options.roles(); } catch { return undefined; }
      if (!principalId || !service) return undefined;
      const held = service.store.principal?.(principalId)?.identities.find(identity => identity.adapter === adapter && isChatIdentity(identity));
      return held ? Object.freeze({ adapter: held.adapter, userId: held.userId }) : undefined;
    },
  };
  return Object.freeze(api);
}
