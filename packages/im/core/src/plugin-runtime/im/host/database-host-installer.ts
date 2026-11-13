import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  Registry,
  assertInstanceTable,
  ensureDatabaseColumns,
  GatewayOwnedTableError,
  isGatewayOwnedTable,
  referencesGatewayOwnedTable,
  RelatedModel,
  consoleConnectionOptions,
  probeConsoleCredential,
  refreshConsoleGrants,
  splitMysqlAccount,
  type Column, type StructuredDatabase, type TransactionContext } from '@zhin.js/database';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  guardTransactionModel,
  databaseHostToken,
  databaseRootHostToken,
  PluginDatabaseHost,
  rootPluginId,
  type DatabaseHost,
  type DatabaseHostConsole,
  type DatabaseHostConsoleCapabilities,
  type DatabaseHostExecuteResult,
  type DatabaseHostOrderBy,
  type DatabaseHostSchemaChange,
  type DatabaseHostSchemaPlan,
  type DatabaseHostTableSchema,
  type DatabaseHostModel,
  type DatabaseHostSelection,
  type DatabaseHostAggregation,
  type DatabaseTableOptions,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import {
  normalizeDatabaseHostConfig,
  type DatabaseHostConfig,
} from './database-config.js';
import { createDatabaseState, type StateDatabase } from './database-state.js';
import {
  ConsoleSqlRefusal,
  isProtectedConsoleTable,
  readOnlyConsoleStatement,
  redactConsoleSql,
  writeConsoleStatements,
  type ConsoleSqlDialect,
} from './database-console-sql.js';
import {
  ConsoleSchemaRefusal,
  introspectConsoleTable,
  listPhysicalTables,
  planConsoleSchemaChange,
  readMysqlColumnDefinition,
} from './database-console-schema.js';

const logger = getLogger('Database');

export type { DatabaseHostConfig } from './database-config.js';

type RawModel = {
  aggregate?(): DatabaseHostAggregation;
  select: (...fields: string[]) => {
    where(query: Record<string, unknown>): unknown;
    then?: unknown;
  };
  insert: (row: Record<string, unknown>) => unknown;
  delete: (query: Record<string, unknown>) => unknown;
  update: (patch: Record<string, unknown>) => {
    where(query: Record<string, unknown>): unknown;
  };
};

type RawConsoleModel = RawModel & {
  create?: (row: Record<string, unknown>) => unknown;
  updateById?: (id: string, row: Record<string, unknown>) => unknown;
  deleteById?: (id: string) => unknown;
  get?: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown, ttl?: number) => Promise<void>;
  deleteByKey?: (key: string) => Promise<unknown>;
  entries?: () => Promise<Array<[string, unknown]>>;
};

type RawDatabase = {
  define: (name: string, definition: unknown) => void;
  transaction<T>(callback: (transaction: TransactionContext<Record<string, Record<string, unknown>>>) => Promise<T>, options?: { isolationLevel?: 'REPEATABLE_READ'; readOnly?: boolean }): Promise<T>;
  start(): Promise<void>;
  stop(): Promise<void>;
  models: Map<string, RawConsoleModel>;
  definitions: Map<string, Record<string, unknown>>;
  dialect: {
    name: string;
    formatDropTable(name: string, ifExists?: boolean): unknown;
    mapColumnType(type: string): string;
    formatDefaultValue(value: unknown): string;
    formatColumnDefinition?(field: string, column: Record<string, unknown>): string;
    /** SQLite file databases: one read on its own connection in a child process (see `queryReadOnlyIsolated`). */
    supportsIsolatedReads?(): boolean;
    queryReadOnlyIsolated?(sql: string, options: { maxRows: number; timeoutMs: number }): Promise<{ columns: readonly string[]; rows: Record<string, unknown>[]; truncated: boolean }>;
  };
  dialectName: string;
  aggregate(name: string): {
    count(field: string, alias: string): { where(query: Record<string, unknown>): Promise<Array<{ total: number }>> };
  };
  query(query: unknown, params?: unknown[]): Promise<unknown>;
};

function wrapModel(model: RawModel, db?: RawDatabase, tableName?: string): DatabaseHostModel {
  return {
    ...(model.aggregate && db && ['sqlite', 'mysql', 'pg'].includes(db.dialectName) ? { aggregate: (): DatabaseHostAggregation => {
      const source = model.aggregate!();
      const chain: DatabaseHostAggregation = {
        min(field, alias) { source.min(field, alias); return chain; },
        max(field, alias) { source.max(field, alias); return chain; },
        groupBy(...fields) { source.groupBy(...fields); return chain; },
        where(query) { source.where(query); return chain; },
        then(resolve, reject) { return Promise.resolve(source).then(resolve, reject); },
      };
      return Object.freeze(chain);
    } } : {}),
    select: (...fields) => {
      if (fields.includes('*')) {
        throw new TypeError(
          'select() requires explicit column names; "*" is not supported '
          + '(pass real column names, e.g. select("id", "title")), or use count() for counting.',
        );
      }
      const selection = (model.select as (...args: string[]) => unknown)(...fields) as {
        where(query: Record<string, unknown>): unknown;
        orderBy?(field: string, direction?: 'ASC' | 'DESC'): unknown;
        limit?(count: number): unknown;
      };
      // 链式 + 可 await：console logs 页需要 orderBy/limit，插件侧 `await select().where(q)` 不变
      const chain: DatabaseHostSelection = {
        where: (query) => { selection.where(query); return chain; },
        orderBy: (field, direction) => { selection.orderBy?.(field, direction); return chain; },
        limit: (count) => { selection.limit?.(count); return chain; },
        then: (onfulfilled, onrejected) =>
          Promise.resolve(selection as unknown as PromiseLike<Record<string, unknown>[]>)
            .then(onfulfilled, onrejected),
      };
      return chain;
    },
    insert: (row) => Promise.resolve(model.insert(row)),
    delete: () => ({
      where: (query) => Promise.resolve(model.delete(query)),
    }),
    update: (patch) => ({
      where: (query) => Promise.resolve(model.update(patch).where(query)),
    }),
    // DB 侧 count 聚合（console /api/logs/stats 不再为计数整表加载）；
    // 方言不支持 aggregate（如 redis/mongodb）时降级为 select('id') 计数。
    count: async (where) => {
      const filter = where ?? {};
      if (db && tableName) {
        try {
          const counted = await db.aggregate(tableName).count('*', 'total').where(filter);
          const total = Number(counted[0]?.total);
          if (Number.isFinite(total)) return total;
        } catch {
          /* fall through to select('id') */
        }
      }
      const selection = (model.select as (...args: string[]) => unknown)('id') as {
        where(query: Record<string, unknown>): unknown;
      };
      const result = Object.keys(filter).length > 0 ? selection.where(filter) : selection;
      const rows = await Promise.resolve(result as PromiseLike<unknown[]>);
      return rows.length;
    },
  };
}

