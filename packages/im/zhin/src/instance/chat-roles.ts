/**
 * ADR 0056 §3–§4 storage of the instance: stored chat role grants (`chat_roles`) and
 * conversation-level mapping rules (`chat_role_mappings`). Both are instance-owned tables (never
 * `console_*`), loaded into memory once the DatabaseHost started and effective immediately.
 *
 * The role model, the resolution along the scope chain and the mapping rule evaluation live in
 * `@zhin.js/core` ({@link ChatRoleService}); this module only stores.
 */
import { createHash } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import {
  isChatIdentity, isChatRole, normalizeChatRoleScope, parseChatRoleMappingLayer, type ChatRoleService,
  type ChatIdentity, type ChatRole, type ChatRoleEntry, type ChatRoleGrantStore, type ChatRoleMappingLayer, type ChatRoleMappingRule,
} from '@zhin.js/core';
import type { DatabaseHost, DatabaseHostModel, FeatureConfigLevel } from '@zhin.js/plugin-runtime';

export {
  CHAT_ROLES, ChatRoleService, chatRoleIncludes, chatRoleMessageContext, chatScopeChain, chatScopeCovers, chatScopeLevel,
  createMappingChatRoleSource, isChatIdentity, isChatRole, normalizeChatRoleScope, platformStandingOf,
  type ChatIdentity, type ChatRole, type ChatRoleContext, type ChatRoleEntry, type ChatRoleResolution, type ChatRoleSource,
  type ChatRoleSourceKind, type MappingChatRoleSource,
} from '@zhin.js/core';

/** Resolution over the instance's stored grants. */
export type InstanceChatRoleService = ChatRoleService<ChatRoleStore>;

export const CHAT_ROLE_TABLE = 'chat_roles';
export const CHAT_ROLE_MAPPING_TABLE = 'chat_role_mappings';
const FIELDS = ['id', 'level', 'scope_key', 'adapter', 'user_id', 'role', 'granted_by', 'granted_at'];
const MAPPING_FIELDS = ['key', 'rules', 'inherit', 'revision', 'updated_at', 'updated_by'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

const rowId = (level: string, key: string, identity: ChatIdentity) =>
  createHash('sha256').update(JSON.stringify([level, key, identity.adapter, identity.userId])).digest('hex');

export function defineChatRoleTable(database: DatabaseHost): void {
  assertInstanceTable(CHAT_ROLE_TABLE);
  assertInstanceTable(CHAT_ROLE_MAPPING_TABLE);
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
  database.define(CHAT_ROLE_MAPPING_TABLE, {
    // Conversation resolution key (`<alias>/<endpointId>/<kind>:<id>`, at most ~600 characters).
    key: { type: 'text', length: 1024, primary: true, nullable: false },
    rules: { type: 'text', nullable: false },
    inherit: { type: 'integer', nullable: false },
    revision: { type: 'integer', nullable: false },
    updated_at: { type: 'bigint', nullable: false },
    updated_by: { type: 'text', nullable: true },
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

/** One stored conversation-level mapping layer. */
export interface StoredChatRoleMappings {
  readonly key: string;
  readonly rules: readonly ChatRoleMappingRule[];
  readonly inherit: boolean;
  readonly revision: number;
  readonly updatedAt: number;
  readonly updatedBy?: string;
}

export type ChatRoleMappingWrite =
  | Readonly<{ status: 'saved' | 'unchanged'; value?: StoredChatRoleMappings }>
  | Readonly<{ status: 'conflict'; value?: StoredChatRoleMappings }>;

const sameRules = (left: readonly ChatRoleMappingRule[], right: readonly ChatRoleMappingRule[]) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Conversation-level mapping rules (`chat_role_mappings`, ADR 0056 §4). Only conversation keys;
 * adapter and account rules live in the configuration file.
 */
export class ChatRoleMappingStore {
  readonly #database?: DatabaseHost;
  readonly #layers = new Map<string, StoredChatRoleMappings>();
  readonly #queue = new SerialQueue();

  constructor(options: Readonly<{ database?: DatabaseHost }> = {}) { this.#database = options.database; }

  async load(): Promise<void> {
    const model = modelOf(this.#database, CHAT_ROLE_MAPPING_TABLE);
    this.#layers.clear();
    if (!model) return;
    for (const row of await model.select(...MAPPING_FIELDS)) {
      try {
        const key = normalizeChatRoleScope('conversation', String(row.key));
        const layer = parseChatRoleMappingLayer({ mappings: JSON.parse(String(row.rules)), inherit: Number(row.inherit) !== 0 }, 'conversation');
        if (!layer) continue;
        this.#layers.set(key, Object.freeze({ key, rules: layer.rules, inherit: layer.inherit !== false, revision: Number(row.revision) || 1,
          updatedAt: Number(row.updated_at), ...(typeof row.updated_by === 'string' && row.updated_by ? { updatedBy: row.updated_by } : {}) }));
      } catch { /* malformed rows map nothing */ }
    }
  }

  get(key: string): StoredChatRoleMappings | undefined { return this.#layers.get(key); }

  list(): readonly StoredChatRoleMappings[] { return [...this.#layers.values()]; }

  /** Layer for {@link createMappingChatRoleSource}. */
  layer(key: string): ChatRoleMappingLayer | undefined {
    const stored = this.#layers.get(key);
    return stored ? Object.freeze({ level: 'conversation' as const, rules: stored.rules, ...(stored.inherit ? {} : { inherit: false }) }) : undefined;
  }

  /**
   * Replaces the conversation's rules (validated). Empty rules with `inherit: true` delete the
   * row. `expectedRevision` (0 = must not exist) guards concurrent edits.
   */
  set(input: Readonly<{ key: string; mappings: unknown; inherit?: unknown; updatedBy?: string; expectedRevision?: number }>): Promise<ChatRoleMappingWrite> {
    return this.#queue.run(async () => {
      const key = normalizeChatRoleScope('conversation', input.key);
      const layer = parseChatRoleMappingLayer({ mappings: input.mappings ?? [], ...(input.inherit === undefined ? {} : { inherit: input.inherit }) }, 'conversation')!;
      const inherit = layer.inherit !== false;
      const current = this.#layers.get(key);
      if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) {
        return Object.freeze({ status: 'conflict' as const, ...(current ? { value: current } : {}) });
      }
      const model = modelOf(this.#database, CHAT_ROLE_MAPPING_TABLE);
      if (layer.rules.length === 0 && inherit) {
        if (!current) return Object.freeze({ status: 'unchanged' as const });
        await model?.delete().where({ key });
        this.#layers.delete(key);
        return Object.freeze({ status: 'saved' as const });
      }
      if (current && current.inherit === inherit && sameRules(current.rules, layer.rules)) return Object.freeze({ status: 'unchanged' as const, value: current });
      const value: StoredChatRoleMappings = Object.freeze({ key, rules: layer.rules, inherit, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now(),
        ...(input.updatedBy ? { updatedBy: input.updatedBy.slice(0, 256) } : {}) });
      const row = { rules: JSON.stringify(value.rules), inherit: inherit ? 1 : 0, revision: value.revision, updated_at: value.updatedAt, updated_by: value.updatedBy ?? null };
      if (model) {
        if (current) await model.update(row).where({ key });
        else await model.insert({ key, ...row });
      }
      this.#layers.set(key, value);
      return Object.freeze({ status: 'saved' as const, value });
    });
  }
}
