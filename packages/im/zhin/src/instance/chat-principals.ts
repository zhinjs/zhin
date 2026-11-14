/**
 * ADR 0060 §2: people behind chat identities, stored in the project database (instance tables).
 *
 * - `chat_principals`: a person (`cp_` + 128 random bits, base32) with an operator-given name.
 * - `chat_identities`: one row per platform identity `(adapter alias, user_id)` (primary key: their
 *   hash). `principal_id` is the person it belongs to — at most one; NULL is the identity's own
 *   implicit single-identity person (a row exists for every recent speaker because the row also
 *   caches `last_seen_at` / `last_display_name` for the Console's pickers, ADR 0060 Q11; that cache
 *   never takes part in authorization and is cleared after 90 days).
 * - `chat_principal_console_links`: one Console user ↔ one person (ADR 0060 Q3), with the Console
 *   display name cached for showing who granted a role (Q12). A link never carries permissions.
 *
 * This module only stores; the operations that also move role grants (merge, split, bind, import)
 * run through {@link ChatRoleStore} under its write queue.
 */
import { createHash, randomBytes } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import type { ChatIdentity, ChatPrincipalRecord } from '@zhin.js/core';
import type { DatabaseHost, DatabaseHostModel } from '@zhin.js/plugin-runtime';

export const CHAT_PRINCIPAL_TABLE = 'chat_principals';
export const CHAT_IDENTITY_TABLE = 'chat_identities';
export const CHAT_PRINCIPAL_LINK_TABLE = 'chat_principal_console_links';
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

/** ADR 0060 Q11: identities seen within this window are offered as recent speakers; older display names are cleared. */
export const CHAT_IDENTITY_RETENTION_MS = 90 * 24 * 60 * 60_000;
/** Sightings of the same identity within this window (same name and scope) are not written again. */
export const CHAT_IDENTITY_SIGHTING_THROTTLE_MS = 10 * 60_000;

export type ChatIdentityLinkMethod = 'implicit' | 'code' | 'manual' | 'import';
export type ChatConsoleLinkVia = 'code' | 'manual' | 'import';
const LINK_METHODS: readonly string[] = ['implicit', 'code', 'manual', 'import'];
const LINK_VIAS: readonly string[] = ['code', 'manual', 'import'];

export interface StoredChatPrincipal {
  readonly id: string;
  readonly displayName?: string;
  readonly createdBy?: string;
  readonly createdAt: number;
}

export interface StoredChatIdentity extends ChatIdentity {
  readonly principalId?: string;
  readonly linkMethod?: ChatIdentityLinkMethod;
  readonly linkedBy?: string;
  readonly linkedAt?: number;
  readonly lastSeenAt?: number;
  readonly lastDisplayName?: string;
  /** Conversation (or endpoint) key of the last sighting. */
  readonly lastScopeKey?: string;
}

export interface StoredChatConsoleLink {
  readonly principalId: string;
  readonly consoleUserId: string;
  readonly consoleDisplayName?: string;
  readonly linkedAt: number;
  readonly linkedVia: ChatConsoleLinkVia;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** `cp_` + 128 random bits in base32 (26 symbols). */
export function newChatPrincipalId(): string {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return `cp_${out}`;
}

export function isChatPrincipalId(value: unknown): value is string {
  return typeof value === 'string' && /^cp_[a-z2-7]{26}$/u.test(value);
}

const identityKey = (identity: ChatIdentity) => `${identity.adapter}\u0000${identity.userId}`;
const identityRowId = (identity: ChatIdentity) =>
  createHash('sha256').update(JSON.stringify([identity.adapter, identity.userId])).digest('hex');

const CONTROL = /[\u0000-\u001f\u007f]/gu;

/** Display names: control characters removed, trimmed, at most 64 characters; empty → undefined. */
export function cleanChatDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL, '').trim().slice(0, 64);
  return cleaned || undefined;
}

export function defineChatPrincipalTables(database: DatabaseHost): void {
  for (const table of [CHAT_PRINCIPAL_TABLE, CHAT_IDENTITY_TABLE, CHAT_PRINCIPAL_LINK_TABLE]) assertInstanceTable(table);
  if (!RELATIONAL.includes(database.dialect)) return;
  database.define(CHAT_PRINCIPAL_TABLE, {
    id: { type: 'text', length: 32, primary: true, nullable: false },
    display_name: { type: 'text', nullable: true },
    created_by: { type: 'text', nullable: true },
    created_at: { type: 'bigint', nullable: false },
  });
  database.define(CHAT_IDENTITY_TABLE, {
    // sha256(adapter, user_id): the ADR's composite primary key.
    id: { type: 'text', length: 64, primary: true, nullable: false },
    adapter: { type: 'text', nullable: false },
    user_id: { type: 'text', nullable: false },
    principal_id: { type: 'text', nullable: true },
    link_method: { type: 'text', nullable: true },
    linked_by: { type: 'text', nullable: true },
    linked_at: { type: 'bigint', nullable: true },
    last_seen_at: { type: 'bigint', nullable: true },
    last_display_name: { type: 'text', nullable: true },
    last_scope_key: { type: 'text', nullable: true },
  });
  database.define(CHAT_PRINCIPAL_LINK_TABLE, {
    principal_id: { type: 'text', length: 32, primary: true, nullable: false },
    console_user_id: { type: 'text', length: 128, unique: true, nullable: false },
    console_display_name: { type: 'text', nullable: true },
    linked_at: { type: 'bigint', nullable: false },
    linked_via: { type: 'text', nullable: false },
  });
}

