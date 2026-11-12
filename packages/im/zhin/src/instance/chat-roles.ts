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
  type ChatIdentity, type ChatRole, type ChatRoleEntry, type ChatRoleGrantStore,
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

class SerialQueue {
  #queue: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

/** Stored grants (`chat_roles`), one role per identity and scope. */
export class ChatRoleStore implements ChatRoleGrantStore {
  readonly #database?: DatabaseHost;
  readonly #grants = new Map<string, ChatRoleEntry>();
  readonly #queue = new SerialQueue();

  constructor(options: Readonly<{ database?: DatabaseHost }> = {}) { this.#database = options.database; }

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

  get(level: FeatureConfigLevel, key: string, identity: ChatIdentity): ChatRoleEntry | undefined {
    return this.#grants.get(rowId(level, key, identity));
  }

  grant(input: Readonly<{ level: FeatureConfigLevel; key: string; role: ChatRole; grantedBy?: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
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
      const model = modelOf(this.#database, CHAT_ROLE_TABLE);
      if (model) {
        if (current) await model.update(row).where({ id });
        else await model.insert({ id, ...row });
      }
      this.#grants.set(id, value);
      return 'saved' as const;
    });
  }

  revoke(input: Readonly<{ level: FeatureConfigLevel; key: string }> & ChatIdentity): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope(input.level, input.key);
      const id = rowId(input.level, key, input);
      if (!this.#grants.has(id)) return 'unchanged' as const;
      await modelOf(this.#database, CHAT_ROLE_TABLE)?.delete().where({ id });
      this.#grants.delete(id);
      return 'saved' as const;
    });
  }
}
