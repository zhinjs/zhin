/**
 * ADR 0056: chat roles — normalized platform standing, zhin roles at four levels and the
 * platform → zhin mapping rules.
 *
 * - zhin roles: `owner` ⊃ `admin` ⊃ `trusted`, held by a platform identity `(adapter alias, userId)`
 *   at one scope (`''`, `<alias>`, `<alias>/<endpointId>` or a conversation key) and effective at
 *   that scope and every scope under it.
 * - Resolution lives here; storage (the `chat_roles` table, conversation mapping rules) is the
 *   instance's and is plugged in through {@link ChatRoleGrantStore} / {@link ChatRoleSource}.
 * - Every inbound message gets `sender.chatRole` (highest role effective in its conversation) and a
 *   normalized `sender.platform` from {@link createChatRoleSenderEnricher}; downstream code
 *   (permits, Agent policies, group rules, moderation) reads only those two fields.
 */
import {
  isPlatformStandingLevel, normalizePlatformStanding,
  type ConversationRef, type PlatformStanding, type PlatformStandingLevel,
} from '@zhin.js/im-contract';
import {
  childPluginId, featureKeyLevel, formatFeatureResolutionKey, parseFeatureConversationKey, parseFeatureResolutionKey,
  resolveEndpointFeatureKey, rootPluginId,
  type FeatureConfigLevel, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';

export type { PlatformStanding, PlatformStandingLevel } from '@zhin.js/im-contract';

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

export type ChatRoleSourceKind = 'grant' | 'mapping';

export interface ChatRoleEntry extends ChatIdentity {
  readonly level: FeatureConfigLevel;
  /** Normalized scope key (`''` for global). */
  readonly key: string;
  readonly role: ChatRole;
  readonly source: ChatRoleSourceKind;
  readonly grantedBy?: string;
  readonly grantedAt?: number;
  /** Origin hint, e.g. the mapping rule that produced the entry. */
  readonly detail?: string;
}

/** Snapshot parts a live source may read (adapter / account configuration). */
export type ChatRoleSnapshot = Pick<RuntimeSnapshot, 'config' | 'projections' | 'tree'>;

/** Per-message context for live sources (mapping rules). */
export interface ChatRoleContext {
  /** The conversation the message was sent in (mapping results apply only there). */
  readonly conversationKey?: string;
  readonly platform?: PlatformStanding;
  readonly snapshot?: ChatRoleSnapshot;
}

/**
 * Implicit role provider. `entries` answers for one identity along a scope chain; `list` (optional)
 * enumerates what it can for Console listings.
 */
export interface ChatRoleSource {
  readonly name: string;
  entries(identity: ChatIdentity, chain: readonly string[], context: ChatRoleContext): readonly ChatRoleEntry[];
  list?(scopeKey: string, descendants: boolean): readonly ChatRoleEntry[];
}

/** Stored grants (the instance's `chat_roles` table, held in memory). */
export interface ChatRoleGrantStore {
  list(): readonly ChatRoleEntry[];
}

/** Effective roles of one sender in one conversation. */
export interface ChatRoleResolution {
  readonly identity: ChatIdentity;
  readonly conversationKey: string;
  /** Highest role effective in the conversation. */
  readonly role?: ChatRole;
  /** Every entry on the conversation's chain (stored and mapped). */
  readonly entries: readonly ChatRoleEntry[];
}

function highest(entries: readonly ChatRoleEntry[]): ChatRole | undefined {
  let best: ChatRole | undefined;
  for (const entry of entries) best = higherChatRole(best, entry.role);
  return best;
}

/**
 * Resolution over stored grants plus implicit sources (ADR 0056 §2): for a message the chain is
 * conversation → endpoint → adapter → global and the highest role wins.
 */
export class ChatRoleService<TStore extends ChatRoleGrantStore = ChatRoleGrantStore> {
  readonly store: TStore;
  readonly #sources: ChatRoleSource[];

  constructor(options: Readonly<{ store: TStore; sources?: readonly ChatRoleSource[] }>) {
    this.store = options.store;
    this.#sources = [...(options.sources ?? [])];
  }

  addSource(source: ChatRoleSource): () => void {
    this.#sources.push(source);
    return () => { const index = this.#sources.indexOf(source); if (index >= 0) this.#sources.splice(index, 1); };
  }

  /** Entries of `identity` effective at `scopeKey` (own scope and every ancestor). */
  entriesFor(identity: ChatIdentity, scopeKey: string, context: ChatRoleContext = {}): readonly ChatRoleEntry[] {
    const chain = chatScopeChain(scopeKey);
    const stored = this.store.list().filter(entry => entry.adapter === identity.adapter && entry.userId === identity.userId && chain.includes(entry.key));
    const implicit = this.#sources.flatMap(source => {
      try { return source.entries(identity, chain, context); } catch { return []; }
    }).filter(entry => chain.includes(entry.key));
    return Object.freeze([...stored, ...implicit].sort((left, right) => chain.indexOf(left.key) - chain.indexOf(right.key)));
  }

  /** Highest role of `identity` effective at `scopeKey`. */
  roleAt(identity: ChatIdentity, scopeKey: string, context: ChatRoleContext = {}): ChatRole | undefined {
    return highest(this.entriesFor(identity, scopeKey, context));
  }

  hasRole(identity: ChatIdentity, scopeKey: string, role: ChatRole, context: ChatRoleContext = {}): boolean {
    return chatRoleIncludes(this.roleAt(identity, scopeKey, context), role);
  }

  /** Highest role held at a scope strictly above `scopeKey`. */
  roleAbove(identity: ChatIdentity, scopeKey: string, context: ChatRoleContext = {}): ChatRole | undefined {
    return highest(this.entriesFor(identity, scopeKey, context).filter(entry => entry.key !== scopeKey));
  }

  /** Sender roles for a message (`undefined` outside a keyed conversation). */
  effectiveRoles(snapshot: ChatRoleSnapshot, message: unknown): ChatRoleResolution | undefined {
    const subject = chatRoleMessageContext(snapshot, message);
    if (!subject) return undefined;
    const entries = this.entriesFor(subject.identity, subject.context.conversationKey, subject.context);
    const role = highest(entries);
    return Object.freeze({ identity: subject.identity, conversationKey: subject.context.conversationKey, ...(role ? { role } : {}), entries });
  }

  /** Stored and listable implicit entries covering `scopeKey` (and below it with `descendants`). */
  list(scopeKey: string, descendants = false): readonly ChatRoleEntry[] {
    const relevant = (key: string) => chatScopeCovers(key, scopeKey) || (descendants && chatScopeCovers(scopeKey, key));
    const implicit = this.#sources.flatMap(source => {
      try { return source.list?.(scopeKey, descendants) ?? []; } catch { return []; }
    });
    return Object.freeze([...this.store.list(), ...implicit].filter(entry => relevant(entry.key)));
  }

  /**
   * Stored `owner`s of `scopeKey` and its ancestors whose identity is on `adapter`, closest scope
   * first (who to ask for owner approval on an account).
   */
  ownersOf(scopeKey: string, adapter: string): readonly string[] {
    const chain = chatScopeChain(scopeKey);
    const owners = this.store.list()
      .filter(entry => entry.role === 'owner' && entry.adapter === adapter && chain.includes(entry.key))
      .sort((left, right) => chain.indexOf(right.key) - chain.indexOf(left.key));
    return Object.freeze([...new Set(owners.map(entry => entry.userId))]);
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

/** Identity + context of a message's sender; undefined outside a keyed conversation. */
export function chatRoleMessageContext(
  snapshot: ChatRoleSnapshot,
  message: unknown,
): { identity: ChatIdentity; context: ChatRoleContext & { conversationKey: string } } | undefined {
  if (!record(message) || !record(message.conversation) || !record(message.conversation.endpoint)) return undefined;
  const conversation = message.conversation as { endpoint: { id: unknown }; kind?: unknown; id?: unknown };
  if (typeof conversation.endpoint.id !== 'string') return undefined;
  const key = resolveEndpointFeatureKey(snapshot, conversation.endpoint.id, typeof message.endpointId === 'string' ? message.endpointId : undefined, conversation);
  const parsed = key ? parseFeatureConversationKey(key) : undefined;
  if (!key || !parsed) return undefined;
  const sender = record(message.sender) ? message.sender : undefined;
  const identity = { adapter: parsed.adapter, userId: typeof sender?.id === 'string' ? sender.id : '' };
  if (!isChatIdentity(identity)) return undefined;
  const platform = parsed.conversation.kind === 'private' ? undefined : platformStandingOf(sender);
  return { identity, context: { conversationKey: key, snapshot, ...(platform ? { platform } : {}) } };
}

// ============================================================================
// Mapping rules (ADR 0056 §4)
// ============================================================================

export interface ChatRoleMappingMatch {
  /** Normalized standings (any of). */
  readonly standing?: readonly PlatformStandingLevel[];
  /** Platform role ids (any of). */
  readonly role?: readonly string[];
  /** Platform permissions (any of). */
  readonly permission?: readonly string[];
}

/** `grant: 'none'` removes an inherited rule with the same `match`. */
export type ChatRoleMappingGrant = ChatRole | 'none';

export interface ChatRoleMappingRule {
  /** Every given criterion must hold. */
  readonly match: ChatRoleMappingMatch;
  readonly grant: ChatRoleMappingGrant;
}

export type ChatRoleMappingLevel = 'default' | 'adapter' | 'endpoint' | 'conversation';

/** Rules declared at one level. `inherit: false` drops every rule from the levels above (the default rule included). */
export interface ChatRoleMappingLayer {
  readonly level: ChatRoleMappingLevel;
  readonly rules: readonly ChatRoleMappingRule[];
  readonly inherit?: boolean;
}

export interface EffectiveChatRoleMappingRule extends ChatRoleMappingRule {
  readonly level: ChatRoleMappingLevel;
}

/** Built-in default: group owners / admins are `admin` of that conversation. */
export const DEFAULT_CHAT_ROLE_MAPPINGS: readonly ChatRoleMappingRule[] = Object.freeze([
  Object.freeze({ match: Object.freeze({ standing: Object.freeze(['admin', 'owner'] as PlatformStandingLevel[]) }), grant: 'admin' as const }),
]);

const MAX_RULES = 64;
const MAX_VALUES = 64;

function stringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : undefined;
  if (!list || list.length === 0 || list.length > MAX_VALUES) throw new TypeError(`match.${field} must be a non-empty string or list (at most ${MAX_VALUES})`);
  const out = list.map(item => {
    if (typeof item !== 'string' && typeof item !== 'number') throw new TypeError(`match.${field} entries must be strings`);
    const text = String(item).trim();
    if (!text || text.length > 256 || CONTROL.test(text)) throw new TypeError(`match.${field} entries must be 1–256 printable characters`);
    return text;
  });
  return Object.freeze([...new Set(out)].sort());
}