function modelOf(database: DatabaseHost | undefined, table: string): DatabaseHostModel | undefined {
  if (!database?.started || !RELATIONAL.includes(database.dialect)) return undefined;
  return database.models.get(table);
}

const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const time = (value: unknown): number | undefined => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? number : undefined;
};

/**
 * In-memory view of the three tables with write-through. Writes go to the database when the tables
 * exist and stay in memory otherwise (a non-relational project database: the role store refuses
 * the operations that must persist). Callers serialize writes ({@link ChatRoleStore.exclusive}).
 */
export class ChatPrincipalStore {
  readonly #database?: DatabaseHost;
  readonly #now: () => number;
  readonly #principals = new Map<string, StoredChatPrincipal>();
  readonly #identities = new Map<string, StoredChatIdentity>();
  readonly #links = new Map<string, StoredChatConsoleLink>();

  constructor(options: Readonly<{ database?: DatabaseHost; now?: () => number }> = {}) {
    this.#database = options.database;
    this.#now = options.now ?? Date.now;
  }

  now(): number { return this.#now(); }

  #model(table: string): DatabaseHostModel | undefined { return modelOf(this.#database, table); }

  /** Whether writes are saved (always for the in-memory store without a database). */
  get persistent(): boolean {
    return !this.#database || [CHAT_PRINCIPAL_TABLE, CHAT_IDENTITY_TABLE, CHAT_PRINCIPAL_LINK_TABLE].every(table => this.#model(table) !== undefined);
  }

  async load(): Promise<void> {
    this.#principals.clear();
    this.#identities.clear();
    this.#links.clear();
    const principals = this.#model(CHAT_PRINCIPAL_TABLE);
    const identities = this.#model(CHAT_IDENTITY_TABLE);
    const links = this.#model(CHAT_PRINCIPAL_LINK_TABLE);
    if (principals) {
      for (const row of await principals.select('id', 'display_name', 'created_by', 'created_at')) {
        if (!isChatPrincipalId(row.id)) continue;
        const displayName = cleanChatDisplayName(row.display_name);
        const createdBy = text(row.created_by);
        this.#principals.set(row.id, Object.freeze({ id: row.id, ...(displayName ? { displayName } : {}),
          ...(createdBy ? { createdBy } : {}), createdAt: time(row.created_at) ?? 0 }));
      }
    }
    if (identities) {
      for (const row of await identities.select('adapter', 'user_id', 'principal_id', 'link_method', 'linked_by', 'linked_at',
        'last_seen_at', 'last_display_name', 'last_scope_key')) {
        const adapter = text(row.adapter);
        const userId = text(row.user_id);
        if (!adapter || !userId) continue;
        const principalId = text(row.principal_id);
        this.#identities.set(identityKey({ adapter, userId }), this.#freezeIdentity({
          adapter, userId,
          // A dangling person id (deleted person): the identity is its own implicit person again.
          ...(principalId && this.#principals.has(principalId) ? { principalId } : {}),
          ...(LINK_METHODS.includes(String(row.link_method)) ? { linkMethod: row.link_method as ChatIdentityLinkMethod } : {}),
          ...(text(row.linked_by) ? { linkedBy: text(row.linked_by)! } : {}),
          ...(time(row.linked_at) ? { linkedAt: time(row.linked_at)! } : {}),
          ...(time(row.last_seen_at) ? { lastSeenAt: time(row.last_seen_at)! } : {}),
          ...(cleanChatDisplayName(row.last_display_name) ? { lastDisplayName: cleanChatDisplayName(row.last_display_name)! } : {}),
          ...(text(row.last_scope_key) ? { lastScopeKey: text(row.last_scope_key)! } : {}),
        }));
      }
    }
    if (links) {
      const users = new Set<string>();
      for (const row of await links.select('principal_id', 'console_user_id', 'console_display_name', 'linked_at', 'linked_via')) {
        const principalId = text(row.principal_id);
        const consoleUserId = text(row.console_user_id);
        if (!principalId || !consoleUserId || !this.#principals.has(principalId) || users.has(consoleUserId)) continue;
        users.add(consoleUserId);
        const consoleDisplayName = cleanChatDisplayName(row.console_display_name);
        this.#links.set(principalId, Object.freeze({ principalId, consoleUserId, ...(consoleDisplayName ? { consoleDisplayName } : {}),
          linkedAt: time(row.linked_at) ?? 0, linkedVia: LINK_VIAS.includes(String(row.linked_via)) ? row.linked_via as ChatConsoleLinkVia : 'manual' }));
      }
    }
  }

  #freezeIdentity(value: StoredChatIdentity): StoredChatIdentity { return Object.freeze({ ...value }); }

  // ---------------------------------------------------------------------- reads

  principals(): readonly StoredChatPrincipal[] { return [...this.#principals.values()]; }
  identities(): readonly StoredChatIdentity[] { return [...this.#identities.values()]; }
  links(): readonly StoredChatConsoleLink[] { return [...this.#links.values()]; }

  stored(id: string): StoredChatPrincipal | undefined { return this.#principals.get(id); }

  identity(identity: ChatIdentity): StoredChatIdentity | undefined { return this.#identities.get(identityKey(identity)); }

  /** Identities of a stored person, in the order they were stored. */
  identitiesOf(principalId: string): readonly StoredChatIdentity[] {
    return [...this.#identities.values()].filter(identity => identity.principalId === principalId);
  }

  /** The stored person (with its identities) by id. */
  principal(id: string): ChatPrincipalRecord | undefined {
    const stored = this.#principals.get(id);
    if (!stored) return undefined;
    return Object.freeze({ id, ...(stored.displayName ? { displayName: stored.displayName } : {}),
      identities: Object.freeze(this.identitiesOf(id).map(identity => Object.freeze({ adapter: identity.adapter, userId: identity.userId }))) });
  }

  principalOf(identity: ChatIdentity): ChatPrincipalRecord | undefined {
    const principalId = this.identity(identity)?.principalId;
    return principalId ? this.principal(principalId) : undefined;
  }

  linkOf(principalId: string): StoredChatConsoleLink | undefined { return this.#links.get(principalId); }

  linkOfConsoleUser(consoleUserId: string): StoredChatConsoleLink | undefined {
    for (const link of this.#links.values()) if (link.consoleUserId === consoleUserId) return link;
    return undefined;
  }

  // ---------------------------------------------------------------------- writes (serialized by the caller)

  async createPrincipal(input: Readonly<{ displayName?: string; createdBy?: string; id?: string }> = {}): Promise<string> {
    const id = input.id && isChatPrincipalId(input.id) && !this.#principals.has(input.id) ? input.id : newChatPrincipalId();
    const displayName = cleanChatDisplayName(input.displayName);
    const createdBy = input.createdBy?.slice(0, 256);
    const value: StoredChatPrincipal = Object.freeze({ id, ...(displayName ? { displayName } : {}), ...(createdBy ? { createdBy } : {}), createdAt: this.#now() });
    await this.#model(CHAT_PRINCIPAL_TABLE)?.insert({ id, display_name: displayName ?? null, created_by: createdBy ?? null, created_at: value.createdAt });
    this.#principals.set(id, value);
    return id;
  }

  async renamePrincipal(id: string, displayName: string | undefined): Promise<'saved' | 'unchanged'> {
    const current = this.#principals.get(id);
    if (!current) throw new RangeError('unknown chat principal');
    const name = cleanChatDisplayName(displayName);
    if (current.displayName === name) return 'unchanged';
    await this.#model(CHAT_PRINCIPAL_TABLE)?.update({ display_name: name ?? null }).where({ id });
    const { displayName: _previous, ...rest } = current;
    this.#principals.set(id, Object.freeze({ ...rest, ...(name ? { displayName: name } : {}) }));
    return 'saved';
  }

  /** Removes a person with no identity left (and its Console link). */
  async deletePrincipal(id: string): Promise<void> {
    await this.deleteLink(id);
    await this.#model(CHAT_PRINCIPAL_TABLE)?.delete().where({ id });
    this.#principals.delete(id);
  }

  async #upsertIdentity(next: StoredChatIdentity): Promise<void> {
    const key = identityKey(next);
    const model = this.#model(CHAT_IDENTITY_TABLE);
    if (model) {
      const row = {
        adapter: next.adapter, user_id: next.userId, principal_id: next.principalId ?? null, link_method: next.linkMethod ?? null,
        linked_by: next.linkedBy ?? null, linked_at: next.linkedAt ?? null, last_seen_at: next.lastSeenAt ?? null,
        last_display_name: next.lastDisplayName ?? null, last_scope_key: next.lastScopeKey ?? null,
      };
      if (this.#identities.has(key)) await model.update(row).where({ id: identityRowId(next) });
      else await model.insert({ id: identityRowId(next), ...row });
    }
    this.#identities.set(key, this.#freezeIdentity(next));
  }

  /** Puts `identity` under `principalId` (the person must exist); the sighting cache is kept. */
  async assignIdentity(identity: ChatIdentity, principalId: string, link: Readonly<{ method: ChatIdentityLinkMethod; by?: string }>): Promise<void> {
    if (!this.#principals.has(principalId)) throw new RangeError('unknown chat principal');
    const current = this.identity(identity);
    await this.#upsertIdentity({ ...(current ?? {}), adapter: identity.adapter, userId: identity.userId, principalId,
      linkMethod: link.method, ...(link.by ? { linkedBy: link.by.slice(0, 256) } : {}), linkedAt: this.#now() });
  }

  /** Records an inbound sighting (display name cache, recent speakers). */
  async recordSighting(identity: ChatIdentity, sighting: Readonly<{ at: number; displayName?: string; scopeKey?: string }>): Promise<void> {
    const current = this.identity(identity);
    const displayName = cleanChatDisplayName(sighting.displayName);
    const { lastDisplayName: _name, lastScopeKey: _scope, ...rest } = current ?? { adapter: identity.adapter, userId: identity.userId };
    await this.#upsertIdentity({ ...rest, adapter: identity.adapter, userId: identity.userId, lastSeenAt: sighting.at,
      ...(displayName ? { lastDisplayName: displayName } : current?.lastDisplayName ? { lastDisplayName: current.lastDisplayName } : {}),
      ...(sighting.scopeKey ? { lastScopeKey: sighting.scopeKey.slice(0, 512) } : {}) });
  }

  /**
   * ADR 0060 Q11: identities not seen for 90 days lose their display name and scope cache; rows
   * that carry nothing else (no person) are removed.
   */
  async expireSightings(now = this.#now()): Promise<number> {
    let changed = 0;
    const model = this.#model(CHAT_IDENTITY_TABLE);
    for (const identity of [...this.#identities.values()]) {
      if (identity.lastSeenAt === undefined || now - identity.lastSeenAt < CHAT_IDENTITY_RETENTION_MS) continue;
      if (!identity.principalId) {
        await model?.delete().where({ id: identityRowId(identity) });
        this.#identities.delete(identityKey(identity));
        changed += 1;
        continue;
      }
      if (identity.lastDisplayName === undefined && identity.lastScopeKey === undefined) continue;
      const { lastDisplayName: _name, lastScopeKey: _scope, ...rest } = identity;
      await this.#upsertIdentity(rest);
      changed += 1;
    }
    return changed;
  }

  async setLink(link: Readonly<{ principalId: string; consoleUserId: string; consoleDisplayName?: string; linkedVia: ChatConsoleLinkVia }>): Promise<void> {
    if (!this.#principals.has(link.principalId)) throw new RangeError('unknown chat principal');
    const holder = this.linkOfConsoleUser(link.consoleUserId);
    if (holder && holder.principalId !== link.principalId) throw new RangeError('console user already linked');
    const consoleDisplayName = cleanChatDisplayName(link.consoleDisplayName);
    const value: StoredChatConsoleLink = Object.freeze({ principalId: link.principalId, consoleUserId: link.consoleUserId.slice(0, 128),
      ...(consoleDisplayName ? { consoleDisplayName } : {}), linkedAt: this.#now(), linkedVia: link.linkedVia });
    const model = this.#model(CHAT_PRINCIPAL_LINK_TABLE);
    const row = { console_user_id: value.consoleUserId, console_display_name: consoleDisplayName ?? null, linked_at: value.linkedAt, linked_via: value.linkedVia };
    if (model) {
      if (this.#links.has(link.principalId)) await model.update(row).where({ principal_id: link.principalId });
      else await model.insert({ principal_id: link.principalId, ...row });
    }
    this.#links.set(link.principalId, value);
  }

  /** Refreshes the cached Console display name (Q12); no-op without a link or when unchanged. */
  async refreshConsoleDisplayName(consoleUserId: string, displayName: string | undefined): Promise<boolean> {
    const link = this.linkOfConsoleUser(consoleUserId);
    const name = cleanChatDisplayName(displayName);
    if (!link || !name || link.consoleDisplayName === name) return false;
    await this.#model(CHAT_PRINCIPAL_LINK_TABLE)?.update({ console_display_name: name }).where({ principal_id: link.principalId });
    this.#links.set(link.principalId, Object.freeze({ ...link, consoleDisplayName: name }));
    return true;
  }

  async deleteLink(principalId: string): Promise<StoredChatConsoleLink | undefined> {
    const link = this.#links.get(principalId);
    if (!link) return undefined;
    await this.#model(CHAT_PRINCIPAL_LINK_TABLE)?.delete().where({ principal_id: principalId });
    this.#links.delete(principalId);
    return link;
  }
}
