import { createHash, randomUUID } from 'node:crypto';
import type { BuildQueryResult, QueryParams } from '@zhin.js/database';
import type { PersistentStatePort, PluginId, StateRecord, StateScope, JsonValue } from '@zhin.js/plugin-runtime';

const table = '__zhin_persistent_state';
const definition = {
  id: { type: 'text', length: 64, primary: true, nullable: false },
  revision: { type: 'text', length: 36, nullable: false },
  value: { type: 'text', nullable: false },
  expires_at: { type: 'bigint', nullable: true },
};

/** Uses the process-owned database's normal builders and connection. */
export interface StateDatabase {
  define(name: string, definition: unknown): void;
  buildQuery(input: QueryParams<Record<string, Record<string, unknown>>, string>): BuildQueryResult<string>;
  query(query: string, params?: unknown[]): Promise<unknown>;
}

export function createDatabaseState(db: StateDatabase, dialect: string, isStarted: () => boolean): PersistentStatePort {
  const supported = dialect === 'sqlite' || dialect === 'mysql' || dialect === 'pg';
  if (supported) db.define(table, dialect === 'pg' ? {
    ...definition,
    // PostgreSQL TEXT has no length modifier; the hashed key is already bounded.
    id: { type: 'text', primary: true, nullable: false },
    revision: { type: 'text', nullable: false },
  } : definition);
  const requireDatabase = (): void => {
    if (!supported) throw new Error(`Atomic persistent state is not supported by database dialect '${dialect}'`);
    if (!isStarted()) throw new Error('Persistent state database is not connected');
  };
  const execute = async (input: QueryParams<Record<string, Record<string, unknown>>, string>, returning = false): Promise<unknown> => {
    const built = db.buildQuery(input);
    const sql = dialect === 'pg' && returning ? `${built.query} RETURNING "id"` : built.query;
    return db.query(sql, built.params);
  };
  const changed = (result: unknown): boolean => {
    if (typeof result === 'number') return result === 1;
    if (Array.isArray(result)) return result.length === 1;
    return !!result && typeof result === 'object'
      && Number((result as { affectedRows?: unknown }).affectedRows) === 1;
  };
  return {
    async read(owner, scope, key) {
      requireDatabase();
      const rows = await execute({ type: 'select', tableName: table,
        fields: ['revision', 'value', 'expires_at'], conditions: { id: address(owner, scope, key) } });
      if (!Array.isArray(rows)) throw new Error('Invalid persistent state database result');
      const row = rows[0] as { revision: string; value: string; expires_at: number | string | null } | undefined;
      if (!row) return undefined;
      return { revision: row.revision, value: JSON.parse(row.value) as JsonValue,
        expiresAt: row.expires_at === null ? null : Number(row.expires_at) } satisfies StateRecord;
    },
    async compareExchange(owner, scope, key, revision, value, expiresAt) {
      requireDatabase();
      const id = address(owner, scope, key);
      if (revision === undefined) {
        if (value === undefined) return true;
        try {
          await execute({ type: 'insert', tableName: table,
            data: { id, revision: randomUUID(), value: JSON.stringify(value), expires_at: expiresAt } });
          return true;
        } catch (error) {
          if (isUniqueConflict(error)) return false;
          throw error;
        }
      }
      return changed(await execute(value === undefined
        ? { type: 'delete', tableName: table, conditions: { id, revision } }
        : { type: 'update', tableName: table, conditions: { id, revision },
          update: { revision: randomUUID(), value: JSON.stringify(value), expires_at: expiresAt } }, true));
    },
  };
}

function address(owner: PluginId, scope: StateScope, key: string): string {
  // Tuple encoding separates owners, users, conversations, parents and threads;
  // hash keeps physical keys short and excludes NUL from SQL text identifiers.
  const parts = scope.kind === 'plugin' ? ['plugin']
    : scope.kind === 'user' ? ['user', scope.endpoint.adapter, scope.endpoint.id, scope.senderId]
      : ['conversation', scope.target.endpoint.adapter, scope.target.endpoint.id, scope.target.kind,
        scope.target.id, scope.target.parent?.kind ?? null, scope.target.parent?.id ?? null, scope.target.threadId ?? null];
  return createHash('sha256').update(JSON.stringify([owner, parts, key])).digest('hex');
}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: string; errno?: number; errcode?: number; cause?: unknown };
  return failure.code === '23505' || failure.code === 'ER_DUP_ENTRY' || failure.errno === 1062
    || failure.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || failure.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (failure.code === 'ERR_SQLITE_ERROR' && (failure.errcode === 1555 || failure.errcode === 2067))
    || (failure.cause !== undefined && isUniqueConflict(failure.cause));
}
