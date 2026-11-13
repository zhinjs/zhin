/**
 * A connection the gateway opens itself (ADR 0054 §7, ADR 0059): its own store
 * `.zhin/gateway.db` (`openGatewayStore`), and — only while importing the Console tables an
 * earlier version left in the project database, reverting that import, or testing a connection
 * in the setup wizard — a short-lived connection to the project database. SQLite runs in WAL
 * mode (`@zhin.js/database`), so several processes can hold a file open.
 */
import { GATEWAY_STORE_MARKER_TABLE, isSqliteBusyError, Registry } from '@zhin.js/database';
import type { DatabaseHostModel, DatabaseHostSelection } from '@zhin.js/plugin-runtime';
import type { ProjectDatabaseConfig } from './config.js';

/**
 * How long a gateway statement retries `SQLITE_BUSY` while the instance holds the write lock
 * (`busyRetryMs` in `@zhin.js/database`). The retry backs off asynchronously, so the gateway's
 * event loop keeps serving requests during the wait; a synchronous `busy_timeout` would stall
 * every request for as long as an instance transaction runs. Past the budget the request
 * answers `503 database_busy` ({@link isDatabaseBusyError}).
 */
export const GATEWAY_SQLITE_BUSY_RETRY_MS = 5_000;

/** Seconds a `503 database_busy` asks the client to wait. */
export const DATABASE_BUSY_RETRY_AFTER_SECONDS = 2;