/** Validates one rule; `level` limits grants (`trusted` / `owner` only at the conversation level). */
export function parseChatRoleMappingRule(value: unknown, level: ChatRoleMappingLevel): ChatRoleMappingRule {
  if (!record(value)) throw new TypeError('mapping rule must be an object { match, grant }');
  const unknown = Object.keys(value).filter(key => key !== 'match' && key !== 'grant');
  if (unknown.length) throw new TypeError(`mapping rule has unknown fields: ${unknown.join(', ')}`);
  if (!record(value.match)) throw new TypeError('mapping rule match must be an object');
  const extra = Object.keys(value.match).filter(key => key !== 'standing' && key !== 'role' && key !== 'permission');
  if (extra.length) throw new TypeError(`mapping rule match has unknown fields: ${extra.join(', ')} (expected standing, role, permission)`);
  const standing = stringList(value.match.standing, 'standing');
  if (standing && !standing.every(isPlatformStandingLevel)) throw new TypeError('match.standing must be owner, admin, member or guest');
  const role = stringList(value.match.role, 'role');
  const permission = stringList(value.match.permission, 'permission');
  if (!standing && !role && !permission) throw new TypeError('mapping rule match needs standing, role or permission');
  const grant = value.grant;
  if (grant !== 'none' && !isChatRole(grant)) throw new TypeError('mapping rule grant must be owner, admin, trusted or none');
  if ((grant === 'owner' || grant === 'trusted') && level !== 'conversation') {
    throw new TypeError(`mapping to ${grant} is only allowed in conversation-level rules`);
  }
  return Object.freeze({
    match: Object.freeze({
      ...(standing ? { standing: standing as readonly PlatformStandingLevel[] } : {}),
      ...(role ? { role } : {}),
      ...(permission ? { permission } : {}),
    }),
    grant,
  });
}