/** Test and composition knobs of {@link createDatabaseHost} (not part of the config file). */
export interface DatabaseHostInternalOptions {
  /**
   * Tests only: `false` turns the Console SQL text checks off (statement classification, refused
   * statements, the `console_*` name guard), so a test can show that the storage boundary alone
   * keeps the gateway's data out of reach (ADR 0059 §5). Default true.
   */
  readonly textGuard?: boolean;
  /** Minimum time between two probes of the restricted Console account after a failure (default 5 min). */
  readonly consoleProbeIntervalMs?: number;
  /** How long a successful probe is trusted before raw SQL probes again (default 60 s). */
  readonly consoleProbeTtlMs?: number;
  readonly now?: () => number;
  /**
   * Tests: opens the restricted account's connection from the options the host would pass to
   * `Registry.create` (default: `Registry.create`).
   */
  readonly openConsoleConnection?: (dialect: 'pg' | 'mysql', options: Readonly<Record<string, unknown>>) => unknown;
}

/** How long a failed restricted-account probe is kept before the next try. */
export const CONSOLE_CREDENTIAL_RETRY_MS = 5 * 60_000;
/** How long a successful probe is trusted (raw SQL probes again after this, and after any error). */
export const CONSOLE_CREDENTIAL_TTL_MS = 60_000;

/** Why raw SQL is off on PostgreSQL / MySQL without a restricted account. */
export const CONSOLE_ROLE_MISSING_REASON = 'Raw SQL on PostgreSQL / MySQL runs only on a restricted database account: run `zhin db console-role` (or `zhin doctor --fix`; `--print-sql` for a DBA) and restart';

export function createDatabaseHost(config: DatabaseHostConfig, internal: DatabaseHostInternalOptions = {}): DatabaseHost & {
  readonly db: { define: (name: string, definition: unknown) => void; start(): Promise<void>; stop(): Promise<void>; models: Map<string, unknown> };
} {
  // `console` (the restricted Console account) never reaches the main connection's driver.
  const { dialect, console: consoleCredential, ...connectionConfig } = config as DatabaseHostConfig & { console?: unknown };
  const db = Registry.create(
    dialect as keyof Registry.Config,
    connectionConfig as never,
  ) as unknown as RawDatabase;
  let started = false;
  const state = createDatabaseState(db as unknown as StateDatabase, config.dialect, () => started);
  const wrapped = new Map<string, DatabaseHostModel>();
  const definedTables = new Set<string>();
  const definitions = new Map<string, Record<string, unknown>>();
  const additions = new Map<string, Record<string, Column>>();
  let rawGuard: RawDatabase | undefined;
  const { port: consolePort, refreshDiscovered, refreshRawSql, stopConsoleSql } = createDatabaseConsole(
    db,
    config.dialect,
    () => started,
    definedTables,
    definitions,
    {
      textGuard: internal.textGuard !== false,
      restricted: restrictedConsoleConnection(config.dialect, connectionConfig, consoleCredential, internal.openConsoleConnection),
      retryMs: internal.consoleProbeIntervalMs ?? CONSOLE_CREDENTIAL_RETRY_MS,
      ttlMs: internal.consoleProbeTtlMs ?? CONSOLE_CREDENTIAL_TTL_MS,
      now: internal.now ?? Date.now,
    },
  );
  const modelOf = (name: string): DatabaseHostModel | undefined => {
    if (!started) return undefined;
    const cached = wrapped.get(name);
    if (cached) return cached;
    const raw = db.models.get(name) as RawModel | undefined;
    if (!raw) return undefined;
    const model = wrapModel(raw, db, name);
    wrapped.set(name, model);
    return model;
  };
  const defineTable = (name: string, definition: Record<string, unknown>, options?: DatabaseTableOptions): void => {
    const migration = Object.fromEntries((options?.addColumns ?? []).map(field => {
      const column = Object.hasOwn(definition, field) ? definition[field] : undefined;
      if (!column || typeof column !== 'object' || Array.isArray(column)
        || !('type' in column) || ('primary' in column && column.primary)
        || ('autoIncrement' in column && column.autoIncrement)
        || (!('nullable' in column && column.nullable === true) && !('default' in column))) {
        throw new TypeError(`Additive column '${field}' in '${name}' must be declared, nullable or defaulted, and not a primary key`);
      }
      return [field, structuredClone(column) as Column];
    }));
    const existing = definitions.get(name);
    // Host 跨世代共享：reload 后新世代会重复 define 同名表，
    // 定义一致则幂等跳过（即使已 started），不一致才报错。
    if (existing !== undefined) {
      if (isDeepStrictEqual(existing, definition)) {
        const previous = additions.get(name) ?? {};
        const merged = { ...previous, ...migration };
        if (started && !isDeepStrictEqual(previous, merged)) {
          throw new Error(`DatabaseHost already started; restart to migrate table ${name}`);
        }
        if (Object.keys(merged).length) additions.set(name, merged);
        return;
      }
      throw new Error(`Table '${name}' already defined with a different definition`);
    }
    if (started) {
      throw new Error(`DatabaseHost already started; cannot define table ${name}`);
    }
    definedTables.add(name);
    definitions.set(name, definition);
    if (Object.keys(migration).length) additions.set(name, migration);
    db.define(name, definition);
  };

  return {
    db,
    state,
    get dialect() {
      return config.dialect;
    },
    get started() {
      return started;
    },
    define(name, definition, options) {
      assertInstanceTable(name);
      defineTable(name, definition, options);
    },
    tables() {
      return [...definedTables].filter(name => !isGatewayOwnedTable(name));
    },
    models: {
      get(name) {
        return isGatewayOwnedTable(name) ? undefined : modelOf(name);
      },
    },
    async transaction(callback) {
      if (!started) throw new Error('Database is not connected');
      if (!['sqlite', 'mysql', 'pg'].includes(config.dialect)) throw new Error(`Transactions are not supported by '${config.dialect}'`);
      return db.transaction(async transaction => {
        let active = true;
        try {
          return await callback({ model(name) {
            if (!active) throw new Error('Database transaction is already closed');
            assertInstanceTable(name);
            if (!definedTables.has(name)) throw new Error(`Table '${name}' is not registered`);
            return guardTransactionModel({
              select: (...fields) => {
                if (fields.includes('*')) {
                  throw new TypeError(
                    'select() requires explicit column names; "*" is not supported '
                    + '(pass real column names, e.g. select("id", "title")), or use count() for counting.',
                  );
                }
                const selection = transaction.select(name, fields) as {
                  where(query: Record<string, unknown>): unknown;
                  orderBy?(field: string, direction?: 'ASC' | 'DESC'): unknown;
                  limit?(count: number): unknown;
                };
                const chain: DatabaseHostSelection = {
                  where: (query) => { selection.where(query); return chain; },
                  orderBy: (field, direction) => { selection.orderBy?.(field, direction); return chain; },
                  limit: (count) => { selection.limit?.(count); return chain; },
                  then: (onfulfilled, onrejected) =>
                    Promise.resolve(selection as unknown as PromiseLike<Record<string, unknown>[]>)
                      .then(onfulfilled, onrejected),
                };
                return chain;
              },
              insert: row => transaction.insert(name, row),
              update: patch => ({ where: async query => transaction.update(name, patch).where(query) }),
              delete: () => ({ where: async query => transaction.delete(name).where(query) }),
            }, () => { if (!active) throw new Error('Database transaction is already closed'); });
          } });
        } finally { active = false; }
      }, { isolationLevel: 'REPEATABLE_READ' });
    },
    console: consolePort,
    getRawDatabase() {
      if (!started) return undefined;
      return rawGuard ??= guardRawDatabase(db);
    },
    async start() {
      if (started) return;
      try {
        await db.start();
        for (const [table, columns] of additions) {
          await ensureDatabaseColumns(db as unknown as StructuredDatabase, table, columns);
        }
        started = true;
        wrapped.clear();
        await refreshDiscovered().catch((error: unknown) => {
          logger.debug(formatCompact({ op: 'database_discover_failed', error: error instanceof Error ? error.message : String(error) }));
        });
        await refreshRawSql();
        logger.debug(formatCompact({ op: 'database_start', dialect: config.dialect }));
      } catch (error) {
        await db.stop().catch(() => undefined);
        throw error;
      }
    },
    async stop() {
      if (!started) return;
      await stopConsoleSql();
      await db.stop();
      started = false;
      wrapped.clear();
    },
  };
}

