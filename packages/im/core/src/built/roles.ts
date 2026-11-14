/**
 * ADR 0056: chat roles — zhin roles at four levels, next to (never derived from) the normalized
 * platform standing.
 *
 * - zhin roles: `owner` ⊃ `admin` ⊃ `trusted`, held by a platform identity `(adapter alias, userId)`
 *   at one scope (`''`, `<alias>`, `<alias>/<endpointId>` or a conversation key) and effective at
 *   that scope and every scope under it. They come only from stored grants (the instance's
 *   `chat_roles` table, including grants migrated from the old configuration lists).
 * - Platform standing (group owner / admin, platform roles and permissions) is *not* converted into
 *   a zhin role (ADR 0056 §4, revised 2026-11-12); it is a separate dimension read by `platform:*`
 *   permits, and the Bot account's own standing by `bot:*` permits.
 * - Every inbound message gets `sender.chatRole` (highest role effective in its conversation) and a
 *   normalized `sender.platform` from {@link createChatRoleSenderEnricher}.
 */
import {
  normalizePlatformStanding,
  type ChatRoleLevels, type ConversationRef, type PlatformStanding, type PlatformStandingLevel,
} from '@zhin.js/im-contract';
import {
  featureKeyLevel, formatFeatureResolutionKey, parseFeatureConversationKey, parseFeatureResolutionKey,
  resolveEndpointFeatureKey,
  type FeatureConfigLevel, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';

export type { PlatformStanding, PlatformStandingLevel } from '@zhin.js/im-contract';
export {
  CHAT_ROLE_LEVELS, chatRoleHeldAt, hostChatRole, isChatRoleLevel, normalizeChatRoleLevels,
  type ChatRoleLevel, type ChatRoleLevels,
} from '@zhin.js/im-contract';

// ============================================================================
// Roles
// ============================================================================

export type ChatRole = 'owner' | 'admin' | 'trusted';
export const CHAT_ROLES: readonly ChatRole[] = Object.freeze(['owner', 'admin', 'trusted']);
const RANK: Readonly<Record<ChatRole, number>> = Object.freeze({ trusted: 1, admin: 2, owner: 3 });

export function isChatRole(value: unknown): value is ChatRole {
  return value === 'owner' || value === 'admin' || value === 'trusted';
}

/** `owner` ⊃ `admin` ⊃ `trusted`. */
export function chatRoleIncludes(held: ChatRole | undefined, required: ChatRole): boolean {
  return held !== undefined && RANK[held] >= RANK[required];
}

/** The higher of two roles. */
export function higherChatRole(left: ChatRole | undefined, right: ChatRole | undefined): ChatRole | undefined {
  if (!left) return right;
  if (!right) return left;
  return RANK[right] > RANK[left] ? right : left;
}

/** Whether a role list (expanded or not, other strings ignored) holds `required`. */
export function chatRolesInclude(roles: readonly string[] | undefined, required: ChatRole): boolean {
  return (roles ?? []).some(role => isChatRole(role) && chatRoleIncludes(role, required));
}

/** `owner` → `[owner, admin, trusted]`, `admin` → `[admin, trusted]`, none → `[]`. */
export function expandChatRole(role: ChatRole | undefined): readonly ChatRole[] {
  return role ? CHAT_ROLES.filter(candidate => chatRoleIncludes(role, candidate)) : [];
}

// ============================================================================
// Identities and scopes
// ============================================================================

const ADAPTER_ALIAS = /^[a-z0-9][a-z0-9-]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

export interface ChatIdentity {
  /** Adapter instance alias the user id belongs to. */
  readonly adapter: string;
  readonly userId: string;
}

export function isChatIdentity(value: unknown): value is ChatIdentity {
  const identity = value as Partial<ChatIdentity> | undefined;
  return !!identity && typeof identity.adapter === 'string' && ADAPTER_ALIAS.test(identity.adapter)
    && typeof identity.userId === 'string' && identity.userId.length > 0 && identity.userId.length <= 256 && !CONTROL.test(identity.userId);
}

/** Validates `level` + `key` and returns the normalized scope key; throws TypeError. */
export function normalizeChatRoleScope(level: unknown, key: unknown): string {
  if (level === 'global') {
    if (key !== undefined && key !== '') throw new TypeError('global scope takes no key');
    return '';
  }
  if (level !== 'adapter' && level !== 'endpoint' && level !== 'conversation') throw new TypeError('level must be global, adapter, endpoint or conversation');
  if (typeof key !== 'string' || !key) throw new TypeError('key is required');
  let normalized: string;
  try { normalized = formatFeatureResolutionKey(parseFeatureResolutionKey(key)); } catch { throw new TypeError(`key does not address the ${level} level`); }
  if (normalized !== key || featureKeyLevel(key) !== level) throw new TypeError(`key does not address the ${level} level`);
  if (!ADAPTER_ALIAS.test(parseFeatureResolutionKey(key).adapter ?? '')) throw new TypeError('key must start with an adapter instance alias');
  return key;
}

/** Scope keys from global down to `key` (`''`, `qq`, `qq/bot`, `qq/bot/group:1`). */
export function chatScopeChain(key: string): readonly string[] {
  const parsed = parseFeatureResolutionKey(key);
  const chain = [''];
  if (parsed.adapter !== undefined) chain.push(parsed.adapter);
  if (parsed.endpointId !== undefined) chain.push(`${parsed.adapter}/${parsed.endpointId}`);
  if (parsed.conversation !== undefined) chain.push(formatFeatureResolutionKey(parsed));
  return Object.freeze(chain);
}

/** Whether scope `upper` is `lower` or one of its ancestors. */
export function chatScopeCovers(upper: string, lower: string): boolean {
  return chatScopeChain(lower).includes(upper);
}

export function chatScopeLevel(key: string): FeatureConfigLevel {
  return key === '' ? 'global' : featureKeyLevel(key);
}

// ============================================================================
// Entries, sources and resolution
// ============================================================================

/** Where an entry comes from: `grant` (the `chat_roles` table). */
export type ChatRoleSourceKind = 'grant';

export interface ChatRoleEntry extends ChatIdentity {
  /**
   * The person holding the grant (ADR 0060 §2.3). `adapter` / `userId` are the identity the grant
   * was written for (kept for rollback); absent on entries without a stored person, which belong
   * to the implicit single-identity person of `adapter` / `userId`.
   */
  readonly principalId?: string;
  readonly level: FeatureConfigLevel;
  /** Normalized scope key (`''` for global). */
  readonly key: string;
  readonly role: ChatRole;
  readonly source: ChatRoleSourceKind;
  readonly grantedBy?: string;
  readonly grantedAt?: number;
}

/** Snapshot parts needed to address a message's conversation. */
export type ChatRoleSnapshot = Pick<RuntimeSnapshot, 'config' | 'projections' | 'tree'>;

/** The conversation a message was sent in, and the sender's platform standing there (informational). */
export interface ChatRoleContext {
  readonly conversationKey?: string;
  readonly platform?: PlatformStanding;
}

/** A stored person (ADR 0060 §2.1) and its platform identities. */
export interface ChatPrincipalRecord {
  readonly id: string;
  readonly displayName?: string;
  readonly identities: readonly ChatIdentity[];
}

/** Stored grants (the instance's `chat_roles` table, held in memory). */
export interface ChatRoleGrantStore {
  list(): readonly ChatRoleEntry[];
  /**
   * The stored person an identity belongs to (ADR 0060 §2.2); undefined: the identity is its own
   * implicit single-identity person.
   */
  principalOf?(identity: ChatIdentity): ChatPrincipalRecord | undefined;
  /** A stored person by id. */
  principal?(id: string): ChatPrincipalRecord | undefined;
}

/** Id of the implicit single-identity person of `identity` (no stored person yet). */
export function implicitChatPrincipalId(identity: ChatIdentity): string {
  return `implicit:${identity.adapter}:${identity.userId}`;
}

/** The person of an identity: the stored one, else its implicit single-identity person. */
export function chatPrincipalOf(store: ChatRoleGrantStore, identity: ChatIdentity): ChatPrincipalRecord {
  const stored = store.principalOf?.(identity);
  if (stored) return stored;
  return Object.freeze({ id: implicitChatPrincipalId(identity),
    identities: Object.freeze([Object.freeze({ adapter: identity.adapter, userId: identity.userId })]) });
}

/** Id of the person holding `entry`. */
export function chatRoleEntryPrincipalId(entry: ChatRoleEntry): string {
  return entry.principalId ?? implicitChatPrincipalId(entry);
}

/** Adapter alias a scope key belongs to (`undefined` for global). */
export function chatScopeAdapter(key: string): string | undefined {
  return key === '' ? undefined : chatScopeChain(key)[1];
}

/**
 * ADR 0060 §2.3 / Q10: a grant below global only counts for the person's identities on the
 * scope's own adapter; a global grant counts for every identity of the person.
 */
export function chatRoleEntryAppliesTo(entry: Pick<ChatRoleEntry, 'key'>, identity: ChatIdentity): boolean {
  return entry.key === '' || chatScopeAdapter(entry.key) === identity.adapter;
}

/** Effective roles of one sender in one conversation. */
export interface ChatRoleResolution {
  readonly identity: ChatIdentity;
  readonly conversationKey: string;
  /** Highest role effective in the conversation. */
  readonly role?: ChatRole;
  /** Every stored entry on the conversation's chain. */
  readonly entries: readonly ChatRoleEntry[];
}

/** Per role, the level of the topmost entry holding it (entries sorted global first). */
function chatRoleLevelsOf(entries: readonly ChatRoleEntry[]): ChatRoleLevels {
  const levels: Partial<Record<ChatRole, FeatureConfigLevel>> = {};
  for (const role of CHAT_ROLES) {
    const top = entries.find(entry => chatRoleIncludes(entry.role, role));
    if (top) levels[role] = top.level;
  }
  return Object.freeze(levels);
}

function highest(entries: readonly ChatRoleEntry[]): ChatRole | undefined {
  let best: ChatRole | undefined;
  for (const entry of entries) best = higherChatRole(best, entry.role);
  return best;
}

/**
 * Resolution over stored grants (ADR 0056 §2): for a message the chain is
 * conversation → endpoint → adapter → global and the highest role wins.
 */
export class ChatRoleService<TStore extends ChatRoleGrantStore = ChatRoleGrantStore> {
  readonly store: TStore;

  constructor(options: Readonly<{ store: TStore }>) {
    this.store = options.store;
  }

  /** The person `identity` belongs to (ADR 0060 §2): stored, else its implicit single-identity person. */
  principalOf(identity: ChatIdentity): ChatPrincipalRecord {
    return chatPrincipalOf(this.store, identity);
  }

  /**
   * Every stored entry of the person `identity` belongs to that counts for `identity` (any scope):
   * global grants and grants at scopes of the identity's own adapter (ADR 0060 Q10).
   */
  heldBy(identity: ChatIdentity): readonly ChatRoleEntry[] {
    const principal = this.principalOf(identity).id;
    return Object.freeze(this.store.list().filter(entry => chatRoleEntryPrincipalId(entry) === principal && chatRoleEntryAppliesTo(entry, identity)));
  }

  /**
   * Entries of `identity` effective at `scopeKey` (own scope and every ancestor): the grants of
   * the person it belongs to, below global only those on the identity's own adapter (ADR 0060 Q10).
   */
  entriesFor(identity: ChatIdentity, scopeKey: string): readonly ChatRoleEntry[] {
    const chain = chatScopeChain(scopeKey);
    const stored = this.heldBy(identity).filter(entry => chain.includes(entry.key));
    return Object.freeze([...stored].sort((left, right) => chain.indexOf(left.key) - chain.indexOf(right.key)));
  }

  /** Highest role of `identity` effective at `scopeKey`. */
  roleAt(identity: ChatIdentity, scopeKey: string): ChatRole | undefined {
    return highest(this.entriesFor(identity, scopeKey));
  }

  hasRole(identity: ChatIdentity, scopeKey: string, role: ChatRole): boolean {
    return chatRoleIncludes(this.roleAt(identity, scopeKey), role);
  }

  /**
   * Per role, the topmost level at which `identity` holds that role (or a higher one) on the chain
   * of `scopeKey` (`sender.chatRoleLevels`).
   */
  levelsFor(identity: ChatIdentity, scopeKey: string): ChatRoleLevels {
    return chatRoleLevelsOf(this.entriesFor(identity, scopeKey));
  }

  /** Highest role held at a scope strictly above `scopeKey`. */
  roleAbove(identity: ChatIdentity, scopeKey: string): ChatRole | undefined {
    return highest(this.entriesFor(identity, scopeKey).filter(entry => entry.key !== scopeKey));
  }

  /** Sender roles for a message (`undefined` outside a keyed conversation). */
  effectiveRoles(snapshot: ChatRoleSnapshot, message: unknown): ChatRoleResolution | undefined {
    const subject = chatRoleMessageContext(snapshot, message);
    if (!subject) return undefined;
    const entries = this.entriesFor(subject.identity, subject.context.conversationKey);
    const role = highest(entries);
    return Object.freeze({ identity: subject.identity, conversationKey: subject.context.conversationKey, ...(role ? { role } : {}), entries });
  }

  /** Stored entries covering `scopeKey` (and below it with `descendants`). */
  list(scopeKey: string, descendants = false): readonly ChatRoleEntry[] {
    const relevant = (key: string) => chatScopeCovers(key, scopeKey) || (descendants && chatScopeCovers(scopeKey, key));
    return Object.freeze(this.store.list().filter(entry => relevant(entry.key)));
  }

  /**
   * Stored `owner`s of `scopeKey` and its ancestors whose identity is on `adapter`, closest scope
   * first (who to ask for owner approval on an account).
   */
  ownersOf(scopeKey: string, adapter: string): readonly string[] {
    const chain = chatScopeChain(scopeKey);
    const owners = this.store.list()
      .filter(entry => entry.role === 'owner' && chain.includes(entry.key))
      .sort((left, right) => chain.indexOf(right.key) - chain.indexOf(left.key));
    const userIds: string[] = [];
    for (const entry of owners) {
      // The person's identities on `adapter` (a stored person's, else the grant's own identity).
      const principal = entry.principalId ? this.store.principal?.(entry.principalId) : undefined;
      for (const identity of principal?.identities ?? [{ adapter: entry.adapter, userId: entry.userId }]) {
        if (identity.adapter !== adapter || !chatRoleEntryAppliesTo(entry, identity)) continue;
        if (!userIds.includes(identity.userId)) userIds.push(identity.userId);
      }
    }
    return Object.freeze(userIds);
  }
}

// ============================================================================
// Platform standing
// ============================================================================

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Normalized platform standing of a sender (`sender.platform`, ADR 0056 §1). */
export function platformStandingOf(sender: unknown): PlatformStanding | undefined {
  return record(sender) ? normalizePlatformStanding(sender.platform) : undefined;
}

/** `platform:admin` is met by `admin` and `owner` standings, `platform:owner` only by `owner`. */
export function platformStandingIncludes(held: PlatformStandingLevel | undefined, required: 'owner' | 'admin'): boolean {
  return required === 'owner' ? held === 'owner' : held === 'owner' || held === 'admin';
}

/**
 * Identity + context of a message's sender. `context.conversationKey` is the conversation key, or —
 * when the conversation cannot be keyed (unknown kind, an id that cannot be part of a key) — the
 * receiving endpoint's key, so roles granted at the endpoint level and above still resolve.
 * Threads / topics (`conversation.threadId`) share their parent conversation's key, and a platform
 * container (`conversation.parent`, e.g. a guild) adds no level (ADR 0056 §2).
 * Undefined when not even the endpoint can be addressed.
 */
export function chatRoleMessageContext(
  snapshot: ChatRoleSnapshot,
  message: unknown,
): { identity: ChatIdentity; context: ChatRoleContext & { conversationKey: string } } | undefined {
  if (!record(message) || !record(message.conversation) || !record(message.conversation.endpoint)) return undefined;
  const conversation = message.conversation as { endpoint: { id: unknown }; kind?: unknown; id?: unknown };
  if (typeof conversation.endpoint.id !== 'string') return undefined;
  const key = resolveEndpointFeatureKey(snapshot, conversation.endpoint.id, typeof message.endpointId === 'string' ? message.endpointId : undefined, conversation);
  if (!key) return undefined;
  let adapter: string | undefined;
  try { adapter = parseFeatureResolutionKey(key).adapter; } catch { return undefined; }
  if (!adapter) return undefined;
  const parsed = parseFeatureConversationKey(key);
  const sender = record(message.sender) ? message.sender : undefined;
  const identity = { adapter, userId: typeof sender?.id === 'string' ? sender.id : '' };
  if (!isChatIdentity(identity)) return undefined;
  const kind = parsed?.conversation.kind ?? conversation.kind;
  const platform = kind === 'private' ? undefined : platformStandingOf(sender);
  return { identity, context: { conversationKey: key, ...(platform ? { platform } : {}) } };
}

// ============================================================================
// Inbound enrichment
// ============================================================================

export interface ChatRoleSenderFields {
  readonly id: string;
  readonly name?: string;
  readonly platform?: PlatformStanding;
  readonly chatRole?: ChatRole;
  readonly chatRoleLevels?: ChatRoleLevels;
  /** The person the sender's identity belongs to (ADR 0060 §2.3). Set by the Runtime only. */
  readonly chatPrincipal?: string;
}

/** One inbound sighting of an identity (ADR 0060 §2.2 `last_seen_at`; never used for authorization). */
export interface ChatIdentitySighting {
  readonly identity: ChatIdentity;
  /** The conversation key (or the endpoint key when the conversation cannot be keyed). */
  readonly scopeKey: string;
  readonly displayName?: string;
}

/**
 * Inbound sender enricher: drops any adapter-supplied `chatRole` / `chatRoleLevels`, normalizes
 * `platform` (not in private chats) and sets `chatRole` to the highest role effective in the
 * conversation and `chatRoleLevels` to where each role comes from.
 */
export function createChatRoleSenderEnricher(options: Readonly<{
  roles: () => ChatRoleService | undefined;
  /** Told about every addressable sender (display name cache, recent speakers); errors are ignored. */
  observe?: (sighting: ChatIdentitySighting) => void;
}>) {
  return <TSender extends ChatRoleSenderFields>(
    sender: TSender | undefined, conversation: ConversationRef, snapshot?: RuntimeSnapshot,
  ): TSender | undefined => {
    if (!sender?.id) return sender;
    // Adapters and plugins never set the Runtime's facts: `chatRole`, `chatRoleLevels` and
    // `chatPrincipal` they supply are dropped (ADR 0060 §2.3).
    const {
      chatRole: _spoofed, chatRoleLevels: _spoofedLevels, chatPrincipal: _spoofedPrincipal, platform: _reported, ...rest
    } = sender as TSender & Record<string, unknown>;
    const platform = conversation.kind === 'private' ? undefined : platformStandingOf(sender);
    const base = { ...rest, ...(platform ? { platform } : {}) } as unknown as TSender;
    const service = options.roles();
    if (!service || !snapshot) return Object.freeze(base);
    const subject = chatRoleMessageContext(snapshot, { conversation, sender: base });
    if (!subject) return Object.freeze(base);
    let entries: readonly ChatRoleEntry[];
    let principal: string | undefined;
    try {
      principal = service.principalOf(subject.identity).id;
      entries = service.entriesFor(subject.identity, subject.context.conversationKey);
    } catch { entries = []; }
    if (options.observe) {
      try {
        const name = typeof base.name === 'string' && base.name ? base.name : undefined;
        options.observe(Object.freeze({ identity: subject.identity, scopeKey: subject.context.conversationKey, ...(name ? { displayName: name } : {}) }));
      } catch { /* a sighting never breaks a message */ }
    }
    const role = highest(entries);
    return Object.freeze({ ...base, ...(principal ? { chatPrincipal: principal } : {}),
      ...(role ? { chatRole: role, chatRoleLevels: chatRoleLevelsOf(entries) } : {}) });
  };
}

// ============================================================================
// Prompt label hygiene
// ============================================================================

// 空白与零宽字符（不含 U+200D：会破坏 emoji ZWJ 序列）。
const SPOOF_GAP = '[\\s\\u200B\\u200C\\u2060\\uFEFF]';
const spoofWord = (word: string): string => word.split('').join(`${SPOOF_GAP}*`);
const SPOOFED_LABEL_RE = new RegExp(
  `\\[(?=${SPOOF_GAP}*(?:${spoofWord('sender')}|${spoofWord('origin')})${SPOOF_GAP}*[:：])`,
  'gi',
);

/**
 * 转义用户正文里所有自造的 `[sender:` / `[origin:` 标签（任意位置、大小写不敏感，
 * 容忍 `[ sender :`、零宽字符、全角冒号）。命中时把开头的 ASCII `[` 换成全角 `［`，
 * 其余原样保留：模型仍能看出这是用户文本，但它不再是权威标签。
 * 幂等（已转义文本再次调用不变），不再剥离开头，也不 trim 原文空白。
 */
export function stripUserSpoofedSenderPrefix(rawContent: string): string {
  return rawContent.replace(SPOOFED_LABEL_RE, '［');
}