/** Parses `roles` (`{ mappings?, inherit? }`) of one level; undefined when absent. Throws TypeError. */
export function parseChatRoleMappingLayer(value: unknown, level: Exclude<ChatRoleMappingLevel, 'default'>): ChatRoleMappingLayer | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new TypeError('roles must be an object { mappings, inherit }');
  const unknown = Object.keys(value).filter(key => key !== 'mappings' && key !== 'inherit');
  if (unknown.length) throw new TypeError(`roles has unknown fields: ${unknown.join(', ')}`);
  if (value.inherit !== undefined && typeof value.inherit !== 'boolean') throw new TypeError('roles.inherit must be a boolean');
  const raw = value.mappings ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_RULES) throw new TypeError(`roles.mappings must be a list of at most ${MAX_RULES} rules`);
  const rules = raw.map((rule, index) => {
    try { return parseChatRoleMappingRule(rule, level); } catch (error) { throw new TypeError(`roles.mappings[${index}]: ${(error as Error).message}`); }
  });
  return Object.freeze({ level, rules: Object.freeze(rules), ...(value.inherit === false ? { inherit: false } : {}) });
}

/** Identity of a rule's `match` (rules with the same identity override each other). */
export function chatRoleMappingMatchKey(match: ChatRoleMappingMatch): string {
  return JSON.stringify([match.standing ?? null, match.role ?? null, match.permission ?? null]);
}

