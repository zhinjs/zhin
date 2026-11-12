/**
 * ADR 0056 §2–§4: zhin chat roles (`owner` ⊃ `admin` ⊃ `trusted`) at four levels.
 *
 * A platform identity `(adapter alias, userId)` holds a role at one scope (`''`, `<alias>`,
 * `<alias>/<endpointId>` or a conversation key); the role is effective at that scope and every
 * scope under it. Stored grants live in the instance-owned `chat_roles` table (never
 * `console_*`), loaded into memory at start and effective immediately. Implicit roles come from
 * pluggable {@link ChatRoleSource}s (configuration today; platform mapping rules later).
 */
import { createHash } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import { normalizePlatformStanding } from '@zhin.js/im-contract';
import {
  featureKeyLevel, formatFeatureResolutionKey, parseFeatureConversationKey, parseFeatureResolutionKey, resolveEndpointFeatureKey,
  type DatabaseHost, type DatabaseHostModel, type FeatureConfigLevel, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';

export const CHAT_ROLE_TABLE = 'chat_roles';
const FIELDS = ['id', 'level', 'scope_key', 'adapter', 'user_id', 'role', 'granted_by', 'granted_at'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];
const ADAPTER_ALIAS = /^[a-z0-9][a-z0-9-]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

export type ChatRole = 'owner' | 'admin' | 'trusted';
export const CHAT_ROLES: readonly ChatRole[] = Object.freeze(['owner', 'admin', 'trusted']);
const RANK: Readonly<Record<ChatRole, number>> = Object.freeze({ trusted: 1, admin: 2, owner: 3 });

/** `owner` ⊃ `admin` ⊃ `trusted`. */
export function chatRoleIncludes(held: ChatRole | undefined, required: ChatRole): boolean {
  return held !== undefined && RANK[held] >= RANK[required];
}

export function isChatRole(value: unknown): value is ChatRole {
  return value === 'owner' || value === 'admin' || value === 'trusted';
}

export interface ChatIdentity {
  /** Adapter instance alias the user id belongs to. */
  readonly adapter: string;
  readonly userId: string;
}

export type ChatRoleSourceKind = 'grant' | 'config' | 'mapping';

export interface ChatRoleEntry extends ChatIdentity {
  readonly level: FeatureConfigLevel;
  /** Normalized scope key (`''` for global). */
  readonly key: string;
  readonly role: ChatRole;
  readonly source: ChatRoleSourceKind;
  readonly grantedBy?: string;
  readonly grantedAt?: number;
  readonly detail?: string;
}

/** Normalized platform standing (ADR 0056 §1), as reported in `sender.platform`. */
export interface ChatPlatformStanding {
  readonly standing?: 'owner' | 'admin' | 'member' | 'guest';
  readonly roles?: readonly Readonly<{ id: string; name?: string }>[];
  readonly permissions?: readonly string[];
}

/** Per-message context for live sources (mapping rules). */
export interface ChatRoleContext {
  /** The conversation the message was sent in (mapping results apply only there). */
  readonly conversationKey?: string;
  readonly platform?: ChatPlatformStanding;
}

/**
 * Implicit role provider. `entries` answers for one identity along a scope chain; `list` (optional)
 * enumerates what it can for Console listings. Plug-in point for mapping rules (ADR 0056 §4).
 */
export interface ChatRoleSource {
  readonly name: string;
  entries(identity: ChatIdentity, chain: readonly string[], context: ChatRoleContext): readonly ChatRoleEntry[];
  list?(scopeKey: string, descendants: boolean): readonly ChatRoleEntry[];
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

const rowId = (level: string, key: string, identity: ChatIdentity) =>
  createHash('sha256').update(JSON.stringify([level, key, identity.adapter, identity.userId])).digest('hex');

export function defineChatRoleTable(database: DatabaseHost): void {
  assertInstanceTable(CHAT_ROLE_TABLE);
  if (!RELATIONAL.includes(database.dialect)) return;
  database.define(CHAT_ROLE_TABLE, {
    // sha256(level, scope_key, adapter, user_id): the ADR's composite primary key.
    id: { type: 'text', length: 64, primary: true, nullable: false },
    level: { type: 'text', nullable: false },
    scope_key: { type: 'text', nullable: false },
    adapter: { type: 'text', nullable: false },
    user_id: { type: 'text', nullable: false },
    role: { type: 'text', nullable: false },
    granted_by: { type: 'text', nullable: true },
    granted_at: { type: 'bigint', nullable: false },
  });
}

/** Stored grants (`chat_roles`), one role per identity and scope. */
export class ChatRoleStore {
  readonly #database?: DatabaseHost;
  readonly #grants = new Map<string, ChatRoleEntry>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: Readonly<{ database?: DatabaseHost }> = {}) { this.#database = options.database; }

  #model(): DatabaseHostModel | undefined {
    const database = this.#database;
    if (!database?.started || !RELATIONAL.includes(database.dialect)) return undefined;
    return database.models.get(CHAT_ROLE_TABLE);
  }

  async load(): Promise<void> {
    const model = this.#model();
    this.#grants.clear();
    if (!model) return;
    for (const row of await model.select(...FIELDS)) {
      try {
        const level = String(row.level) as FeatureConfigLevel;
        const key = normalizeChatRoleScope(level, String(row.scope_key));
        const identity = { adapter: String(row.adapter), userId: String(row.user_id) };
        const role = String(row.role);
        if (!isChatIdentity(identity) || !isChatRole(role)) continue;
        this.#grants.set(rowId(level, key, identity), Object.freeze({ ...identity, level, key, role, source: 'grant' as const,
          ...(typeof row.granted_by === 'string' && row.granted_by ? { grantedBy: row.granted_by } : {}), grantedAt: Number(row.granted_at) }));
      } catch { /* malformed rows grant nothing */ }
    }
  }

  list(): readonly ChatRoleEntry[] { return [...this.#grants.values()]; }

  get(level: FeatureConfigLevel, key: string, identity: ChatIdentity): ChatRoleEntry | undefined {
    return this.#grants.get(rowId(level, key, identity));
  }

  grant(input: Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#serial(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const identity = { adapter: input.adapter, userId: input.userId };
      if (!isChatIdentity(identity) || !isChatRole(input.role)) throw new TypeError('invalid chat role grant');
      const id = rowId(input.level, key, identity);
      const current = this.#grants.get(id);
      if (current?.role === input.role) return 'unchanged' as const;
      const value: ChatRoleEntry = Object.freeze({ ...identity, level: input.level, key, role: input.role, source: 'grant' as const,
        ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: Date.now() });
      const row = { level: value.level, scope_key: key, adapter: value.adapter, user_id: value.userId, role: value.role,
        granted_by: value.grantedBy ?? null, granted_at: value.grantedAt };
      const model = this.#model();
      if (model) {
        if (current) await model.update(row).where({ id });
        else await model.insert({ id, ...row });
      }
      this.#grants.set(id, value);
      return 'saved' as const;
    });
  }

  revoke(input: Readonly<{ level: FeatureConfigLevel; key: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#serial(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const id = rowId(input.level, key, input);
      if (!this.#grants.has(id)) return 'unchanged' as const;
      await this.#model()?.delete().where({ id });
      this.#grants.delete(id);
      return 'saved' as const;
    });
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

/** Effective roles of one sender in one conversation. */
export interface ChatRoleResolution {
  readonly identity: ChatIdentity;
  readonly conversationKey: string;
  /** Highest role effective in the conversation. */
  readonly role?: ChatRole;
  /** Every entry on the conversation's chain (stored, configured and mapped). */
  readonly entries: readonly ChatRoleEntry[];
}

/**
 * Resolution over stored grants plus implicit sources. Callers ask with an identity and a scope
 * (`roleAt` / `hasRole`), or with a message (`effectiveRoles`). Plug-in points for the follow-up
 * work: {@link ChatRoleService.addSource} (mapping rules), {@link ChatRoleContext.platform}
 * (normalized `sender.platform`), and `platformOf` in {@link chatRoleMessageContext}.
 */
export class ChatRoleService {
  readonly store: ChatRoleStore;
  readonly #sources: ChatRoleSource[];

  constructor(options: Readonly<{ store: ChatRoleStore; sources?: readonly ChatRoleSource[] }>) {
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
    let best: ChatRole | undefined;
    for (const entry of this.entriesFor(identity, scopeKey, context)) if (!best || RANK[entry.role] > RANK[best]) best = entry.role;
    return best;
  }

  hasRole(identity: ChatIdentity, scopeKey: string, role: ChatRole, context: ChatRoleContext = {}): boolean {
    return chatRoleIncludes(this.roleAt(identity, scopeKey, context), role);
  }

  /** Highest role held at a scope strictly above `scopeKey`. */
  roleAbove(identity: ChatIdentity, scopeKey: string, context: ChatRoleContext = {}): ChatRole | undefined {
    let best: ChatRole | undefined;
    for (const entry of this.entriesFor(identity, scopeKey, context)) {
      if (entry.key === scopeKey) continue;
      if (!best || RANK[entry.role] > RANK[best]) best = entry.role;
    }
    return best;
  }

  /** Sender roles for a message (`undefined` outside a keyed conversation). */
  effectiveRoles(snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'>, message: unknown): ChatRoleResolution | undefined {
    const subject = chatRoleMessageContext(snapshot, message);
    if (!subject) return undefined;
    const entries = this.entriesFor(subject.identity, subject.context.conversationKey!, subject.context);
    let role: ChatRole | undefined;
    for (const entry of entries) if (!role || RANK[entry.role] > RANK[role]) role = entry.role;
    return Object.freeze({ identity: subject.identity, conversationKey: subject.context.conversationKey!, ...(role ? { role } : {}), entries });
  }

  /** Stored and listable implicit entries covering `scopeKey` (and below it with `descendants`). */
  list(scopeKey: string, descendants = false): readonly ChatRoleEntry[] {
    const relevant = (key: string) => chatScopeCovers(key, scopeKey) || (descendants && chatScopeCovers(scopeKey, key));
    const implicit = this.#sources.flatMap(source => {
      try { return source.list?.(scopeKey, descendants) ?? []; } catch { return []; }
    });
    return Object.freeze([...this.store.list(), ...implicit].filter(entry => relevant(entry.key)));
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The adapter-reported, ingress-normalized `sender.platform` (ADR 0056 §1); nothing else counts. */
export function platformStandingFromSender(sender: unknown): ChatPlatformStanding | undefined {
  return record(sender) ? normalizePlatformStanding(sender.platform) : undefined;
}

/** Identity + context of a message's sender; undefined outside a keyed conversation. */
export function chatRoleMessageContext(
  snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'>,
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
  const platform = parsed.conversation.kind === 'private' ? undefined : platformStandingFromSender(sender);
  return { identity, context: { conversationKey: key, ...(platform ? { platform } : {}) } };
}

export interface ConfigChatRoleSourceOptions {
  /** Account `owner` (legacy `master`) and `trusted` lists from the adapter configuration. */
  readonly resolveOwner: (alias: string, endpointId: string) => string | undefined;
  readonly resolveTrusted: (alias: string, endpointId: string) => readonly string[];
  /** Configured endpoints as `[alias, endpointId]` (for listings). */
  readonly endpoints: () => Iterable<readonly [string, string]>;
  /** `ai.trigger.masters` / `ai.trigger.trusted`: global, any platform. */
  readonly globalOwners: () => readonly string[];
  readonly globalTrusted: () => readonly string[];
}

/** ADR 0056 implicit configuration source: account owner / trusted → endpoint, ai.trigger lists → global. */
export function createConfigChatRoleSource(options: ConfigChatRoleSourceOptions): ChatRoleSource {
  const endpointEntries = (alias: string, endpointId: string): ChatRoleEntry[] => {
    const key = `${alias}/${endpointId}`;
    const owner = options.resolveOwner(alias, endpointId);
    return [
      ...(owner ? [{ level: 'endpoint' as const, key, adapter: alias, userId: owner, role: 'owner' as const, source: 'config' as const, detail: `${alias}.owner` }] : []),
      ...options.resolveTrusted(alias, endpointId).filter(user => user !== owner)
        .map(userId => ({ level: 'endpoint' as const, key, adapter: alias, userId, role: 'trusted' as const, source: 'config' as const, detail: `${alias}.trusted` })),
    ];
  };
  const globalEntries = (): ChatRoleEntry[] => {
    const owners = options.globalOwners();
    return [
      ...owners.map(userId => ({ level: 'global' as const, key: '', adapter: '*', userId, role: 'owner' as const, source: 'config' as const, detail: 'ai.trigger.masters' })),
      ...options.globalTrusted().filter(user => !owners.includes(user))
        .map(userId => ({ level: 'global' as const, key: '', adapter: '*', userId, role: 'trusted' as const, source: 'config' as const, detail: 'ai.trigger.trusted' })),
    ];
  };
  return Object.freeze({
    name: 'config',
    entries(identity: ChatIdentity, chain: readonly string[]) {
      const result: ChatRoleEntry[] = [];
      // ai.trigger lists name user ids without a platform: they match the id on every adapter.
      for (const entry of globalEntries()) if (entry.userId === identity.userId) result.push(Object.freeze({ ...entry, adapter: identity.adapter }));
      const endpoint = chain[2];
      if (endpoint) {
        const parsed = parseFeatureResolutionKey(endpoint);
        for (const entry of endpointEntries(parsed.adapter!, parsed.endpointId!)) {
          if (entry.adapter === identity.adapter && entry.userId === identity.userId) result.push(Object.freeze(entry));
        }
      }
      return result;
    },
    list() {
      const result: ChatRoleEntry[] = globalEntries();
      for (const [alias, endpointId] of options.endpoints()) result.push(...endpointEntries(alias, endpointId));
      return result.map(entry => Object.freeze(entry));
    },
  });
}

export interface PlatformChatRoleMapping {
  /** Off: no platform standing grants anything. */
  readonly enabled: boolean;
  /** Standings mapped to conversation `admin` (default `owner`, `admin`). */
  readonly standings: readonly string[];
}

/**
 * ADR 0056 §4 default mapping: platform group owner / admin → `admin` of that conversation only,
 * evaluated live from the message. `seen` keeps recent senders for Console listings.
 */
export function createPlatformChatRoleSource(mapping: () => PlatformChatRoleMapping, limit = 2000): ChatRoleSource & {
  record(identity: ChatIdentity, context: ChatRoleContext, now?: number): void;
} {
  const seen = new Map<string, Map<string, number>>();
  const mapped = (context: ChatRoleContext): boolean => {
    const current = mapping();
    const standing = context.platform?.standing;
    return current.enabled && !!standing && current.standings.includes(standing);
  };
  return Object.freeze({
    name: 'mapping',
    entries(identity: ChatIdentity, chain: readonly string[], context: ChatRoleContext) {
      const key = context.conversationKey;
      if (!key || !chain.includes(key) || chatScopeLevel(key) !== 'conversation' || !mapped(context)) return [];
      if (parseFeatureResolutionKey(key).adapter !== identity.adapter) return [];
      return [Object.freeze({ level: 'conversation' as const, key, adapter: identity.adapter, userId: identity.userId, role: 'admin' as const,
        source: 'mapping' as const, detail: `platform:${context.platform!.standing}` })];
    },
    list(scopeKey: string, descendants: boolean) {
      if (!mapping().enabled) return [];
      return [...seen].flatMap(([key, users]) => (chatScopeCovers(key, scopeKey) || (descendants && chatScopeCovers(scopeKey, key)))
        ? [...users].map(([userId, at]) => Object.freeze({ level: 'conversation' as const, key, adapter: parseFeatureResolutionKey(key).adapter!, userId,
          role: 'admin' as const, source: 'mapping' as const, grantedAt: at, detail: 'platform standing (seen)' }))
        : []);
    },
    record(identity: ChatIdentity, context: ChatRoleContext, now = Date.now()) {
      const key = context.conversationKey;
      if (!key || !mapped(context)) return;
      const users = seen.get(key) ?? new Map<string, number>();
      users.set(identity.userId, now);
      seen.delete(key);
      seen.set(key, users);
      while (seen.size > limit) seen.delete(seen.keys().next().value!);
    },
  });
}