const SQL_DIALECTS: ReadonlySet<string> = new Set(['sqlite', 'mysql', 'pg']);
const FILTER_OPERATORS = Object.freeze(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$like', '$nlike', '$in', '$nin']);
const FILTER_OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS);
/** Row cap and statement timeout of the Console SQL editor. */
export const CONSOLE_QUERY_MAX_ROWS = 1000;
export const CONSOLE_QUERY_TIMEOUT_MS = 10_000;
const DML = /^\(*\s*(?:insert|update|delete|replace)\b/;
/** Read kinds PostgreSQL can run behind a cursor (`DECLARE … CURSOR FOR`). */
const PG_CURSOR_KINDS: ReadonlySet<string> = new Set(['select', 'with', 'values']);
const PG_CONSOLE_CURSOR = 'zhin_console_cursor';

/** One transaction of the Console SQL editor. */
interface ConsoleTransaction {
  /** Fixed SQL the Host itself wrote (`SET LOCAL …`). */
  run(sql: string): Promise<unknown>;
  /** SQL a person typed: exactly one statement through the dialect's single-statement protocol. */
  statement(sql: string, options?: { maxRows?: number }): Promise<unknown>;
}

function cappedRows(result: unknown, maxRows: number): { rows: Record<string, unknown>[]; truncated: boolean } {
  const all = Array.isArray(result) ? result as Record<string, unknown>[] : [];
  const flagged = (result as { truncated?: unknown } | undefined)?.truncated === true;
  return { rows: all.slice(0, maxRows), truncated: flagged || all.length > maxRows };
}

/** Thrown for a malformed `where` / `orderBy` of `db:select`. */
export class ConsoleSelectRefusal extends Error {
  readonly code = 'invalid';
  constructor(message: string) {
    super(message);
    this.name = 'ConsoleSelectRefusal';
  }
}

/** Where raw Console SQL runs: the main connection (SQLite) or the restricted account's own pool. */
interface ConsoleSqlExecutor {
  transaction: RawDatabase['transaction'];
  query(sql: string): Promise<unknown>;
}

interface RestrictedConsoleConnection {
  readonly user: string;
  open(): RawDatabase;
}

/**
 * PostgreSQL / MySQL: a lazily opened pool (at most 2 connections, session reset on release) that
 * logs in as `database.console.user`, built by `consoleConnectionOptions` (`@zhin.js/database`):
 * nothing of the main account's credentials — fields, connection string, URI query — reaches it;
 * MySQL connections refuse `LOAD DATA LOCAL` and multiple statements.
 */
function restrictedConsoleConnection(
  dialect: string,
  connection: Record<string, unknown>,
  credential: unknown,
  openConnection?: DatabaseHostInternalOptions['openConsoleConnection'],
): RestrictedConsoleConnection | undefined {
  if (dialect !== 'pg' && dialect !== 'mysql') return undefined;
  if (!credential || typeof credential !== 'object') return undefined;
  const { user, password } = credential as { user?: unknown; password?: unknown };
  if (typeof user !== 'string' || !user || typeof password !== 'string' || !password) return undefined;
  return Object.freeze({
    user,
    open: () => {
      const options = Object.freeze(consoleConnectionOptions(dialect, connection, { user, password }));
      if (openConnection) return openConnection(dialect, options) as RawDatabase;
      return Registry.create(dialect as keyof Registry.Config, options as never) as unknown as RawDatabase;
    },
  });
}

/** Why a MySQL restricted connection is unsafe after connecting (the driver's merged config), or undefined. */
function mysqlConnectionProblem(candidate: RawDatabase): string | undefined {
  const safety = (candidate as unknown as { dialect?: { connectionSafety?(): { localFiles: boolean; multipleStatements: boolean } | undefined } }).dialect?.connectionSafety?.();
  if (!safety) return undefined;
  if (safety.localFiles) return 'the restricted MySQL connection would allow LOAD DATA LOCAL';
  if (safety.multipleStatements) return 'the restricted MySQL connection would allow multiple statements';
  return undefined;
}

interface ConsoleSqlOptions {
  readonly textGuard: boolean;
  readonly restricted: RestrictedConsoleConnection | undefined;
  readonly retryMs: number;
  readonly ttlMs: number;
  readonly now: () => number;
}

function createDatabaseConsole(
  db: RawDatabase,
  configuredDialect: string,
  isStarted: () => boolean,
  tableNames: Set<string>,
  definitions: Map<string, Record<string, unknown>>,
  sqlOptions: ConsoleSqlOptions,
): { port: DatabaseHostConsole; refreshDiscovered(): Promise<void>; refreshRawSql(): Promise<void>; stopConsoleSql(): Promise<void> } {
  const type = databaseType(configuredDialect);
  const sqlDialect: ConsoleSqlDialect | undefined = type === 'related' && SQL_DIALECTS.has(configuredDialect)
    ? configuredDialect as ConsoleSqlDialect
    : undefined;
  const sqlIsolation = sqlDialect === 'sqlite' ? 'separate-store' as const : sqlDialect ? 'restricted-credential' as const : undefined;
  /** Physical tables no code declared (created from the Console, left by removed plugins). */
  const discovered = new Map<string, Record<string, unknown>>();
  const capabilities: DatabaseHostConsoleCapabilities = Object.freeze({
    sort: type !== 'keyvalue',
    filterOperators: type === 'keyvalue' ? Object.freeze([]) : FILTER_OPERATORS,
    sql: !!sqlDialect,
    schema: !!sqlDialect,
    ...(sqlIsolation ? { sqlIsolation } : {}),
    ...(sqlDialect ? {} : { reason: `SQL and schema editing need SQLite, MySQL or PostgreSQL (current: ${configuredDialect})` }),
  });
  const listed = () => [...tableNames, ...[...discovered.keys()].filter(name => !tableNames.has(name))]
    .filter(name => !isGatewayOwnedTable(name));
  const requireModel = (table: string): RawConsoleModel => {
    // Gateway tables (console_users, sessions, tokens, audit) are never reachable from here.
    assertInstanceTable(table);
    if (!isStarted()) throw new Error('Database is not connected');
    const model = db.models.get(table);
    if (!model) throw new Error(`Table '${table}' not found`);
    return model;
  };
  const requireSql = (): ConsoleSqlDialect => {
    if (!isStarted()) throw new Error('Database is not connected');
    if (!sqlDialect) throw new ConsoleSqlRefusal('unsupported', capabilities.reason ?? 'SQL is not supported by this database');
    return sqlDialect;
  };
  /** Why raw SQL (`db:query` / `db:execute`) is off on this connection, if it is. */
  let rawSqlProblem: string | undefined;
  // ---- the restricted account (PostgreSQL / MySQL, ADR 0059 §4)
  let restrictedDb: RawDatabase | undefined;
  /** Why the restricted account cannot be used (undefined once probed ok). */
  let accessProblem: string | undefined = sqlDialect && sqlDialect !== 'sqlite'
    ? (sqlOptions.restricted ? 'The restricted Console database account has not been checked yet' : CONSOLE_ROLE_MISSING_REASON)
    : undefined;
  let lastProbeAt: number | undefined;
  /** Set after an error on the restricted connection: probe again before the next use. */
  let probeStale = false;
  /** Why raw SQL is off, as a code the Console can act on. */
  let accessProblemCode: 'console-role-missing' | 'console-role-invalid' | undefined = sqlDialect && sqlDialect !== 'sqlite'
    ? (sqlOptions.restricted ? 'console-role-invalid' : 'console-role-missing')
    : undefined;
  const closeRestricted = async (): Promise<void> => {
    const current = restrictedDb;
    restrictedDb = undefined;
    await current?.stop().catch(() => undefined);
  };
  /**
   * Opens and probes the restricted account (and, on PostgreSQL, refreshes its grants with the
   * main account first — instance tables granted, `console_*` / marker grants revoked). A healthy
   * account is probed again on its own connection after `ttlMs` and after any error; a failure
   * keeps raw SQL off and is retried at most every `retryMs`.
   */
  const refreshConsoleAccess = async (force = false): Promise<void> => {
    if (!sqlDialect || sqlDialect === 'sqlite' || !sqlOptions.restricted || !isStarted()) return;
    const now = sqlOptions.now();
    const healthy = restrictedDb !== undefined && accessProblem === undefined;
    if (!force && healthy && !probeStale && lastProbeAt !== undefined && now - lastProbeAt < sqlOptions.ttlMs) return;
    if (!force && !healthy && lastProbeAt !== undefined && now - lastProbeAt < sqlOptions.retryMs) return;
    lastProbeAt = now;
    probeStale = false;
    const restricted = sqlOptions.restricted;
    try {
      const mainUser = await mainAccount(sqlDialect, sql => db.query(sql));
      if (sqlDialect === 'pg') {
        await refreshConsoleGrants((sql, params) => db.query(sql, params), { role: restricted.user }).catch((error: unknown) => {
          logger.warn(formatCompact({ op: 'database_console_grants_failed', error: error instanceof Error ? error.message : String(error) }));
        });
      }
      let candidate = healthy ? restrictedDb! : undefined;
      if (!candidate) {
        await closeRestricted();
        candidate = restricted.open();
        await candidate.start();
      }
      const opened = candidate;
      const unsafe = sqlDialect === 'mysql' ? mysqlConnectionProblem(opened) : undefined;
      const probe = unsafe ? { ok: false, problems: [unsafe] } : await probeConsoleCredential((sql, params) => opened.query(sql, params), {
        dialect: sqlDialect, expectedUser: restricted.user, ...(mainUser ? { mainUser } : {}),
      }).catch(async (error: unknown) => {
        await opened.stop().catch(() => undefined);
        if (restrictedDb === opened) restrictedDb = undefined;
        throw error;
      });
      if (!probe.ok) {
        await opened.stop().catch(() => undefined);
        if (restrictedDb === opened) restrictedDb = undefined;
        accessProblem = `The restricted Console database account is not restricted enough: ${probe.problems.join('; ')}`;
        accessProblemCode = 'console-role-invalid';
      } else {
        restrictedDb = opened;
        accessProblem = undefined;
        accessProblemCode = undefined;
      }
    } catch (error) {
      accessProblem = `The restricted Console database account cannot be used: ${error instanceof Error ? error.message : String(error)}`;
      accessProblemCode = 'console-role-invalid';
    }
    if (accessProblem) logger.warn(formatCompact({ op: 'database_console_role_unusable', reason: accessProblem }));
  };
  /** Marks the restricted account for a fresh probe after an error on it. */
  const onRestrictedError = <T>(work: Promise<T>): Promise<T> => (sqlDialect === 'sqlite' ? work : work.catch((error: unknown) => {
    probeStale = true;
    throw error;
  }));
  /** The connection raw Console SQL runs on. */
  const executor = (): ConsoleSqlExecutor | undefined => {
    if (sqlDialect === 'sqlite') return db;
    return accessProblem ? undefined : restrictedDb;
  };
  /** Code of `rawSqlProblem` (Console: `console-role-*` asks for `zhin db console-role`). */
  let rawSqlProblemCode: DatabaseHostConsoleCapabilities['sqlReasonCode'];
  const refreshRawSql = async (): Promise<void> => {
    if (!sqlDialect || !isStarted()) return;
    await refreshConsoleAccess();
    const target = executor();
    if (!target) {
      rawSqlProblem = accessProblem;
      rawSqlProblemCode = accessProblemCode;
      return;
    }
    rawSqlProblemCode = sqlDialect === 'sqlite' ? 'sqlite-isolation' : 'text-compatibility';
    rawSqlProblem = await rawSqlCompatibilityProblem(sqlDialect, {
      query: (sql) => target.query(sql),
      isolatedReads: () => db.dialect.supportsIsolatedReads?.() === true,
    }).catch((error: unknown) => `Cannot check how the server reads SQL text: ${error instanceof Error ? error.message : String(error)}`);
  };
  const requireExecutor = (): ConsoleSqlExecutor => {
    const target = executor();
    if (!target) throw new ConsoleSqlRefusal('unsupported', accessProblem ?? 'Raw SQL is unavailable');
    return target;
  };
  /** Raw SQL needs the server to read text as the Console lexer does (checked again on every run). */
  const requireRawSql = async (): Promise<ConsoleSqlDialect> => {
    const dialect = requireSql();
    await refreshRawSql();
    if (rawSqlProblem) throw new ConsoleSqlRefusal('unsupported', rawSqlProblem);
    return dialect;
  };
  const currentCapabilities = (): DatabaseHostConsoleCapabilities => (rawSqlProblem && sqlDialect
    ? Object.freeze({ ...capabilities, sql: false, sqlReason: rawSqlProblem, ...(rawSqlProblemCode ? { sqlReasonCode: rawSqlProblemCode } : {}), reason: rawSqlProblem })
    : capabilities);
  const describe = async (table: string): Promise<DatabaseHostTableSchema> => {
    assertInstanceTable(table);
    const dialect = requireSql();
    const schema = await introspectConsoleTable(dialect, (sql, params) => db.query(sql, params), table);
    if (!schema.columns.length) throw new ConsoleSchemaRefusal('not_found', `Table '${table}' not found`);
    return schema;
  };
  const columnsOf = async (table: string): Promise<readonly string[] | undefined> => {
    const declared = definitions.get(table) ?? discovered.get(table);
    if (declared) return Object.keys(declared);
    if (sqlDialect) return (await describe(table)).columns.map(column => column.name);
    return undefined;
  };
  const refreshDiscovered = async (): Promise<void> => {
    if (!sqlDialect || !isStarted()) return;
    const physical = await listPhysicalTables(sqlDialect, (sql, params) => db.query(sql, params));
    const present = new Set(physical);
    for (const name of [...discovered.keys()]) if (!present.has(name)) discovered.delete(name);
    for (const name of physical) {
      if (tableNames.has(name) || isProtectedConsoleTable(name)) continue;
      const schema = await introspectConsoleTable(sqlDialect, (sql, params) => db.query(sql, params), name);
      discovered.set(name, Object.fromEntries(schema.columns.map(column => [column.name, {
        type: column.type,
        ...(column.primary ? { primary: true } : {}),
        ...(column.nullable ? {} : { nullable: false }),
      }])));
      if (!db.models.has(name)) db.models.set(name, new RelatedModel(db as never, name as never) as unknown as RawConsoleModel);
    }
  };
  /** Runs `body` in one transaction; `rollback` discards it after collecting the result. */
  const inTransaction = async <T>(body: (trx: ConsoleTransaction) => Promise<T>, options: { readOnly?: boolean; rollback?: boolean; timeoutMs?: number }, on: ConsoleSqlExecutor = db): Promise<T> => {
    const dialect = requireSql();
    const discard = Symbol('rollback');
    let result: T | undefined;
    try {
      await on.transaction(async trx => {
        const run = (sql: string) => trx.query(sql);
        const statement = (sql: string, statementOptions?: { maxRows?: number }) => {
          if (!trx.queryStatement) throw new Error('This database driver cannot run single statements');
          return trx.queryStatement(sql, statementOptions);
        };
        const timeout = Math.max(1, Math.floor(options.timeoutMs ?? CONSOLE_QUERY_TIMEOUT_MS));
        // SET LOCAL ends with the transaction; Console SQL cannot lift it (SET / set_config are refused).
        if (dialect === 'pg') await run(`SET LOCAL statement_timeout = ${timeout}`);
        if (dialect === 'mysql' && options.readOnly) await run(`SET SESSION max_execution_time = ${timeout}`);
        try {
          result = await body({ run, statement });
        } finally {
          if (dialect === 'mysql' && options.readOnly) await run('SET SESSION max_execution_time = DEFAULT').catch(() => undefined);
        }
        if (options.rollback) throw discard;
      }, options.readOnly ? { readOnly: true } : undefined);
    } catch (error) {
      if (error === discard) return result as T;
      // Probe the restricted account again before its next use (it may have changed).
      if (on !== db) probeStale = true;
      throw error;
    }
    return result as T;
  };
  const syncAfterSchemaChange = async (change: DatabaseHostSchemaChange): Promise<void> => {
    if (change.kind === 'create-table') {
      discovered.set(change.table, Object.fromEntries(change.columns.map(column => [column.name, { ...column, name: undefined }])
        .map(([name, column]) => [name, Object.fromEntries(Object.entries(column as Record<string, unknown>).filter(([key, value]) => key !== 'name' && value !== undefined))])));
      if (!db.models.has(change.table)) db.models.set(change.table, new RelatedModel(db as never, change.table as never) as unknown as RawConsoleModel);
      return;
    }
    const declared = definitions.get(change.table);
    if (!declared) {
      await refreshDiscovered();
      return;
    }
    // Keep the declared definition (its Zhin types) in step with the physical table.
    const next: Record<string, unknown> = { ...declared };
    if (change.kind === 'add-column') {
      const { name, ...column } = change.column;
      next[name] = column;
    } else if (change.kind === 'alter-column') {
      const previous = (next[change.column] ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...previous };
      if (change.type) merged.type = change.type;
      if (change.nullable !== undefined) merged.nullable = change.nullable;
      if (change.default !== undefined) merged.default = change.default;
      if (change.dropDefault) delete merged.default;
      next[change.column] = merged;
    } else {
      return;
    }
    definitions.set(change.table, next);
    db.definitions.set(change.table, next);
  };
  const plan = async (change: unknown): Promise<DatabaseHostSchemaPlan> => {
    const dialect = requireSql();
    await refreshDiscovered();
    return planConsoleSchemaChange(change, {
      dialect,
      host: db.dialect,
      hasTable: table => tableNames.has(table) || discovered.has(table),
      isDeclared: table => tableNames.has(table),
      describe,
      ...(dialect === 'mysql' ? { mysqlColumn: (table: string, column: string) => readMysqlColumnDefinition((sql, params) => db.query(sql, params), table, column) } : {}),
    });
  };

  const port: DatabaseHostConsole = {
    info: () => ({
      dialect: configuredDialect,
      type,
      tables: listed(),
      connected: isStarted(),
      capabilities: currentCapabilities(),
    }),
    tables: () => listed().map((name) => ({
      name,
      columns: definitions.get(name) ?? discovered.get(name),
      ...(tableNames.has(name) ? {} : { discovered: true }),
    })),
    async select(table, page, pageSize, where, orderBy) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.entries) throw new Error(`Table '${table}' is not a key-value bucket`);
        const all = await model.entries();
        const start = (page - 1) * pageSize;
        return {
          rows: all.slice(start, start + pageSize).map(([key, value]) => ({ key, value })),
          total: all.length,
          page,
          pageSize,
        };
      }
      const filter = where ?? {};
      const columns = type === 'related' ? await columnsOf(table) : undefined;
      validateWhere(filter, columns, 0);
      const order = orderBy ? validateOrderBy(orderBy, columns) : undefined;
      let total: number;
      try {
        const counted = await db.aggregate(table).count('*', 'total').where(filter);
        total = Number(counted[0]?.total ?? 0);
      } catch {
        const all = await (model.select() as unknown as PromiseLike<unknown[]>);
        total = all.length;
      }
      let selection = model.select() as unknown as {
        where(query: Record<string, unknown>): typeof selection;
        orderBy(field: string, direction: 'ASC' | 'DESC'): typeof selection;
        limit(value: number): typeof selection;
        offset(value: number): Promise<unknown[]>;
      };
      if (Object.keys(filter).length > 0) selection = selection.where(filter);
      if (order) {
        selection = selection.orderBy(order.column, order.direction === 'desc' ? 'DESC' : 'ASC');
        // A unique tie-breaker keeps pages stable when many rows share the sorted value.
        const tieBreaker = primaryKeyOf(definitions.get(table) ?? discovered.get(table)) ?? (type === 'document' ? '_id' : undefined);
        if (tieBreaker && tieBreaker !== order.column) selection = selection.orderBy(tieBreaker, 'ASC');
      }
      const rows = await selection.limit(pageSize).offset((page - 1) * pageSize);
      return { rows, total, page, pageSize, ...(order ? { orderBy: order } : {}) };
    },
    async insert(table, row) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.set || row.key == null) throw new Error('key is required for KV insert');
        await model.set(String(row.key), row.value);
      } else if (type === 'document' && model.create) {
        await model.create(row);
      } else {
        await model.insert(row);
      }
    },
    async update(table, row, where) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.set || where.key == null) throw new Error('key is required for KV update');
        await model.set(String(where.key), row.value);
        return 1;
      }
      if (type === 'document' && where._id != null && model.updateById) {
        return await model.updateById(String(where._id), row);
      }
      return await model.update(row).where(where);
    },
    async delete(table, where) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.deleteByKey || where.key == null) throw new Error('key is required for KV delete');
        await model.deleteByKey(String(where.key));
        return 1;
      }
      if (type === 'document' && where._id != null && model.deleteById) {
        return await model.deleteById(String(where._id));
      }
      return await model.delete(where);
    },
    async dropTable(table) {
      requireModel(table);
      await db.query(db.dialect.formatDropTable(table, true));
      db.models.delete(table);
      db.definitions.delete(table);
      tableNames.delete(table);
      definitions.delete(table);
      discovered.delete(table);
    },
    async kvGet(table, key) {
      const model = requireModel(table);
      if (!model.get) throw new Error(`Table '${table}' is not a key-value bucket`);
      return await model.get(key);
    },
    async kvSet(table, key, value, ttl) {
      const model = requireModel(table);
      if (!model.set) throw new Error(`Table '${table}' is not a key-value bucket`);
      await model.set(key, value, ttl);
    },
    async kvDelete(table, key) {
      const model = requireModel(table);
      if (!model.deleteByKey) throw new Error(`Table '${table}' is not a key-value bucket`);
      await model.deleteByKey(key);
    },
    async kvEntries(table) {
      const model = requireModel(table);
      if (!model.entries) throw new Error(`Table '${table}' is not a key-value bucket`);
      return (await model.entries()).map(([key, value]) => ({ key, value }));
    },
    async query(sql, options) {
      const dialect = await requireRawSql();
      const on = requireExecutor();
      const statement = sqlOptions.textGuard ? readOnlyConsoleStatement(sql, dialect) : { text: sql, kind: 'unchecked' as const };
      const maxRows = Math.min(Math.max(1, Math.floor(options?.maxRows ?? CONSOLE_QUERY_MAX_ROWS)), CONSOLE_QUERY_MAX_ROWS);
      const timeoutMs = Math.max(1, Math.floor(options?.timeoutMs ?? CONSOLE_QUERY_TIMEOUT_MS));
      const started = Date.now();
      let read: { rows: Record<string, unknown>[]; truncated: boolean; columns?: readonly string[] };
      if (dialect === 'sqlite' && db.dialect.supportsIsolatedReads?.() && db.dialect.queryReadOnlyIsolated) {
        // node:sqlite cannot interrupt a statement: run it in a child process, killed at the budget.
        read = await db.dialect.queryReadOnlyIsolated(statement.text, { maxRows, timeoutMs });
      } else {
        read = await inTransaction(async trx => {
          if (dialect === 'pg' && PG_CURSOR_KINDS.has(statement.kind)) {
            // A cursor reads only the rows the cap keeps instead of the whole result.
            await trx.statement(`DECLARE ${PG_CONSOLE_CURSOR} NO SCROLL CURSOR FOR\n${statement.text}\n`);
            return cappedRows(await trx.statement(`FETCH FORWARD ${maxRows + 1} FROM ${PG_CONSOLE_CURSOR}`), maxRows);
          }
          return cappedRows(await trx.statement(statement.text, { maxRows }), maxRows);
        }, { readOnly: true, rollback: true, timeoutMs }, on);
      }
      const rows = read.rows.map(jsonSafeRow);
      const columns = read.columns?.length ? [...read.columns] : [...new Set(rows.flatMap(row => Object.keys(row)))];
      return Object.freeze({ columns, rows, rowCount: rows.length, truncated: read.truncated, durationMs: Date.now() - started });
    },
    async execute(sql, options) {
      const dialect = await requireRawSql();
      const on = requireExecutor();
      const statements = sqlOptions.textGuard ? writeConsoleStatements(sql, dialect) : [{ text: sql, code: sql.trim().toLowerCase() }];
      const dryRun = options?.dryRun === true;
      const started = Date.now();
      const runAll = async (run: (text: string) => Promise<unknown>) => {
        const results: DatabaseHostExecuteResult['statements'][number][] = [];
        for (const statement of statements) results.push(statementResult(statement.text, await run(statement.text)));
        return results;
      };
      // Every statement goes through the single-statement protocol, so a COMMIT the lexer missed
      // cannot ride along (and transaction control is refused): a dry run always rolls back.
      // MySQL commits DDL implicitly: only all-DML batches run in a transaction (and can be dry-run).
      const transactional = dialect !== 'mysql' || statements.every(statement => DML.test(statement.code));
      if (!transactional && dryRun) {
        return Object.freeze({ statements: statements.map(statement => ({ sql: statement.text })), dryRun, estimateUnavailable: true, durationMs: 0 });
      }
      const results = transactional
        ? await inTransaction(trx => runAll(text => trx.statement(text)), { rollback: dryRun, ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }, on)
        // MySQL DDL: dialect queries are prepared statements (one statement each).
        : await runAll(text => onRestrictedError(on.query(text)));
      if (!dryRun) await refreshDiscovered().catch(() => undefined);
      return Object.freeze({ statements: Object.freeze(results), dryRun, durationMs: Date.now() - started });
    },
    redactSql: (sql: string) => redactConsoleSql(sql, sqlDialect ?? 'mysql'),
    describe,
    previewSchema: plan,
    async applySchema(change, confirm) {
      const dialect = requireSql();
      const planned = await plan(change);
      // The planned DDL travels with a failure too, so the audit log records what was attempted.
      const attempted = <E>(error: E): E => {
        if (error && typeof error === 'object' && !Object.isFrozen(error)) {
          Object.defineProperty(error, 'statements', { value: planned.statements, enumerable: false, configurable: true });
        }
        return error;
      };
      if (planned.destructive && confirm !== planned.confirm) {
        throw attempted(new ConsoleSchemaRefusal('confirm_required', `Type '${planned.confirm}' to confirm this change`));
      }
      try {
        if (dialect === 'mysql') {
          for (const statement of planned.statements) await db.query(statement);
        } else {
          await inTransaction(async trx => { for (const statement of planned.statements) await trx.run(statement); }, {});
        }
      } catch (error) {
        throw attempted(error);
      }
      await syncAfterSchemaChange(planned.change);
      return planned;
    },
  };
  return { port: Object.freeze(port), refreshDiscovered, refreshRawSql, stopConsoleSql: closeRestricted };
}