/** Default rule, then each layer appends or overrides same-`match` rules from above; `none` grants drop out. */
export function mergeChatRoleMappings(layers: readonly ChatRoleMappingLayer[]): readonly EffectiveChatRoleMappingRule[] {
  const merged = new Map<string, EffectiveChatRoleMappingRule>();
  for (const layer of [{ level: 'default' as const, rules: DEFAULT_CHAT_ROLE_MAPPINGS }, ...layers]) {
    if (layer.level !== 'default' && 'inherit' in layer && layer.inherit === false) merged.clear();
    for (const rule of layer.rules) {
      // Above the conversation level only `admin` (or `none`) can be granted, whatever the caller passed.
      if ((rule.grant === 'owner' || rule.grant === 'trusted') && layer.level !== 'conversation') continue;
      const key = chatRoleMappingMatchKey(rule.match);
      merged.delete(key);
      merged.set(key, Object.freeze({ ...rule, level: layer.level }));
    }
  }
  return Object.freeze([...merged.values()].filter(rule => rule.grant !== 'none'));
}

export function chatRoleMappingMatches(match: ChatRoleMappingMatch, platform: PlatformStanding | undefined): boolean {
  if (!platform) return false;
  if (match.standing && !match.standing.includes(platform.standing)) return false;
  if (match.role && !(platform.roles ?? []).some(role => match.role!.includes(role.id))) return false;
  if (match.permission && !(platform.permissions ?? []).some(permission => match.permission!.includes(permission))) return false;
  return true;
}

