/**
 * ADR 0056 §3 storage of the instance: stored chat role grants (`chat_roles`), an instance-owned
 * table (never `console_*`), loaded into memory once the DatabaseHost started and effective
 * immediately. zhin roles come only from these grants; platform standing is never mapped into them.
 *
 * ADR 0060 §2.3 (person model): a grant belongs to a person (`principal_id`, logical key
 * `(level, scope_key, principal_id)`); the person's identities live in `chat_identities`
 * ({@link ChatPrincipalStore}). For one release the identity the grant was written for stays in
 * `adapter` / `user_id` (dual write) and the row id stays `sha256(level, scope_key, adapter,
 * user_id)`, so an older release reads and revokes the same rows (rollback, ADR 0060 §4.5).
 * Rows without `principal_id` (written before the person model, or by an older release after a
 * rollback) are migrated on load: their identity gets its own person and the row is backfilled;
 * before the first such migration the old rows are exported to `.zhin/backups/chat-roles-<time>.json`.
 *
 * The role model and the resolution along the scope chain live in `@zhin.js/core`
 * ({@link ChatRoleService}); this module only stores.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertInstanceTable } from '@zhin.js/database';
import {
  chatRoleEntryAppliesTo, chatRoleIncludes, chatScopeAdapter, isChatIdentity, isChatRole, normalizeChatRoleScope,
  type ChatRoleService, type ChatIdentity, type ChatPrincipalRecord, type ChatRole, type ChatRoleChange, type ChatRoleEntry,
  type ChatRoleGrantStore,
} from '@zhin.js/core';
import type { DatabaseHost, DatabaseHostModel, FeatureConfigLevel } from '@zhin.js/plugin-runtime';
import { ChatPrincipalStore, type ChatIdentityLinkMethod } from './chat-principals.js';

export {
  CHAT_ROLES, ChatRoleService, chatRoleIncludes, chatRoleMessageContext, chatScopeChain, chatScopeCovers, chatScopeLevel,
  isChatIdentity, isChatRole, normalizeChatRoleScope, platformStandingOf,
  type ChatIdentity, type ChatRole, type ChatRoleContext, type ChatRoleEntry, type ChatRoleResolution,
  type ChatRoleSourceKind,
} from '@zhin.js/core';

/** Resolution over the instance's stored grants. */
export type InstanceChatRoleService = ChatRoleService<ChatRoleStore>;