/** The main account's name (PostgreSQL `current_user`, MySQL user part of `CURRENT_USER()`). */
async function mainAccount(dialect: ConsoleSqlDialect, query: (sql: string) => Promise<unknown>): Promise<string | undefined> {
  const rows = await query(dialect === 'pg' ? 'SELECT current_user AS account' : 'SELECT CURRENT_USER() AS account') as Array<{ account?: unknown }>;
  const account = rows?.[0]?.account;
  if (typeof account !== 'string') return undefined;
  return dialect === 'mysql' ? splitMysqlAccount(account).user : account;
}

/**
 * Why the Console must not run raw SQL on this connection, or undefined. The Console lexer reads
 * strings the way the server does by default; a server that treats backslashes (MySQL
 * `NO_BACKSLASH_ESCAPES`, PostgreSQL `standard_conforming_strings = off`) or double quotes (MySQL
 * `ANSI_QUOTES`) differently would split and classify statements differently. SQLite needs a file
 * database: only a separate connection can be stopped at the time limit.
 */
export async function rawSqlCompatibilityProblem(
  dialect: ConsoleSqlDialect,
  probe: { query(sql: string): Promise<unknown>; isolatedReads(): boolean },
): Promise<string | undefined> {
  if (dialect === 'sqlite') {
    return probe.isolatedReads() ? undefined : 'The SQL console is unsupported for an in-memory SQLite database (a query could not be stopped at the time limit)';
  }
  if (dialect === 'pg') {
    const rows = await probe.query('SELECT current_setting(\'standard_conforming_strings\') AS value') as Record<string, unknown>[];
    const value = String(rows?.[0]?.value ?? '').toLowerCase();
    return value === 'on' ? undefined : `The SQL console needs standard_conforming_strings = on (the server reports '${value || 'unknown'}'), so that it reads string literals as the server does`;
  }
  const rows = await probe.query('SELECT @@SESSION.sql_mode AS mode') as Record<string, unknown>[];
  const modes = String(rows?.[0]?.mode ?? '').toUpperCase().split(',').map(mode => mode.trim());
  const conflicting = modes.filter(mode => mode === 'NO_BACKSLASH_ESCAPES' || mode === 'ANSI_QUOTES' || mode === 'ANSI');
  return conflicting.length ? `The SQL console is off while sql_mode contains ${conflicting.join(', ')}: the server would read string literals differently from the Console` : undefined;
}

