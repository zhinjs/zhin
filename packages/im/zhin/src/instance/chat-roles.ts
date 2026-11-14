/**
 * ADR 0056 §3 storage of the instance: stored chat role grants (`chat_roles`), an instance-owned
 * table (never `console_*`), loaded into memory once the DatabaseHost started and effective
 * immediately. zhin roles come only from these grants; platform standing is never mapped into them.
 *
 * The role model and the resolution along the scope chain live in `@zhin.js/core`
 * ({@link ChatRoleService}); this module only stores.
 */
import { createHash } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import {
  isChatIdentity, isChatRole, normalizeChatRoleScope, type ChatRoleService,
  type ChatIdentity, type ChatRole, type ChatRoleChange, type ChatRoleEntry, type ChatRoleGrantStore,
} from '@zhin.js/core';
import type { DatabaseHost, DatabaseHostModel, FeatureConfigLevel } from '@zhin.js/plugin-runtime';

export {
  CHAT_ROLES, ChatRoleService, chatRoleIncludes, chatRoleMessageContext, chatScopeChain, chatScopeCovers, chatScopeLevel,
  isChatIdentity, isChatRole, normalizeChatRoleScope, platformStandingOf,
  type ChatIdentity, type ChatRole, type ChatRoleContext, type ChatRoleEntry, type ChatRoleResolution,
  type ChatRoleSourceKind,
} from '@zhin.js/core';

/** Resolution over the instance's stored grants. */
export type InstanceChatRoleService = ChatRoleService<ChatRoleStore>;

export const CHAT_ROLE_TABLE = 'chat_roles';
const FIELDS = ['id', 'level', 'scope_key', 'adapter', 'user_id', 'role', 'granted_by', 'granted_at'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

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

/**
 * Stored grants (`chat_roles`), one role per identity and scope. With a `database` the store
 * writes through to `chat_roles` and refuses writes it cannot persist
 * ({@link ChatRoleStorageUnavailableError}); without one it is an explicit in-memory store (tests).
 */
export class ChatRoleStore implements ChatRoleGrantStore {
  readonly #database?: DatabaseHost;
  readonly #grants = new Map<string, ChatRoleEntry>();
  readonly #queue = new SerialQueue();
  readonly #listeners = new Set<(change: ChatRoleChange) => void>();

  constructor(options: Readonly<{ database?: DatabaseHost }> = {}) { this.#database = options.database; }

  /** Whether grants and revocations are saved (always for the in-memory store without a database). */
  get persistent(): boolean {
    return !this.#database || modelOf(this.#database, CHAT_ROLE_TABLE) !== undefined;
  }

  /** The `chat_roles` model, or undefined for the in-memory store; throws when a database cannot persist. */
  #writableModel(): DatabaseHostModel | undefined {
    if (!this.#database) return undefined;
    const model = modelOf(this.#database, CHAT_ROLE_TABLE);
    if (!model) throw new ChatRoleStorageUnavailableError();
    return model;
  }

  /**
   * Memory-only grants (the configuration migration on a non-relational database): effective
   * until the process exits, never written, existing grants at the same scope kept.
   */
  seed(entries: readonly (Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity)[]): number {
    let added = 0;
    for (const input of entries) {
      let key: string;
      try { key = normalizeChatRoleScope(input.level, input.key); } catch { continue; }
      const identity = { adapter: input.adapter, userId: input.userId };
      if (!isChatIdentity(identity) || !isChatRole(input.role)) continue;
      const id = rowId(input.level, key, identity);
      if (this.#grants.has(id)) continue;
      this.#grants.set(id, Object.freeze({ ...identity, level: input.level, key, role: input.role, source: 'grant' as const,
        ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: Date.now() }));
      added += 1;
    }
    return added;
  }

  async load(): Promise<void> {
    const model = modelOf(this.#database, CHAT_ROLE_TABLE);
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

  /** Saved grants and revocations (ADR 0060 §6 `ChatRoleReader.subscribe`); listener errors are ignored. */
  subscribe(listener: (change: ChatRoleChange) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #notify(change: ChatRoleChange): void {
    for (const listener of [...this.#listeners]) {
      try { listener(change); } catch { /* a listener never breaks a write */ }
    }
  }

  get(level: FeatureConfigLevel, key: string, identity: ChatIdentity): ChatRoleEntry | undefined {
    return this.#grants.get(rowId(level, key, identity));
  }

  grant(input: Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const identity = { adapter: input.adapter, userId: input.userId };
      if (!isChatIdentity(identity) || !isChatRole(input.role)) throw new TypeError('invalid chat role grant');
      const id = rowId(input.level, key, identity);
      const model = this.#writableModel();
      const current = this.#grants.get(id);
      if (current?.role === input.role) return 'unchanged' as const;
      const value: ChatRoleEntry = Object.freeze({ ...identity, level: input.level, key, role: input.role, source: 'grant' as const,
        ...(input.grantedBy ? { grantedBy: input.grantedBy.slice(0, 256) } : {}), grantedAt: Date.now() });
      const row = { level: value.level, scope_key: key, adapter: value.adapter, user_id: value.userId, role: value.role,
        granted_by: value.grantedBy ?? null, granted_at: value.grantedAt };
      if (model) {
        if (current) await model.update(row).where({ id });
        else await model.insert({ id, ...row });
      }
      this.#grants.set(id, value);
      this.#notify(Object.freeze({ kind: 'grant', identity: Object.freeze({ ...identity }), level: input.level, key, role: input.role }));
      return 'saved' as const;
    });
  }

  revoke(input: Readonly<{ level: FeatureConfigLevel; key: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const id = rowId(input.level, key, input);
      const model = this.#writableModel();
      if (!this.#grants.has(id)) return 'unchanged' as const;
      await model?.delete().where({ id });
      this.#grants.delete(id);
      this.#notify(Object.freeze({ kind: 'revoke', identity: Object.freeze({ adapter: input.adapter, userId: input.userId }), level: input.level, key }));
      return 'saved' as const;
    });
  }
}
