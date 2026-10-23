import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { PluginStateStore, type JsonValue, type StateRecord } from './persistent-state.js';
import type { PluginDatabaseHost, DatabaseHostTransaction } from './database-host.js';

export interface RelationalStateCodec {
  /** Existing plugin-scoped key to migrate once. */
  readonly key: string;
  readonly header: { readonly table: string; readonly definition: Record<string, unknown> };
  readonly tables: Readonly<Record<string, Record<string, unknown>>>;
  encode(value: JsonValue): { header: Record<string, unknown>; rows: Record<string, readonly Record<string, unknown>[]> };
  decode(header: Record<string, unknown>, rows: Record<string, readonly Record<string, unknown>[]>): JsonValue;
}

/**
 * Reuses PluginStateStore's CAS and admission contract with relational records.
 * Only registered plugin keys are accepted; ordinary state uses database.state.
 * Register in setup. Tables, revision and receipts commit or roll back together.
 */
export function createRelationalStateStore(database: PluginDatabaseHost, codecs: readonly RelationalStateCodec[]): PluginStateStore {
  const legacy = database.state;
  const byKey = new Map(codecs.map(codec => [codec.key, codec]));
  if (byKey.size !== codecs.length) throw new Error('Duplicate relational state key');
  for (const codec of codecs) {
    database.define(codec.header.table, {
      ...codec.header.definition,
      storage_id: { type: 'integer', primary: true },
      storage_revision: { type: 'text', length: 36, nullable: false },
      storage_present: { type: 'boolean', nullable: false },
      storage_expires_at: { type: 'bigint', nullable: true },
    });
    for (const [name, definition] of Object.entries(codec.tables)) database.define(name, definition);
  }
  const migrated = new Set<string>();
  const writeRows = async (transaction: DatabaseHostTransaction, codec: RelationalStateCodec,
    rows: Record<string, readonly Record<string, unknown>[]>) => {
    for (const name of Object.keys(codec.tables)) {
      const model = transaction.model(name);
      await model.delete().where({});
      for (const row of rows[name] ?? []) await model.insert(row);
    }
  };
  const migrate = async (codec: RelationalStateCodec): Promise<void> => {
    if (migrated.has(codec.key)) return;
    // Read outside the transaction: the old port may use another connection.
    const old = await legacy.get(codec.key);
    await retryRelationalOperation(() => database.transaction(async transaction => {
      const model = transaction.model(codec.header.table);
      if ((await model.select().where({ storage_id: 1 }))[0]) return;
      const encoded = old === undefined ? { header: {}, rows: {} } : codec.encode(old);
      await model.insert({ ...encoded.header, storage_id: 1, storage_revision: randomUUID(),
        storage_present: old !== undefined, storage_expires_at: null });
      await writeRows(transaction, codec, encoded.rows);
    }));
    // A durable header is the cutover marker, including an empty/deleted book.
    // Cleanup failure is safe to retry; never reimport an old deleted task.
    await retryRelationalOperation(() => legacy.delete(codec.key));
    migrated.add(codec.key);
  };
  return new PluginStateStore(database.owner, {
    async read(_owner, scope, key): Promise<StateRecord | undefined> {
      const codec = byKey.get(key);
      if (!codec || scope.kind !== 'plugin') throw new Error(`Unregistered relational state key: ${key}`);
      await migrate(codec);
      return retryRelationalOperation(() => database.transaction(async transaction => {
        const header = (await transaction.model(codec.header.table).select().where({ storage_id: 1 }))[0];
        if (!header) throw new Error('Relational state header is missing');
        const rows: Record<string, readonly Record<string, unknown>[]> = {};
        for (const name of Object.keys(codec.tables)) rows[name] = await transaction.model(name).select().orderBy('position');
        return { revision: String(header.storage_revision),
          value: header.storage_present ? codec.decode(header, rows) : null,
          // Tombstones must remain visible to CAS, but appear absent to the updater.
          expiresAt: header.storage_present ? (header.storage_expires_at == null ? null : Number(header.storage_expires_at)) : 0 };
      }));
    },
    async compareExchange(_owner, scope, key, revision, value, expiresAt) {
      const codec = byKey.get(key);
      if (!codec || scope.kind !== 'plugin') throw new Error(`Unregistered relational state key: ${key}`);
      if (revision === undefined) throw new Error('Relational state must be read before CAS');
      try {
        return await database.transaction(async transaction => {
          const encoded = value === undefined ? { header: {}, rows: {} } : codec.encode(value);
          const changed = await transaction.model(codec.header.table).update({ ...encoded.header,
            storage_revision: randomUUID(), storage_present: value !== undefined, storage_expires_at: expiresAt,
          }).where({ storage_id: 1, storage_revision: revision });
          if (changed !== 1) return false;
          await writeRows(transaction, codec, encoded.rows);
          return true;
        });
      } catch (error) {
        if (!isRelationalContention(error)) throw error;
        await setImmediate();
        return false;
      }
    },
  });
}

/** Only for pure database mutations; never wrap external sends or arbitrary side effects. */
export async function retryRelationalOperation<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 63 || !isRelationalContention(error)) throw error;
      await setImmediate();
    }
  }
}

/** Constraint races and serialization conflicts may replay the pure updater. */
function isRelationalContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; errno?: number; errcode?: number; cause?: unknown };
  return ['40001', '40P01', '23505', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE', 'ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(value.code ?? '')
    || [1062, 1213, 1205].includes(value.errno ?? 0)
    || [5, 517, 1555, 2067].includes(value.errcode ?? 0)
    || (value.cause !== undefined && isRelationalContention(value.cause));
}