function primaryKeyOf(definition: Record<string, unknown> | undefined): string | undefined {
  if (!definition) return undefined;
  return Object.entries(definition).find(([, column]) => column && typeof column === 'object' && (column as { primary?: unknown }).primary === true)?.[0];
}

function validateOrderBy(orderBy: DatabaseHostOrderBy, columns: readonly string[] | undefined): DatabaseHostOrderBy {
  const column = typeof orderBy?.column === 'string' ? orderBy.column : '';
  if (!column || column.startsWith('$') || (columns && !columns.includes(column))) throw new ConsoleSelectRefusal(`Unknown sort column '${column}'`);
  if (orderBy.direction !== 'asc' && orderBy.direction !== 'desc') throw new ConsoleSelectRefusal('Sort direction must be asc or desc');
  return Object.freeze({ column, direction: orderBy.direction });
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * `where` of `db:select`: known columns (related tables), allow-listed operators, scalar values.
 * Column names are checked because the query builder quotes identifiers without escaping.
 */
function validateWhere(where: Record<string, unknown>, columns: readonly string[] | undefined, depth: number): void {
  if (depth > 4) throw new ConsoleSelectRefusal('Filter is nested too deeply');
  const keys = Object.keys(where);
  if (keys.length > 50) throw new ConsoleSelectRefusal('Too many filter conditions');
  for (const key of keys) {
    const value = where[key];
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value) || !value.length || value.length > 50) throw new ConsoleSelectRefusal(`${key} needs a non-empty array of conditions`);
      for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.keys(entry).length) throw new ConsoleSelectRefusal(`${key} needs a non-empty array of conditions`);
        validateWhere(entry as Record<string, unknown>, columns, depth + 1);
      }
      continue;
    }
    if (key === '$not') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new ConsoleSelectRefusal('$not needs a condition');
      validateWhere(value as Record<string, unknown>, columns, depth + 1);
      continue;
    }
    if (key.startsWith('$') || (columns && !columns.includes(key))) throw new ConsoleSelectRefusal(`Unknown filter column '${key}'`);
    if (isScalar(value)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConsoleSelectRefusal(`Unsupported filter value for '${key}'`);
    const operators = Object.entries(value as Record<string, unknown>);
    // `{}` would compile to no condition (or invalid SQL) instead of filtering.
    if (!operators.length) throw new ConsoleSelectRefusal(`Filter on '${key}' needs an operator`);
    for (const [operator, operand] of operators) {
      if (!FILTER_OPERATOR_SET.has(operator)) throw new ConsoleSelectRefusal(`Unsupported filter operator '${operator}'`);
      const ok = operator === '$in' || operator === '$nin'
        ? Array.isArray(operand) && operand.length > 0 && operand.length <= 500 && operand.every(isScalar)
        : operator === '$like' || operator === '$nlike' ? typeof operand === 'string' : isScalar(operand);
      if (!ok) throw new ConsoleSelectRefusal(`Unsupported value for ${operator} on '${key}'`);
    }
  }
}