export const CHAT_ROLE_TABLE = 'chat_roles';
const FIELDS = ['id', 'level', 'scope_key', 'adapter', 'user_id', 'principal_id', 'role', 'granted_by', 'granted_at'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

/** Row id: sha256(level, scope_key, adapter, user_id) of the dual-written identity (unchanged since ADR 0056). */
const rowId = (level: string, key: string, identity: ChatIdentity) =>
  createHash('sha256').update(JSON.stringify([level, key, identity.adapter, identity.userId])).digest('hex');
/** Logical key `(level, scope_key, principal_id)` (ADR 0060 §2.3). */
const logicalKey = (level: string, key: string, principalId: string) => JSON.stringify([level, key, principalId]);

/** Where the pre-migration backup goes (ADR 0060 §4.5). */
export const CHAT_ROLE_BACKUP_DIRECTORY = join('.zhin', 'backups');

export function defineChatRoleTable(database: DatabaseHost): void {
  assertInstanceTable(CHAT_ROLE_TABLE);
  if (!RELATIONAL.includes(database.dialect)) return;
  database.define(CHAT_ROLE_TABLE, {
    // sha256(level, scope_key, adapter, user_id) of the dual-written identity (see the module doc).
    id: { type: 'text', length: 64, primary: true, nullable: false },
    level: { type: 'text', nullable: false },
    scope_key: { type: 'text', nullable: false },
    adapter: { type: 'text', nullable: false },
    user_id: { type: 'text', nullable: false },
    // ADR 0060 §2.3: added to existing tables (nullable so the column can be added in place and an
    // older release can still insert rows); every row carries it after the load-time migration.
    principal_id: { type: 'text', nullable: true },
    role: { type: 'text', nullable: false },
    granted_by: { type: 'text', nullable: true },
    granted_at: { type: 'bigint', nullable: false },
  }, { addColumns: ['principal_id'] });
}

function modelOf(database: DatabaseHost | undefined, table: string): DatabaseHostModel | undefined {
  if (!database?.started || !RELATIONAL.includes(database.dialect)) return undefined;
  return database.models.get(table);
}

/**
 * ADR 0056 §3: chat role grants must survive a restart. Without a relational project database the
 * store refuses grants and revocations instead of keeping them in memory and reporting success.
 */
export class ChatRoleStorageUnavailableError extends Error {
  readonly code = 'chat-roles-unpersisted';
  constructor() {
    super('聊天角色需要关系型项目数据库（sqlite / mysql / pg）才能保存；当前数据库不支持，未保存。');
    this.name = 'ChatRoleStorageUnavailableError';
  }
}

class SerialQueue {
  #queue: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

interface HeldGrant {
  readonly entry: ChatRoleEntry & { readonly principalId: string };
  readonly rowId: string;
}

export interface ChatRoleStoreOptions {
  readonly database?: DatabaseHost;
  /** Project root: enables the pre-migration backup (`.zhin/backups/chat-roles-<time>.json`). */
  readonly projectRoot?: string;
  readonly now?: () => number;
  /** Told about the migration of rows without a person (count and backup file). */
  readonly onMigrated?: (result: Readonly<{ migrated: number; backup?: string }>) => void;
}

/**
 * Stored grants (`chat_roles`), one role per person and scope. With a `database` the store
 * writes through to `chat_roles` and refuses writes it cannot persist
 * ({@link ChatRoleStorageUnavailableError}); without one it is an explicit in-memory store (tests).
 */
export class ChatRoleStore implements ChatRoleGrantStore {
  readonly #database?: DatabaseHost;
  readonly #options: ChatRoleStoreOptions;
  readonly #grants = new Map<string, HeldGrant>();
  readonly #queue = new SerialQueue();
  readonly #listeners = new Set<(change: ChatRoleChange) => void>();
  /** People and identities (ADR 0060 §2); writes go through {@link exclusive}. */
  readonly principals: ChatPrincipalStore;

  constructor(options: ChatRoleStoreOptions = {}) {
    this.#database = options.database;
    this.#options = options;
    this.principals = new ChatPrincipalStore({ ...(options.database ? { database: options.database } : {}), ...(options.now ? { now: options.now } : {}) });
  }

  /** Whether grants and revocations are saved (always for the in-memory store without a database). */
  get persistent(): boolean {
    return !this.#database || (modelOf(this.#database, CHAT_ROLE_TABLE) !== undefined && this.principals.persistent);
  }

  /** The `chat_roles` model, or undefined for the in-memory store; throws when a database cannot persist. */
  #writableModel(): DatabaseHostModel | undefined {
    if (!this.#database) return undefined;
    const model = modelOf(this.#database, CHAT_ROLE_TABLE);
    if (!model || !this.principals.persistent) throw new ChatRoleStorageUnavailableError();
    return model;
  }

  /** Throws {@link ChatRoleStorageUnavailableError} when writes would not be saved. */
  assertPersistent(): void { this.#writableModel(); }

  /** Runs `work` in the write queue shared by grants and people (merge, split, bind, import). */
  exclusive<T>(work: () => Promise<T>): Promise<T> { return this.#queue.run(work); }

  // ---------------------------------------------------------------------- reads (ChatRoleGrantStore)

  list(): readonly ChatRoleEntry[] { return [...this.#grants.values()].map(held => held.entry); }

  principalOf(identity: ChatIdentity): ChatPrincipalRecord | undefined { return this.principals.principalOf(identity); }

  principal(id: string): ChatPrincipalRecord | undefined { return this.principals.principal(id); }

  /** Grants held by a person (any scope). */
  grantsOf(principalId: string): readonly ChatRoleEntry[] {
    return this.list().filter(entry => entry.principalId === principalId);
  }

  /** The grant of `identity`'s person at the scope, if it counts for `identity` (ADR 0060 Q10). */
  get(level: FeatureConfigLevel, key: string, identity: ChatIdentity): ChatRoleEntry | undefined {
    const principal = this.principals.principalOf(identity)?.id;
    if (!principal) return undefined;
    const held = this.#grants.get(logicalKey(level, key, principal))?.entry;
    return held && chatRoleEntryAppliesTo(held, identity) ? held : undefined;
  }

  // ---------------------------------------------------------------------- change notifications

  /** Saved grants, revocations, merges and splits (ADR 0060 §6 `ChatRoleReader.subscribe`); listener errors are ignored. */
  subscribe(listener: (change: ChatRoleChange) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Notifies subscribers (people operations call it after their writes). */
  notify(change: ChatRoleChange): void {
    for (const listener of [...this.#listeners]) {
      try { listener(change); } catch { /* a listener never breaks a write */ }
    }
  }

  // ---------------------------------------------------------------------- load and migration

  #hold(entry: ChatRoleEntry & { principalId: string }, id: string): void {
    this.#grants.set(logicalKey(entry.level, entry.key, entry.principalId), Object.freeze({ entry: Object.freeze(entry), rowId: id }));
  }

  /**
   * Memory-only grants (the configuration migration on a non-relational database): effective
   * until the process exits, never written, existing grants at the same scope kept.
   */
  async seed(entries: readonly (Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity)[]): Promise<number> {
    return this.#queue.run(async () => {
      let added = 0;
      for (const input of entries) {
        let key: string;
        try { key = normalizeChatRoleScope(input.level, input.key); } catch { continue; }
        const identity = { adapter: input.adapter, userId: input.userId };
        if (!isChatIdentity(identity) || !isChatRole(input.role) || !chatRoleEntryAppliesTo({ key }, identity)) continue;
        const principalId = await this.ensurePrincipalUnlocked(identity, { method: 'implicit', by: 'seed', memoryOnly: true });
        if (this.#grants.has(logicalKey(input.level, key, principalId))) continue;
        this.#hold({ ...identity, principalId, level: input.level, key, role: input.role, source: 'grant' as const,
          ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: Date.now() }, rowId(input.level, key, identity));
        added += 1;
      }
      return added;
    });
  }

  async load(): Promise<void> {
    await this.#queue.run(async () => {
      await this.principals.load();
      const model = modelOf(this.#database, CHAT_ROLE_TABLE);
      this.#grants.clear();
      if (!model) return;
      const rows = await model.select(...FIELDS);
      const unmigrated = rows.filter(row => typeof row.principal_id !== 'string' || !this.principals.stored(row.principal_id));
      let backup: string | undefined;
      if (unmigrated.length > 0 && this.#options.projectRoot) backup = await this.#backup(rows);
      let migrated = 0;
      for (const row of rows) {
        try {
          const level = String(row.level) as FeatureConfigLevel;
          const key = normalizeChatRoleScope(level, String(row.scope_key));
          const identity = { adapter: String(row.adapter), userId: String(row.user_id) };
          const role = String(row.role);
          if (!isChatIdentity(identity) || !isChatRole(role) || !chatRoleEntryAppliesTo({ key }, identity)) continue;
          let principalId = typeof row.principal_id === 'string' && this.principals.stored(row.principal_id) ? row.principal_id : undefined;
          if (!principalId) {
            // ADR 0060 §2.3 migration (idempotent: only rows without a known person): the identity's
            // person — its own new single-identity person unless it already belongs to one.
            principalId = await this.ensurePrincipalUnlocked(identity, { method: 'implicit', by: 'migration' });
            await model.update({ principal_id: principalId }).where({ id: String(row.id) });
            migrated += 1;
          }
          const entry = { ...identity, principalId, level, key, role, source: 'grant' as const,
            ...(typeof row.granted_by === 'string' && row.granted_by ? { grantedBy: row.granted_by } : {}), grantedAt: Number(row.granted_at) };
          const logical = logicalKey(level, key, principalId);
          const existing = this.#grants.get(logical);
          if (existing) {
            // Two rows for one person and scope (an older release granted a merged identity after a
            // rollback): the higher role stays, the other row goes. Never lowers.
            const keepNew = !chatRoleIncludes(existing.entry.role, role) || (existing.entry.role === role && (entry.grantedAt ?? 0) > (existing.entry.grantedAt ?? 0));
            const loser = keepNew ? existing.rowId : String(row.id);
            await model.delete().where({ id: loser });
            if (!keepNew) continue;
          }
          this.#hold(entry, String(row.id));
        } catch { /* malformed rows grant nothing */ }
      }
      if (migrated > 0) this.#options.onMigrated?.(Object.freeze({ migrated, ...(backup ? { backup } : {}) }));
    });
  }

  /** ADR 0060 §4.5: the rows as they were before the migration, in the export format. */
  async #backup(rows: readonly Record<string, unknown>[]): Promise<string | undefined> {
    const root = this.#options.projectRoot;
    if (!root) return undefined;
    const now = (this.#options.now ?? Date.now)();
    const file = join(root, CHAT_ROLE_BACKUP_DIRECTORY, `chat-roles-${new Date(now).toISOString().replace(/[:.]/gu, '-')}.json`);
    const data = {
      format: 'zhin.chat-roles', version: 1, exportedAt: now, reason: 'before-person-migration',
      principals: this.principals.principals(),
      identities: this.principals.identities().filter(identity => identity.principalId)
        .map(({ adapter, userId, principalId, linkMethod, linkedBy, linkedAt }) => ({ adapter, userId, principalId, linkMethod, linkedBy, linkedAt })),
      roles: rows.map(row => ({ level: row.level, key: row.scope_key, adapter: row.adapter, userId: row.user_id,
        ...(typeof row.principal_id === 'string' && row.principal_id ? { principalId: row.principal_id } : {}),
        role: row.role, ...(row.granted_by ? { grantedBy: row.granted_by } : {}), grantedAt: Number(row.granted_at) })),
      consoleLinks: this.principals.links(),
    };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return file;
  }

  // ---------------------------------------------------------------------- grants

  grant(input: Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const identity = { adapter: input.adapter, userId: input.userId };
      if (!isChatIdentity(identity) || !isChatRole(input.role)) throw new TypeError('invalid chat role grant');
      // ADR 0060 Q10: below global a role belongs to an identity on the scope's own adapter.
      if (!chatRoleEntryAppliesTo({ key }, identity)) throw new TypeError(`a ${input.level} role must be granted to an identity on adapter ${chatScopeAdapter(key)}`);
      const model = this.#writableModel();
      const principalId = await this.ensurePrincipalUnlocked(identity, { method: 'implicit', by: input.grantedBy ?? 'grant' });
      const current = this.#grants.get(logicalKey(input.level, key, principalId));
      if (current?.entry.role === input.role) return 'unchanged' as const;
      const value = { ...identity, principalId, level: input.level, key, role: input.role, source: 'grant' as const,
        ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: Date.now() };
      await this.#writeUnlocked(model, current, value);
      this.notify(Object.freeze({ kind: 'grant', identity: Object.freeze({ ...identity }), principalId, level: input.level, key, role: input.role }));
      return 'saved' as const;
    });
  }

  /** Writes `value` as the person's grant at its scope, replacing `current` (row id follows the dual-written identity). */
  async #writeUnlocked(model: DatabaseHostModel | undefined, current: HeldGrant | undefined, value: ChatRoleEntry & { principalId: string }): Promise<void> {
    const id = rowId(value.level, value.key, value);
    const row = { level: value.level, scope_key: value.key, adapter: value.adapter, user_id: value.userId, principal_id: value.principalId,
      role: value.role, granted_by: value.grantedBy ?? null, granted_at: value.grantedAt ?? Date.now() };
    if (model) {
      if (current && current.rowId === id) await model.update(row).where({ id });
      else {
        if (current) await model.delete().where({ id: current.rowId });
        await model.insert({ id, ...row });
      }
    }
    if (current) this.#grants.delete(logicalKey(current.entry.level, current.entry.key, current.entry.principalId));
    this.#hold(value, id);
  }

  revoke(input: Readonly<{ level: FeatureConfigLevel; key: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const identity = { adapter: input.adapter, userId: input.userId };
      const model = this.#writableModel();
      const principalId = this.principals.principalOf(identity)?.id;
      const held = principalId ? this.#grants.get(logicalKey(input.level, key, principalId)) : undefined;
      if (!held || !chatRoleEntryAppliesTo(held.entry, identity)) return 'unchanged' as const;
      await model?.delete().where({ id: held.rowId });
      this.#grants.delete(logicalKey(input.level, key, held.entry.principalId));
      this.notify(Object.freeze({ kind: 'revoke', identity: Object.freeze(identity), principalId: held.entry.principalId, level: input.level, key }));
      return 'saved' as const;
    });
  }

  // ---------------------------------------------------------------------- primitives for people operations (inside exclusive)

  /**
   * The person `identity` belongs to; creates its single-identity person when it has none
   * (ADR 0060 §2.2 "首次需要时才写行"). `memoryOnly` never writes (the non-relational seed).
   */
  async ensurePrincipalUnlocked(identity: ChatIdentity, link: Readonly<{ method: ChatIdentityLinkMethod; by?: string; displayName?: string; memoryOnly?: boolean }>): Promise<string> {
    const existing = this.principals.principalOf(identity)?.id;
    if (existing) return existing;
    if (!link.memoryOnly && this.#database && !this.principals.persistent) throw new ChatRoleStorageUnavailableError();
    const id = await this.principals.createPrincipal({ ...(link.displayName ? { displayName: link.displayName } : {}),
      createdBy: link.by ?? 'implicit' });
    await this.principals.assignIdentity(identity, id, { method: link.method, ...(link.by ? { by: link.by } : {}) });
    return id;
  }

  /**
   * Moves a grant to another person. Where that person already holds the scope the higher role
   * stays (never lowers); `dual` rewrites the dual-written identity (and the row id).
   */
  async moveGrantUnlocked(entry: ChatRoleEntry, toPrincipalId: string, dual?: ChatIdentity): Promise<void> {
    const model = this.#writableModel();
    if (!entry.principalId) return;
    const from = this.#grants.get(logicalKey(entry.level, entry.key, entry.principalId));
    if (!from) return;
    const target = this.#grants.get(logicalKey(entry.level, entry.key, toPrincipalId));
    if (target && target !== from) {
      if (chatRoleIncludes(target.entry.role, entry.role)) {
        await model?.delete().where({ id: from.rowId });
        this.#grants.delete(logicalKey(entry.level, entry.key, entry.principalId));
        return;
      }
      await model?.delete().where({ id: target.rowId });
      this.#grants.delete(logicalKey(entry.level, entry.key, toPrincipalId));
    }
    const identity = dual ?? { adapter: from.entry.adapter, userId: from.entry.userId };
    const value = { ...from.entry, adapter: identity.adapter, userId: identity.userId, principalId: toPrincipalId };
    const id = rowId(value.level, value.key, value);
    if (model) {
      if (id === from.rowId) await model.update({ principal_id: toPrincipalId }).where({ id });
      else {
        await model.delete().where({ id: from.rowId });
        await model.insert({ id, level: value.level, scope_key: value.key, adapter: value.adapter, user_id: value.userId,
          principal_id: toPrincipalId, role: value.role, granted_by: value.grantedBy ?? null, granted_at: value.grantedAt ?? Date.now() });
      }
    }
    this.#grants.delete(logicalKey(entry.level, entry.key, entry.principalId));
    this.#hold(value, id);
  }

  /**
   * Raises the person's grant at a scope to `role` (imports: never lowers). Returns whether
   * anything was written.
   */
  async raiseUnlocked(input: Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string; grantedAt?: number }> & ChatIdentity & Readonly<{ principalId: string }>): Promise<boolean> {
    const model = this.#writableModel();
    const current = this.#grants.get(logicalKey(input.level, input.key, input.principalId));
    if (current && chatRoleIncludes(current.entry.role, input.role)) return false;
    await this.#writeUnlocked(model, current, { adapter: input.adapter, userId: input.userId, principalId: input.principalId,
      level: input.level, key: input.key, role: input.role, source: 'grant' as const,
      ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: input.grantedAt ?? Date.now() });
    return true;
  }
}