function describeMatch(match: ChatRoleMappingMatch): string {
  return [
    ...(match.standing ? [`standing=${match.standing.join('|')}`] : []),
    ...(match.role ? [`role=${match.role.join('|')}`] : []),
    ...(match.permission ? [`permission=${match.permission.join('|')}`] : []),
  ].join(',');
}

/** Highest grant of the rules matching `platform`, with the rule that produced it. */
export function evaluateChatRoleMappings(
  rules: readonly EffectiveChatRoleMappingRule[],
  platform: PlatformStanding | undefined,
): { role: ChatRole; rule: EffectiveChatRoleMappingRule } | undefined {
  let best: { role: ChatRole; rule: EffectiveChatRoleMappingRule } | undefined;
  for (const rule of rules) {
    if (rule.grant === 'none' || !chatRoleMappingMatches(rule.match, platform)) continue;
    if (!best || RANK[rule.grant] > RANK[best.role]) best = { role: rule.grant, rule };
  }
  return best;
}

/** `mapping:<level> <match>` hint used in listings. */
export function chatRoleMappingDetail(rule: EffectiveChatRoleMappingRule): string {
  return `mapping:${rule.level} ${describeMatch(rule.match)}`;
}

/** Plugin id of an adapter instance alias (the top-level config block). */
function adapterConfig(snapshot: ChatRoleSnapshot | undefined, alias: string): Record<string, unknown> | undefined {
  if (!snapshot) return undefined;
  let value: unknown;
  try { value = snapshot.config.get(childPluginId(rootPluginId(), alias)); } catch { return undefined; }
  return record(value) ? value : undefined;
}

/**
 * Adapter and account layers from the live configuration: `<alias>.roles` and
 * `<alias>.endpoints[i].roles` (endpoint matched by `id`, else `name`). Malformed blocks are
 * skipped here; the configuration schema rejects them on load.
 */
export function configChatRoleMappingLayers(snapshot: ChatRoleSnapshot | undefined, alias: string, endpointId: string | undefined): readonly ChatRoleMappingLayer[] {
  const block = adapterConfig(snapshot, alias);
  if (!block) return [];
  const layers: ChatRoleMappingLayer[] = [];
  try { const layer = parseChatRoleMappingLayer(block.roles, 'adapter'); if (layer) layers.push(layer); } catch { /* rejected by the schema */ }
  if (endpointId !== undefined && Array.isArray(block.endpoints)) {
    const entries = block.endpoints.filter(record);
    const entry = entries.find(item => item.id !== undefined && String(item.id) === endpointId)
      ?? entries.find(item => item.name !== undefined && String(item.name) === endpointId);
    try { const layer = entry ? parseChatRoleMappingLayer(entry.roles, 'endpoint') : undefined; if (layer) layers.push(layer); } catch { /* rejected by the schema */ }
  }
  return layers;
}

export interface MappingChatRoleSourceOptions {
  /** Conversation-level layer (stored by the instance); undefined when none. */
  readonly conversationLayer?: (conversationKey: string) => ChatRoleMappingLayer | undefined;
  /** Remembered recent mapped senders for listings (default 2000 conversations). */
  readonly listLimit?: number;
}

/** Effective rules of a conversation: default → adapter → endpoint (configuration) → conversation (stored). */
export function effectiveChatRoleMappings(
  conversationKey: string,
  snapshot: ChatRoleSnapshot | undefined,
  conversationLayer?: (conversationKey: string) => ChatRoleMappingLayer | undefined,
): readonly EffectiveChatRoleMappingRule[] {
  const parsed = parseFeatureResolutionKey(conversationKey);
  const layers = [...configChatRoleMappingLayers(snapshot, parsed.adapter!, parsed.endpointId)];
  const stored = conversationLayer?.(conversationKey);
  if (stored) layers.push(stored);
  return mergeChatRoleMappings(layers);
}

export type MappingChatRoleSource = ChatRoleSource & {
  /** Remembers a mapped sender of a message for Console listings (results are never stored). */
  record(identity: ChatIdentity, context: ChatRoleContext, now?: number): void;
};