function statementResult(sql: string, result: unknown): DatabaseHostExecuteResult['statements'][number] {
  if (typeof result === 'number') return Object.freeze({ sql, affected: result });
  if (Array.isArray(result)) {
    const info = result as unknown as { rowCount?: unknown; command?: unknown };
    if (typeof info.rowCount === 'number' && /^(?:INSERT|UPDATE|DELETE|MERGE)$/.test(String(info.command))) {
      return Object.freeze({ sql, affected: info.rowCount });
    }
    return Object.freeze({ sql, ...(result.length ? { rows: result.length } : {}) });
  }
  if (result && typeof result === 'object') {
    const record = result as { changes?: unknown; affectedRows?: unknown };
    const affected = typeof record.changes === 'number' ? record.changes : typeof record.affectedRows === 'number' ? record.affectedRows : undefined;
    return Object.freeze({ sql, ...(affected !== undefined ? { affected } : {}) });
  }
  return Object.freeze({ sql });
}

/** JSON-safe cell values for the RPC reply (bigint, binary, dates). */
function jsonSafeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    if (typeof value === 'bigint') out[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (value instanceof Uint8Array) out[key] = `<binary ${value.byteLength} bytes>`;
    else out[key] = value;
  }
  return out;
}

/**
 * Root-only raw registry with the gateway's tables cut off: raw SQL naming them and table-name
 * arguments (`model`, `define`, `select`, …) are refused. Methods run on the real registry.
 */