/** The database stayed locked by another connection for the whole retry budget. */
export function isDatabaseBusyError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (isSqliteBusyError(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** `503 { code: 'database_busy' }` with `Retry-After`. */
export function databaseBusyResponse(extra: Readonly<Record<string, unknown>> = {}): Response {
  return new Response(JSON.stringify({
    success: false,
    code: 'database_busy',
    error: '数据库正忙，请稍后重试',
    ...extra,
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(DATABASE_BUSY_RETRY_AFTER_SECONDS),
    },
  });
}

interface RawSelection {
  where(query: Record<string, unknown>): unknown;
  orderBy?(field: string, direction?: 'ASC' | 'DESC'): unknown;
  limit?(count: number): unknown;
}

interface RawModel {
  select(...fields: string[]): RawSelection;
  insert(row: Record<string, unknown>): unknown;
  delete(query: Record<string, unknown>): unknown;
  update(patch: Record<string, unknown>): { where(query: Record<string, unknown>): unknown };
}

interface RawTransaction {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

interface RawDatabase {
  define(name: string, definition: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly models: Map<string, RawModel>;
  query<T = unknown>(query: unknown, params?: unknown[]): Promise<T>;
  transaction<T>(callback: (trx: RawTransaction) => Promise<T>, options?: { isolationLevel?: 'REPEATABLE_READ'; readOnly?: boolean }): Promise<T>;
  readonly dialect?: { backupTo?(destination: string): Promise<void> };
}

/** One statement inside {@link ProjectDatabase.transaction}. */
export interface ProjectDatabaseTransaction {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

/** The gateway's marker in the project database. */
export interface StoreMarker {
  readonly storeId: string;
  readonly migratedAt: number;
}

function markerOf(row: Record<string, unknown>): StoreMarker {
  return Object.freeze({ storeId: String(row.store_id ?? ''), migratedAt: Number(row.migrated_at ?? 0) });
}

/** Rows keyed by table name. */
export type TableRows = Readonly<Record<string, readonly Record<string, unknown>[]>>;

const SQL_DIALECTS: ReadonlySet<string> = new Set(['sqlite', 'mysql', 'pg']);
/** Rows read per batch by {@link ProjectDatabase.readSnapshot}. */
export const SNAPSHOT_BATCH_SIZE = 500;

const BACKTICK = String.fromCharCode(96);

/** A quoted table name for `dialect`. */
export function quoteTableName(dialect: string, name: string): string {
  return dialect === 'mysql'
    ? BACKTICK + name.split(BACKTICK).join(BACKTICK + BACKTICK) + BACKTICK
    : `"${name.replace(/"/gu, '""')}"`;
}

function placeholder(dialect: string, index: number): string {
  return dialect === 'pg' ? `$${index}` : '?';
}

function wrapModel(model: RawModel): DatabaseHostModel {
  return Object.freeze({
    select: (...fields: string[]) => {
      if (fields.includes('*')) throw new TypeError('select() requires explicit column names');
      const selection = model.select(...fields);
      const chain: DatabaseHostSelection = {
        where: (query) => { selection.where(query); return chain; },
        orderBy: (field, direction) => { selection.orderBy?.(field, direction); return chain; },
        limit: (count) => { selection.limit?.(count); return chain; },
        then: (onfulfilled, onrejected) => Promise.resolve(selection as unknown as PromiseLike<Record<string, unknown>[]>).then(onfulfilled, onrejected),
      };
      return chain;
    },
    insert: (row: Record<string, unknown>) => Promise.resolve(model.insert(row)),
    delete: () => ({ where: (query: Record<string, unknown>) => Promise.resolve(model.delete(query)) }),
    update: (patch: Record<string, unknown>) => ({ where: (query: Record<string, unknown>) => Promise.resolve(model.update(patch).where(query)) }),
  }) as DatabaseHostModel;
}

/** One database connection; tables are defined before {@link start}. */
export class ProjectDatabase {
  readonly config: ProjectDatabaseConfig;
  readonly #db: RawDatabase;
  readonly #tables = new Set<string>();
  readonly #wrapped = new Map<string, DatabaseHostModel>();
  #started = false;

  constructor(config: ProjectDatabaseConfig) {
    this.config = config;
    // `console` (the restricted Console account, ADR 0059) and `denyAttach` (instance only) never reach the driver.
    const { dialect, console: _console, denyAttach: _denyAttach, ...connection } = config as ProjectDatabaseConfig & { console?: unknown; denyAttach?: unknown };
    // No synchronous busy_timeout: it would block the gateway's event loop (ADR 0054 §7).
    const options = dialect === 'sqlite' && connection.busyRetryMs === undefined
      ? { ...connection, busyRetryMs: GATEWAY_SQLITE_BUSY_RETRY_MS }
      : connection;
    this.#db = Registry.create(dialect as keyof Registry.Config, options as never) as unknown as RawDatabase;
  }

  get dialect(): string {
    return this.config.dialect;
  }

  get started(): boolean {
    return this.#started;
  }

  define(name: string, definition: Record<string, unknown>): void {
    if (this.#started) throw new Error(`Project database already started; cannot define table ${name}`);
    if (this.#tables.has(name)) return;
    this.#tables.add(name);
    this.#db.define(name, definition);
  }

  tables(): readonly string[] {
    return [...this.#tables];
  }

  readonly models = Object.freeze({
    get: (name: string): DatabaseHostModel | undefined => {
      if (!this.#started) return undefined;
      const cached = this.#wrapped.get(name);
      if (cached) return cached;
      const raw = this.#db.models.get(name);
      if (!raw) return undefined;
      const model = wrapModel(raw);
      this.#wrapped.set(name, model);
      return model;
    },
  });

  /** Whether raw SQL / transactions are available (SQLite, MySQL, PostgreSQL). */
  get relational(): boolean {
    return SQL_DIALECTS.has(this.config.dialect);
  }

  #requireStarted(): void {
    if (!this.#started) throw new Error('Database is not connected');
  }

  #requireSql(): void {
    this.#requireStarted();
    if (!this.relational) throw new Error(`Raw SQL is not supported by '${this.config.dialect}'`);
  }

  /** One raw statement (gateway-internal: the gateway store, the legacy import and its revert). */
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T> {
    this.#requireSql();
    return this.#db.query<T>(sql, params);
  }

  /** A transaction (SQLite write transactions are `BEGIN IMMEDIATE`). */
  async transaction<T>(callback: (trx: ProjectDatabaseTransaction) => Promise<T>, options?: { readOnly?: boolean; repeatableRead?: boolean }): Promise<T> {
    this.#requireSql();
    return this.#db.transaction(trx => callback({ query: (sql, params) => trx.query(sql, params) }), {
      ...(options?.readOnly ? { readOnly: true } : {}),
      ...(options?.repeatableRead ? { isolationLevel: 'REPEATABLE_READ' as const } : {}),
    });
  }

  /** SQLite: a consistent copy of the file at `destination` (0600). */
  async backupTo(destination: string): Promise<void> {
    this.#requireStarted();
    if (this.config.dialect !== 'sqlite' || typeof this.#db.dialect?.backupTo !== 'function') {
      throw new Error(`File backups need SQLite (current: ${this.config.dialect})`);
    }
    await this.#db.dialect.backupTo(destination);
  }

  /** Which of `names` exist as tables (collections), read from the system catalog without defining them. */
  async tableExists(names: readonly string[]): Promise<string[]> {
    this.#requireStarted();
    if (!names.length) return [];
    const { dialect } = this.config;
    let present: string[];
    if (dialect === 'sqlite') {
      const rows = await this.query<Array<{ name: string }>>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names.map(() => '?').join(', ')})`, [...names]);
      present = rows.map(row => row.name);
    } else if (dialect === 'pg') {
      present = [];
      for (const name of names) {
        const [row] = await this.query<Array<{ present: unknown }>>('SELECT to_regclass($1) IS NOT NULL AS present', [quoteTableName('pg', name)]);
        if (row?.present === true) present.push(name);
      }
    } else if (dialect === 'mysql') {
      const rows = await this.query<Array<Record<string, unknown>>>(`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${names.map(() => '?').join(', ')})`, [...names]);
      present = rows.map(row => String(row.name ?? row.TABLE_NAME));
    } else if (dialect === 'mongodb') {
      const rows = await this.#db.query<Array<{ name: string }>>({ collection: names[0], operation: 'listCollections', filter: { name: { $in: [...names] } } });
      present = rows.map(row => row.name);
    } else {
      return [];
    }
    return names.filter(name => present.includes(name));
  }

  /**
   * All rows of `tables`, read in batches of {@link SNAPSHOT_BATCH_SIZE} ordered by `id`. SQL
   * dialects read inside one read-only repeatable-read transaction (one snapshot); MongoDB reads
   * the collections one after another.
   */
  async readSnapshot(tables: readonly string[]): Promise<TableRows> {
    this.#requireStarted();
    const { dialect } = this.config;
    const out: Record<string, Record<string, unknown>[]> = {};
    if (dialect === 'mongodb') {
      for (const table of tables) {
        const rows: Record<string, unknown>[] = [];
        let after: unknown;
        for (;;) {
          const batch = await this.#db.query<Record<string, unknown>[]>({
            collection: table,
            operation: 'find',
            filter: after === undefined ? {} : { id: { $gt: after } },
            sort: { id: 1 },
            limit: SNAPSHOT_BATCH_SIZE,
          });
          for (const document of batch) {
            const { _id: _ignored, ...row } = document;
            rows.push(row);
          }
          if (batch.length < SNAPSHOT_BATCH_SIZE) break;
          after = batch[batch.length - 1]!.id;
        }
        out[table] = rows;
      }
      return Object.freeze(out);
    }
    this.#requireSql();
    await this.transaction(async (trx) => {
      for (const table of tables) {
        const rows: Record<string, unknown>[] = [];
        let after: unknown;
        for (;;) {
          const where = after === undefined ? '' : ` WHERE id > ${placeholder(dialect, 1)}`;
          const batch = await trx.query<Record<string, unknown>[]>(
            `SELECT * FROM ${quoteTableName(dialect, table)}${where} ORDER BY id LIMIT ${SNAPSHOT_BATCH_SIZE}`,
            after === undefined ? [] : [after],
          );
          rows.push(...batch.map(row => ({ ...row })));
          if (batch.length < SNAPSHOT_BATCH_SIZE) break;
          after = batch[batch.length - 1]!.id;
        }
        out[table] = rows;
      }
    }, { readOnly: true, repeatableRead: dialect !== 'sqlite' });
    return Object.freeze(out);
  }

  /**
   * Drops `tables` if they exist: in one transaction on SQLite / PostgreSQL, one by one on MySQL
   * (DDL commits implicitly) and MongoDB, where an interrupted run resumes with the rest.
   */
  async dropTables(tables: readonly string[]): Promise<void> {
    this.#requireStarted();
    const { dialect } = this.config;
    if (dialect === 'mongodb') {
      for (const table of await this.tableExists(tables)) {
        await this.#db.query({ collection: table, operation: 'dropCollection', filter: {} });
      }
      return;
    }
    this.#requireSql();
    const statements = tables.map(table => `DROP TABLE IF EXISTS ${quoteTableName(dialect, table)}`);
    if (dialect === 'mysql') {
      for (const statement of statements) await this.query(statement);
      return;
    }
    await this.transaction(async (trx) => {
      for (const statement of statements) await trx.query(statement);
    });
  }

  /** The gateway's marker (ADR 0059 §3 修订): which gateway.db holds the Console accounts, or undefined. */
  async readStoreMarker(): Promise<StoreMarker | undefined> {
    this.#requireStarted();
    const { dialect } = this.config;
    if (!(await this.tableExists([GATEWAY_STORE_MARKER_TABLE])).length) return undefined;
    if (dialect === 'mongodb') {
      const [row] = await this.#db.query<Record<string, unknown>[]>({ collection: GATEWAY_STORE_MARKER_TABLE, operation: 'find', filter: { id: 'gateway' }, limit: 1 });
      return row ? markerOf(row) : undefined;
    }
    const [row] = await this.query<Record<string, unknown>[]>(`SELECT store_id, migrated_at FROM ${quoteTableName(dialect, GATEWAY_STORE_MARKER_TABLE)} WHERE id = ${placeholder(dialect, 1)}`, ['gateway']);
    return row ? markerOf(row) : undefined;
  }

  /** Writes (replaces) the marker. */
  async writeStoreMarker(marker: StoreMarker): Promise<void> {
    this.#requireStarted();
    const { dialect } = this.config;
    if (dialect === 'mongodb') {
      await this.#db.query({ collection: GATEWAY_STORE_MARKER_TABLE, operation: 'deleteMany', filter: { id: 'gateway' } });
      await this.#db.query({ collection: GATEWAY_STORE_MARKER_TABLE, operation: 'insertOne', filter: {} }, [{ id: 'gateway', store_id: marker.storeId, migrated_at: marker.migratedAt }]);
      return;
    }
    this.#requireSql();
    const table = quoteTableName(dialect, GATEWAY_STORE_MARKER_TABLE);
    await this.query(`CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(32) NOT NULL PRIMARY KEY, store_id VARCHAR(64) NOT NULL, migrated_at BIGINT NOT NULL)`);
    await this.transaction(async (trx) => {
      await trx.query(`DELETE FROM ${table} WHERE id = ${placeholder(dialect, 1)}`, ['gateway']);
      await trx.query(`INSERT INTO ${table} (id, store_id, migrated_at) VALUES (${placeholder(dialect, 1)}, ${placeholder(dialect, 2)}, ${placeholder(dialect, 3)})`, ['gateway', marker.storeId, marker.migratedAt]);
    });
  }

  /** Removes the marker (revert to a version without it). */
  async deleteStoreMarker(): Promise<void> {
    await this.dropTables([GATEWAY_STORE_MARKER_TABLE]);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    try {
      await this.#db.start();
    } catch (error) {
      await this.#db.stop().catch(() => undefined);
      throw error;
    }
    this.#started = true;
    this.#wrapped.clear();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#wrapped.clear();
    await this.#db.stop();
  }
}