/**
 * ADR 0056 §4: platform standing → zhin role of the message's conversation only, evaluated live
 * from the current message. Listings show recently seen mapped senders (`source: 'mapping'`).
 */
export function createMappingChatRoleSource(options: MappingChatRoleSourceOptions = {}): MappingChatRoleSource {
  const limit = options.listLimit ?? 2000;
  const seen = new Map<string, Map<string, ChatRoleEntry>>();
  const mapped = (identity: ChatIdentity, context: ChatRoleContext): ChatRoleEntry | undefined => {
    const key = context.conversationKey;
    if (!key || chatScopeLevel(key) !== 'conversation' || !context.platform) return undefined;
    if (parseFeatureResolutionKey(key).adapter !== identity.adapter) return undefined;
    const result = evaluateChatRoleMappings(effectiveChatRoleMappings(key, context.snapshot, options.conversationLayer), context.platform);
    if (!result) return undefined;
    return Object.freeze({ level: 'conversation' as const, key, adapter: identity.adapter, userId: identity.userId, role: result.role,
      source: 'mapping' as const, detail: chatRoleMappingDetail(result.rule) });
  };
  return Object.freeze({
    name: 'mapping',
    entries(identity: ChatIdentity, chain: readonly string[], context: ChatRoleContext) {
      if (!context.conversationKey || !chain.includes(context.conversationKey)) return [];
      const entry = mapped(identity, context);
      return entry ? [entry] : [];
    },
    list(scopeKey: string, descendants: boolean) {
      return [...seen].flatMap(([key, users]) => (chatScopeCovers(key, scopeKey) || (descendants && chatScopeCovers(scopeKey, key)))
        ? [...users.values()] : []);
    },
    record(identity: ChatIdentity, context: ChatRoleContext, now = Date.now()) {
      const key = context.conversationKey;
      if (!key) return;
      const entry = mapped(identity, context);
      const users = seen.get(key) ?? new Map<string, ChatRoleEntry>();
      if (entry) users.set(identity.userId, Object.freeze({ ...entry, grantedAt: now }));
      else users.delete(identity.userId);
      seen.delete(key);
      if (users.size) seen.set(key, users);
      while (seen.size > limit) seen.delete(seen.keys().next().value!);
    },
  });
}

// ============================================================================
// Inbound enrichment
// ============================================================================

export interface ChatRoleSenderFields {
  readonly id: string;
  readonly platform?: PlatformStanding;
  readonly chatRole?: ChatRole;
}

/**
 * Inbound sender enricher: drops any adapter-supplied `chatRole`, normalizes `platform` (not in
 * private chats) and sets `chatRole` to the highest role effective in the conversation.
 */
export function createChatRoleSenderEnricher(options: Readonly<{
  roles: () => ChatRoleService | undefined;
  /** Called with each resolved sender (listing of mapped senders). */
  onResolved?: (identity: ChatIdentity, context: ChatRoleContext) => void;
}>) {
  return <TSender extends ChatRoleSenderFields>(
    sender: TSender | undefined, conversation: ConversationRef, snapshot?: RuntimeSnapshot,
  ): TSender | undefined => {
    if (!sender?.id) return sender;
    const { chatRole: _spoofed, platform: _reported, ...rest } = sender as TSender & Record<string, unknown>;
    const platform = conversation.kind === 'private' ? undefined : platformStandingOf(sender);
    const base = { ...rest, ...(platform ? { platform } : {}) } as unknown as TSender;
    const service = options.roles();
    if (!service || !snapshot) return Object.freeze(base);
    const subject = chatRoleMessageContext(snapshot, { conversation, sender: base });
    if (!subject) return Object.freeze(base);
    let role: ChatRole | undefined;
    try {
      role = service.roleAt(subject.identity, subject.context.conversationKey, subject.context);
      options.onResolved?.(subject.identity, subject.context);
    } catch { role = undefined; }
    return Object.freeze({ ...base, ...(role ? { chatRole: role } : {}) });
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