/** Data properties of the raw registry a plugin may read through the guarded handle. */
const RAW_DATABASE_READABLE: ReadonlySet<PropertyKey> = new Set(['models', 'dialectName', 'isStarted', 'hasStarted', 'definitions']);
/** Properties of a model that lead back to the registry, its dialect or the driver. */
const MODEL_INTERNALS: ReadonlySet<PropertyKey> = new Set(['database', 'dialect', 'db', 'config']);

/** A model without its way back to the registry / dialect / driver handle. */
function guardRawModel<T extends object>(model: T): T {
  return new Proxy(model, {
    get(target, property) {
      if (MODEL_INTERNALS.has(property)) return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}

/** Read-only view of the registry's model map whose models are guarded too. */
function guardModelMap(models: Map<string, unknown>): Map<string, unknown> {
  return new Proxy(models, {
    get(target, property) {
      if (property === 'get') return (name: string) => { assertInstanceTable(name); const model = target.get(name); return model && typeof model === 'object' ? guardRawModel(model) : model; };
      if (property === 'set' || property === 'delete' || property === 'clear') return () => { throw new TypeError('The model map of the raw database handle is read-only'); };
      if (property === 'size') return target.size;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * Root-only raw registry with the gateway's tables cut off: raw SQL naming them and table-name
 * arguments (`model`, `define`, `select`, …) are refused. Methods run on the real registry. Data
 * properties are a frozen view: the dialect, its config and the driver handle (`dialect`, `config`,
 * `db`, …) are not reachable from it, so the handle cannot turn off `denyAttach` or reach the raw
 * `node:sqlite` connection. Plugins are trusted code in the same process and user (ADR 0059 §1):
 * this keeps accidental and Console / Agent-driven access off the gateway's data, it does not
 * contain a malicious plugin.
 */
function guardRawDatabase(db: RawDatabase): RawDatabase {
  const wrapped = new Map<PropertyKey, unknown>();
  let models: Map<string, unknown> | undefined;
  return new Proxy(db, {
    get(target, property) {
      // Getters run against the real registry (`dialectName` reads `this.dialect`).
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        if (!RAW_DATABASE_READABLE.has(property)) return undefined;
        if (property === 'models' && value instanceof Map) return models ??= guardModelMap(value as Map<string, unknown>);
        return value;
      }
      const cached = wrapped.get(property);
      if (cached) return cached;
      const guarded = function (this: unknown, ...args: unknown[]) {
        const [first] = args;
        if (property === 'query' && typeof first === 'string' && referencesGatewayOwnedTable(first)) {
          throw new GatewayOwnedTableError();
        }
        if (typeof first === 'string') assertInstanceTable(first);
        const result = (value as (...values: unknown[]) => unknown).apply(target, args);
        // `model(name)` hands out the same guarded view as `models.get(name)`.
        return property === 'model' && result && typeof result === 'object' ? guardRawModel(result as object) : result;
      };
      wrapped.set(property, guarded);
      return guarded;
    },
    // Methods may be replaced (instrumentation, tests): the replacement is guarded like the
    // original. Data properties (`dialect`, `config`, …) cannot be written through the handle.
    set(target, property, value) {
      if (typeof value !== 'function' || typeof Reflect.get(target, property, target) !== 'function') return false;
      wrapped.delete(property);
      return Reflect.set(target, property, value, target);
    },
    defineProperty(target, property, descriptor) {
      if (typeof descriptor.value !== 'function' || typeof Reflect.get(target, property, target) !== 'function') return false;
      wrapped.delete(property);
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      if (typeof Reflect.get(target, property, target) !== 'function') return false;
      wrapped.delete(property);
      return Reflect.deleteProperty(target, property);
    },
  });
}

function databaseType(dialect: string): 'related' | 'document' | 'keyvalue' {
  if (dialect === 'mongodb') return 'document';
  if (dialect === 'redis') return 'keyvalue';
  return 'related';
}

export async function resolveDatabaseConfig(
  projectRoot: string,
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<DatabaseHostConfig> {
  const document = await readConfigDocument(config);
  const configured = document && typeof document === 'object'
    ? (document as Record<string, unknown>).database
    : undefined;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    const value = configured as Record<string, unknown>;
    const dialect = typeof value.dialect === 'string' ? value.dialect : 'sqlite';
    return normalizeDatabaseHostConfig({ ...value, dialect });
  }
  const filename = join(projectRoot, '.zhin', 'data.sqlite');
  await mkdir(dirname(filename), { recursive: true });
  return Object.freeze({ dialect: 'sqlite', filename });
}

export function installDatabaseHost(host: DatabaseHost): RootResourceInstaller {
  return ({ resources, handoff, admission }) => {
    // Domain tables (e.g. github_oauth_users) are defined by owning plugins in setup().
    // Plugins receive a root-scoped facade through the historical token. The
    // raw host remains available only to CLI composition through its root token.
    resources.provide(databaseRootHostToken, host);
    resources.provide(databaseHostToken, new PluginDatabaseHost(rootPluginId(), host, admission));
    // Host 是进程级共享资源：不能随世代 dispose / 回滚 stop（旧世代仍在用）。
    // start 幂等，stop 由进程退出路径（start-command control.stop）统一触发。
    handoff.add({
      activateNext: async (signal) => {
        signal.throwIfAborted();
        await host.start();
        signal.throwIfAborted();
      },
    });
  };
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
