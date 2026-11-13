/**
 * Importing the Console access-control tables an earlier version kept in the project database
 * into `.zhin/gateway.db` (ADR 0059 §3), and putting them back (`zhin console migrate --revert`,
 * required before a downgrade). One function serves the gateway (while it connects), `zhin console
 * …` while no gateway runs, and a standalone instance.
 *
 * `gateway_meta.legacy_import` records the state: absent (not decided yet) → `fresh` (nothing to
 * import) | `copied` (rows are in gateway.db, old tables not dropped yet) → `done`. Until the
 * state is `fresh` or `done`, Console access control stays closed: an empty gateway.db must never
 * be taken for "no owner yet".
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { ProjectDatabaseConfig } from '../database/config.js';
import type { GatewayStore } from '../database/gateway-store.js';
import {
  ProjectDatabase,
  quoteTableName,
  isDatabaseBusyError,
  type ProjectDatabaseTransaction,
  type StoreMarker,
  type TableRows,
} from '../database/project-database.js';
import { defineConsoleIamTables, IAM_TABLE_DEFINITIONS, IAM_TABLES } from './tables.js';

export const LEGACY_IMPORT_KEY = 'legacy_import';
const TABLES: readonly string[] = Object.freeze(Object.values(IAM_TABLES));
/** Dialects that may hold the old tables (redis / memory never could). */
const SOURCE_DIALECTS: ReadonlySet<string> = new Set(['sqlite', 'mysql', 'pg', 'mongodb']);
const INSERT_BATCH = 500;

/** Where the rows came from, without secrets. */
export interface LegacySourceSummary {
  readonly dialect: string;
  readonly location: string;
}

export type LegacyImportRecord =
  | Readonly<{ status: 'fresh'; at: number; source: LegacySourceSummary; reason: 'no-tables' | 'no-database-file' | 'non-relational' | 'reset-store' }>
  | Readonly<{
    status: 'copied';
    at: number;
    source: LegacySourceSummary;
    counts: Readonly<Record<string, number>>;
    checksums: Readonly<Record<string, string>>;
    /** Columns each checksum covers. */
    columns: Readonly<Record<string, readonly string[]>>;
    /** Project-relative directory of `console-tables.json`. */
    backup: string;
  }>
  | Readonly<{
    status: 'done';
    at: number;
    copiedAt: number;
    source: LegacySourceSummary;
    counts: Readonly<Record<string, number>>;
    checksums: Readonly<Record<string, string>>;
    columns: Readonly<Record<string, readonly string[]>>;
    backup: string;
    /** The old tables changed between copy and drop; `changedExport` holds them as they were dropped. */
    changed: boolean;
    changedExport?: string;
  }>;

/**
 * `unavailable` (project database unreachable or busy: retried with backoff); the rest need the
 * operator and are not retried automatically: `conflict` (gateway.db holds data without a record,
 * or the project database already holds rows on revert), `mismatch` (copy did not read back
 * identically), `invalid` (the old rows cannot be copied: missing `id`, duplicate keys, …),
 * `unsupported`, `store_lost` (the project database's marker says the accounts are in another
 * gateway.db: the store was lost or replaced) and `store_mismatch` (marker of a different store).
 */
export type LegacyImportErrorCode = 'unavailable' | 'conflict' | 'mismatch' | 'invalid' | 'unsupported' | 'store_lost' | 'store_mismatch';

export class LegacyImportError extends Error {
  constructor(readonly code: LegacyImportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LegacyImportError';
  }
}

/** Whether retrying later may help (the gateway backs off); otherwise the operator must act. */
export function isTransientLegacyImportError(error: unknown): boolean {
  return !(error instanceof LegacyImportError) || error.code === 'unavailable';
}

/** `gateway_meta` key of the last non-transient failure (for `zhin doctor`; cleared on success). */
export const LEGACY_IMPORT_FAILURE_KEY = 'legacy_import_failure';

export interface LegacyImportFailure {
  readonly code: LegacyImportErrorCode;
  readonly message: string;
  readonly at: number;
}

/** Network / server-gone errors of a driver: the import may succeed later. */
function isTransientDriverError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (isDatabaseBusyError(current)) return true;
    const code = String((current as { code?: unknown }).code ?? '');
    if (/^(?:ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|PROTOCOL_CONNECTION_LOST)/u.test(code) || /^(?:08|57P0)/u.test(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A `LegacyImportError` for whatever went wrong while copying / dropping. */
function classify(error: unknown): LegacyImportError {
  if (error instanceof LegacyImportError) return error;
  if (isTransientDriverError(error)) return new LegacyImportError('unavailable', `项目数据库暂时不可用：${errorText(error)}`, { cause: error });
  return new LegacyImportError('invalid', `旧版 Console 账号表无法迁移：${errorText(error)}`, { cause: error });
}

/** What the import reads and drops (ProjectDatabase satisfies it). */
export interface LegacyIamSource {
  readonly dialect: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  tableExists(names: readonly string[]): Promise<string[]>;
  readSnapshot(tables: readonly string[]): Promise<TableRows>;
  dropTables(tables: readonly string[]): Promise<void>;
  /** The marker (ADR 0059 §3 修订); a source without these methods has no marker. */
  readStoreMarker?(): Promise<StoreMarker | undefined>;
  writeStoreMarker?(marker: StoreMarker): Promise<void>;
  deleteStoreMarker?(): Promise<void>;
}

export interface LegacyImportOptions {
  readonly store: GatewayStore;
  readonly projectRoot: string;
  /** The project database block (resolved only when the state is still undecided). */
  readonly projectDatabase: () => Promise<ProjectDatabaseConfig>;
  /** Opens the project database (default: a ProjectDatabase that defines no table). */
  readonly openSource?: (config: ProjectDatabaseConfig) => LegacyIamSource;
  readonly now?: () => number;
  readonly logger?: Readonly<{ info?(message: string): void; warn?(message: string): void }>;
}

export async function readLegacyImportRecord(store: GatewayStore, trx?: ProjectDatabaseTransaction): Promise<LegacyImportRecord | undefined> {
  return store.getMeta<LegacyImportRecord>(LEGACY_IMPORT_KEY, trx);
}

/** True when the record lets Console access control open. */
export function legacyImportSettled(record: LegacyImportRecord | undefined): boolean {
  return record?.status === 'fresh' || record?.status === 'done';
}

function summarize(projectRoot: string, config: ProjectDatabaseConfig): LegacySourceSummary {
  const value = config as Record<string, unknown>;
  if (config.dialect === 'sqlite') {
    const filename = String(value.filename ?? '');
    return Object.freeze({ dialect: 'sqlite', location: isAbsolute(filename) ? relative(projectRoot, filename) || filename : filename });
  }
  if (config.dialect === 'mongodb') {
    const url = typeof value.url === 'string' ? value.url.replace(/\/\/[^@/]*@/u, '//') : '';
    return Object.freeze({ dialect: 'mongodb', location: `${url}/${String(value.dbName ?? '')}` });
  }
  const host = value.host ?? (typeof value.connectionString === 'string' || typeof value.uri === 'string' ? '(connection string)' : 'localhost');
  return Object.freeze({ dialect: config.dialect, location: `${String(host)}${value.port ? `:${String(value.port)}` : ''}/${String(value.database ?? '')}` });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const columnType = (table: string, column: string): string | undefined => {
  const definition = (IAM_TABLE_DEFINITIONS[table] ?? {})[column] as { type?: string } | undefined;
  return definition?.type;
};

/** A cell as the checksum sees it: integers as decimal strings, text as strings, null kept. */
function canonicalCell(table: string, column: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const type = columnType(table, column);
  if (type === 'integer' || type === 'bigint') {
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = typeof value === 'bigint' ? value.toString() : String(value).trim();
    if (/^-?\d+$/u.test(text)) return BigInt(text).toString();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return text;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A cell as written to the target (integers as numbers, or bigint past 2^53). */
function targetCell(table: string, column: string, value: unknown): unknown {
  const canonical = canonicalCell(table, column, value);
  if (canonical === null) return null;
  const type = columnType(table, column);
  if ((type === 'integer' || type === 'bigint') && /^-?\d+$/u.test(canonical)) {
    const number = Number(canonical);
    return Number.isSafeInteger(number) ? number : BigInt(canonical);
  }
  return canonical;
}

/** Target columns the source rows carry (`id` required). */
function sharedColumns(table: string, rows: readonly Record<string, unknown>[]): string[] {
  const present = new Set(rows.flatMap(row => Object.keys(row)));
  return Object.keys(IAM_TABLE_DEFINITIONS[table] ?? {}).filter(column => present.has(column));
}

function canonicalRows(table: string, rows: readonly Record<string, unknown>[], columns: readonly string[]): Array<Array<string | null>> {
  return rows.map(row => columns.map(column => canonicalCell(table, column, row[column])))
    .sort((left, right) => {
      const a = String(left[columns.indexOf('id')] ?? '');
      const b = String(right[columns.indexOf('id')] ?? '');
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

/**
 * SHA-256 of the rows ordered by `id` (code-unit order), as canonical JSON of `[columns, rows]`
 * with integers as decimal strings and null kept: the same rows read from any dialect hash equal.
 */
export function tableChecksum(table: string, rows: readonly Record<string, unknown>[], columns: readonly string[] = sharedColumns(table, rows)): string {
  const sorted = [...columns].sort();
  return createHash('sha256').update(JSON.stringify([sorted, canonicalRows(table, rows, sorted)])).digest('hex');
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * The backup directory of a legacy snapshot, named after its content: a retried import of the
 * same rows reuses it instead of writing another full copy every retry.
 */
function snapshotBackupDirectory(projectRoot: string, rows: TableRows): { directory: string; existing: boolean } {
  const digest = createHash('sha256').update(JSON.stringify(rows, jsonReplacer)).digest('hex').slice(0, 16);
  const directory = join('.zhin', 'backups', `gateway-db-legacy-${digest}`);
  const existing = existsSync(join(projectRoot, directory, 'console-tables.json'));
  if (!existing) mkdirSync(join(projectRoot, directory), { recursive: true, mode: 0o700 });
  return { directory, existing };
}

function backupDirectory(projectRoot: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/gu, '-');
  let directory = join('.zhin', 'backups', `gateway-db-${stamp}`);
  for (let suffix = 1; existsSync(join(projectRoot, directory)); suffix += 1) directory = join('.zhin', 'backups', `gateway-db-${stamp}-${suffix}`);
  mkdirSync(join(projectRoot, directory), { recursive: true, mode: 0o700 });
  return directory;
}

/** Writes `rows` as JSON (owner-only, never overwriting); returns the project-relative path. */
function exportRows(projectRoot: string, directory: string, file: string, source: LegacySourceSummary, rows: TableRows, now: number): string {
  const path = join(directory, file);
  writeFileSync(join(projectRoot, path), `${JSON.stringify({ exportedAt: new Date(now).toISOString(), source, tables: rows }, jsonReplacer, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

function defaultSource(config: ProjectDatabaseConfig): LegacyIamSource {
  return new ProjectDatabase(config);
}

async function withSource<T>(options: LegacyImportOptions, config: ProjectDatabaseConfig, use: (source: LegacyIamSource) => Promise<T>): Promise<T> {
  let source: LegacyIamSource;
  try {
    source = (options.openSource ?? defaultSource)(config);
    await source.start();
  } catch (error) {
    throw new LegacyImportError('unavailable', `无法连接项目数据库（${config.dialect}）：${errorText(error)}`, { cause: error });
  }
  try {
    return await use(source);
  } finally {
    await source.stop().catch(() => undefined);
  }
}

async function insertRows(trx: ProjectDatabaseTransaction, dialect: string, table: string, columns: readonly string[], rows: readonly Record<string, unknown>[]): Promise<void> {
  const quoted = columns.map(column => quoteTableName(dialect, column)).join(', ');
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
    for (const row of rows.slice(offset, offset + INSERT_BATCH)) {
      const values = columns.map(column => targetCell(table, column, row[column]));
      const placeholders = columns.map((_, index) => (dialect === 'pg' ? `$${index + 1}` : '?')).join(', ');
      await trx.query(`INSERT INTO ${quoteTableName(dialect, table)} (${quoted}) VALUES (${placeholders})`, values);
    }
  }
}

async function readStoreTable(trx: ProjectDatabaseTransaction, table: string, columns: readonly string[]): Promise<Record<string, unknown>[]> {
  if (!columns.length) return [];
  return trx.query<Record<string, unknown>[]>(`SELECT ${columns.map(column => quoteTableName('sqlite', column)).join(', ')} FROM ${quoteTableName('sqlite', table)}`);
}

/** Dialects the marker can live in (a table, or a MongoDB collection). */
function markerCapable(config: ProjectDatabaseConfig): boolean {
  if (!SOURCE_DIALECTS.has(config.dialect)) return false;
  const filename = (config as { filename?: unknown }).filename;
  // Never create the project SQLite file just for the marker; it is written once the file exists.
  return !(config.dialect === 'sqlite' && typeof filename === 'string' && (filename === ':memory:' || !existsSync(filename)));
}

function storeLostMessage(marker: StoreMarker, storeId: string): string {
  return `项目数据库记录 Console 账号存在另一个 gateway.db（store ${marker.storeId}，${new Date(marker.migratedAt).toISOString()} 迁入），当前 .zhin/gateway.db（store ${storeId}）是新的或不同的：`
    + '为防止重新打开初始化（初始化令牌重新生效），Console 访问控制保持关闭。请从备份恢复 .zhin/gateway.db；确认要重新开始时运行 zhin console init --reset-store。';
}

/**
 * Brings `gateway_meta.legacy_import` to `fresh` or `done` (or throws). Runs under the gateway
 * store's write lock (`BEGIN IMMEDIATE`), so the gateway and the CLI never import twice. Once
 * settled, it writes the marker (`zhin_gateway_store`) into the project database: a later empty or
 * foreign gateway.db is refused (`store_lost` / `store_mismatch`) instead of reopening setup.
 * Non-transient failures are recorded in `gateway_meta.legacy_import_failure` for `zhin doctor`.
 */
export async function importLegacyIamTables(options: LegacyImportOptions): Promise<LegacyImportRecord> {
  try {
    const record = await importOnce(options);
    await options.store.deleteMeta(LEGACY_IMPORT_FAILURE_KEY).catch(() => undefined);
    return record;
  } catch (error) {
    const failure = classify(error);
    if (!isTransientLegacyImportError(failure)) {
      const value: LegacyImportFailure = { code: failure.code, message: failure.message, at: (options.now ?? Date.now)() };
      await options.store.setMeta(LEGACY_IMPORT_FAILURE_KEY, value).catch(() => undefined);
    }
    throw failure;
  }
}

async function importOnce(options: LegacyImportOptions): Promise<LegacyImportRecord> {
  const now = options.now ?? Date.now;
  const { store, projectRoot } = options;
  const current = await readLegacyImportRecord(store);
  if (legacyImportSettled(current)) {
    await verifyStoreMarker(options, now);
    return current!;
  }
  const copied = current?.status === 'copied' ? current : await copyLegacyTables(now);
  if (copied.status === 'copied') {
    const done = await dropLegacyTables(options, now);
    await verifyStoreMarker(options, now);
    return done;
  }
  await verifyStoreMarker(options, now);
  return copied;

  async function copyLegacyTables(clock: () => number): Promise<LegacyImportRecord> {
    let config: ProjectDatabaseConfig;
    try {
      config = await options.projectDatabase();
    } catch (error) {
      throw new LegacyImportError('unavailable', `无法读取项目数据库配置：${errorText(error)}`, { cause: error });
    }
    const source = summarize(projectRoot, config);
    return store.transaction(async (trx) => {
      const record = await readLegacyImportRecord(store, trx);
      if (record) return record;
      const counts = await store.counts(trx);
      if (Object.values(counts).some(count => count > 0)) {
        throw new LegacyImportError('conflict', 'gateway.db 已有 Console 数据却没有迁移记录；不合并，请检查 .zhin/gateway.db（或删除它后重新迁移）');
      }
      const fresh = async (reason: 'no-tables' | 'no-database-file' | 'non-relational'): Promise<LegacyImportRecord> => {
        const value = Object.freeze({ status: 'fresh' as const, at: clock(), source, reason });
        await store.setMeta(LEGACY_IMPORT_KEY, value, trx);
        return value;
      };
      if (!SOURCE_DIALECTS.has(config.dialect)) return fresh('non-relational');
      const filename = (config as { filename?: unknown }).filename;
      // Never create the project SQLite file just to look into it.
      if (config.dialect === 'sqlite' && typeof filename === 'string' && filename !== ':memory:' && !existsSync(filename)) return fresh('no-database-file');
      return withSource(options, config, async (legacy) => {
        // An empty gateway.db beside a project database that already handed its accounts to a
        // gateway.db: the store was lost. Never treat that as "no owner yet".
        const marker = await legacy.readStoreMarker?.();
        if (marker) throw new LegacyImportError(marker.storeId === store.storeId ? 'store_mismatch' : 'store_lost', storeLostMessage(marker, store.storeId));
        const present = await legacy.tableExists(TABLES);
        if (!present.length) return fresh('no-tables');
        const rows = await legacy.readSnapshot(present);
        const at = clock();
        const { directory: backup, existing } = snapshotBackupDirectory(projectRoot, rows);
        if (!existing) exportRows(projectRoot, backup, 'console-tables.json', source, rows, at);
        const countsOut: Record<string, number> = {};
        const checksums: Record<string, string> = {};
        const columnsOut: Record<string, readonly string[]> = {};
        for (const table of present) {
          const tableRows = rows[table] ?? [];
          const columns = sharedColumns(table, tableRows);
          if (tableRows.length && !columns.includes('id')) throw new LegacyImportError('invalid', `${table} 没有 id 列，无法迁移`);
          await insertRows(trx, 'sqlite', table, columns, tableRows);
          const expected = tableChecksum(table, tableRows, columns);
          const written = tableChecksum(table, await readStoreTable(trx, table, columns), columns);
          if (written !== expected) throw new LegacyImportError('mismatch', `${table} 复制后校验和不一致，已回滚`);
          countsOut[table] = tableRows.length;
          checksums[table] = expected;
          columnsOut[table] = Object.freeze(columns);
        }
        const value = Object.freeze({
          status: 'copied' as const, at, source, backup,
          counts: Object.freeze(countsOut), checksums: Object.freeze(checksums), columns: Object.freeze(columnsOut),
        });
        await store.setMeta(LEGACY_IMPORT_KEY, value, trx);
        options.logger?.info?.(`console iam: copied ${Object.entries(countsOut).map(([table, count]) => `${table}=${count}`).join(' ')} from the project database into .zhin/gateway.db (backup ${backup})`);
        return value;
      }).catch((error: unknown) => { throw classify(error); });
    });
  }
}

/**
 * Settled store: the marker in the project database must name this store. Missing → written (best
 * effort; also for a SQLite file that did not exist at the first start). A different store id →
 * `store_mismatch`. An unreachable project database is not an error here: this gateway.db is
 * intact, and the marker is checked again on the next start.
 */
async function verifyStoreMarker(options: LegacyImportOptions, now: () => number): Promise<void> {
  let config: ProjectDatabaseConfig;
  try {
    config = await options.projectDatabase();
  } catch {
    return;
  }
  if (!markerCapable(config)) return;
  let source: LegacyIamSource;
  try {
    source = (options.openSource ?? defaultSource)(config);
    await source.start();
  } catch (error) {
    options.logger?.warn?.(`console iam: cannot check the gateway store marker in the project database: ${errorText(error)}`);
    return;
  }
  try {
    if (!source.readStoreMarker || !source.writeStoreMarker) return;
    const marker = await source.readStoreMarker();
    if (marker && marker.storeId !== options.store.storeId) throw new LegacyImportError('store_mismatch', storeLostMessage(marker, options.store.storeId));
    if (!marker) {
      await source.writeStoreMarker({ storeId: options.store.storeId, migratedAt: now() }).catch((error: unknown) => {
        options.logger?.warn?.(`console iam: cannot write the gateway store marker into the project database: ${errorText(error)}`);
      });
    }
  } finally {
    await source.stop().catch(() => undefined);
  }
}

async function dropLegacyTables(options: LegacyImportOptions, now: () => number): Promise<LegacyImportRecord> {
  const { store, projectRoot } = options;
  let config: ProjectDatabaseConfig;
  try {
    config = await options.projectDatabase();
  } catch (error) {
    throw new LegacyImportError('unavailable', `无法读取项目数据库配置：${errorText(error)}`, { cause: error });
  }
  return store.transaction(async (trx) => {
    const record = await readLegacyImportRecord(store, trx);
    if (!record || record.status !== 'copied') {
      if (record) return record;
      throw new LegacyImportError('unavailable', '迁移记录丢失，稍后重试');
    }
    return withSource(options, config, async (legacy) => {
      const present = await legacy.tableExists(TABLES);
      let changed = false;
      let changedExport: string | undefined;
      if (present.length) {
        const rows = await legacy.readSnapshot(present);
        changed = present.some((table) => {
          const tableRows = rows[table] ?? [];
          const expected = record.checksums[table];
          if (expected === undefined) return tableRows.length > 0;
          return tableChecksum(table, tableRows, record.columns[table] ?? []) !== expected;
        });
        if (changed) {
          mkdirSync(join(projectRoot, record.backup), { recursive: true, mode: 0o700 });
          const name = `console-tables-changed-${createHash('sha256').update(JSON.stringify(rows, jsonReplacer)).digest('hex').slice(0, 12)}.json`;
          changedExport = join(record.backup, name);
          if (!existsSync(join(projectRoot, changedExport))) exportRows(projectRoot, record.backup, name, record.source, rows, now());
          options.logger?.warn?.(`console iam: the old console_* tables changed after they were copied; their rows as dropped are in ${changedExport} (gateway.db keeps the copy)`);
        }
        await legacy.dropTables(present);
      }
      const value = Object.freeze({
        status: 'done' as const,
        at: now(),
        copiedAt: record.at,
        source: record.source,
        counts: record.counts,
        checksums: record.checksums,
        columns: record.columns,
        backup: record.backup,
        changed,
        ...(changedExport ? { changedExport } : {}),
      });
      await store.setMeta(LEGACY_IMPORT_KEY, value, trx);
      return value;
    }).catch((error: unknown) => { throw classify(error); });
  });
}

/**
 * `zhin console init --reset-store`: the operator accepts that the Console accounts of the
 * previous gateway.db are gone (ADR 0059 §3 修订). Marks this store as settled (`fresh`, reason
 * `reset-store`) when it has no record, rewrites the project database's marker to this store and
 * records the reset in this store's audit log. Run only while no gateway runs.
 */
export async function resetGatewayStore(options: LegacyImportOptions): Promise<{ readonly previousStoreId?: string; readonly storeId: string }> {
  const now = options.now ?? Date.now;
  const { store, projectRoot } = options;
  let config: ProjectDatabaseConfig;
  try {
    config = await options.projectDatabase();
  } catch (error) {
    throw new LegacyImportError('unavailable', `无法读取项目数据库配置：${errorText(error)}`, { cause: error });
  }
  let previous: StoreMarker | undefined;
  if (markerCapable(config)) {
    previous = await withSource(options, config, async (source) => {
      // Old account tables still there: migrate instead of resetting.
      if ((await source.tableExists(TABLES)).length) throw new LegacyImportError('conflict', '项目数据库里还有旧版 Console 账号表：请运行 zhin console migrate，而不是重置');
      const marker = await source.readStoreMarker?.();
      await source.writeStoreMarker?.({ storeId: store.storeId, migratedAt: now() });
      return marker;
    });
  }
  await store.transaction(async (trx) => {
    if (!(await readLegacyImportRecord(store, trx))) {
      await store.setMeta(LEGACY_IMPORT_KEY, Object.freeze({ status: 'fresh', at: now(), source: summarize(projectRoot, config), reason: 'reset-store' }), trx);
    }
    await store.deleteMeta(LEGACY_IMPORT_FAILURE_KEY, trx);
    await trx.query(`INSERT INTO ${quoteTableName('sqlite', IAM_TABLES.audit)} (id, at, actor, action, target, outcome, detail, ip) VALUES (?, ?, 'local', 'auth.store.reset', ?, 'ok', ?, NULL)`, [
      randomUUID(), now(), `store:${store.storeId}`, JSON.stringify({ previousStoreId: previous?.storeId ?? null, previousMigratedAt: previous?.migratedAt ?? null }),
    ]);
  });
  return Object.freeze({ ...(previous ? { previousStoreId: previous.storeId } : {}), storeId: store.storeId });
}

export interface LegacyImportInspection {
  readonly record: LegacyImportRecord | undefined;
  /** The last failure that needs the operator (not retried automatically). */
  readonly failure?: LegacyImportFailure;
  /** Gateway tables present in the project database again (undefined: not checked or unreachable). */
  readonly reappeared?: readonly string[];
  /** Why the project database could not be checked. */
  readonly problem?: string;
}

/** For `zhin doctor`: the record, and whether old tables showed up again in the project database. */
export async function inspectLegacyIamImport(options: LegacyImportOptions): Promise<LegacyImportInspection> {
  const record = await readLegacyImportRecord(options.store);
  const failure = await options.store.getMeta<LegacyImportFailure>(LEGACY_IMPORT_FAILURE_KEY);
  if (!legacyImportSettled(record)) return Object.freeze({ record, ...(failure ? { failure } : {}) });
  try {
    const config = await options.projectDatabase();
    if (!SOURCE_DIALECTS.has(config.dialect)) return Object.freeze({ record, reappeared: Object.freeze([]) });
    const filename = (config as { filename?: unknown }).filename;
    if (config.dialect === 'sqlite' && typeof filename === 'string' && !existsSync(filename)) return Object.freeze({ record, reappeared: Object.freeze([]) });
    const reappeared = await withSource(options, config, legacy => legacy.tableExists(TABLES));
    return Object.freeze({ record, reappeared: Object.freeze(reappeared) });
  } catch (error) {
    return Object.freeze({ record, problem: errorText(error) });
  }
}

export interface RevertLegacyImportResult {
  readonly counts: Readonly<Record<string, number>>;
  /** What the operator still has to do (e.g. drop the restricted Console account). */
  readonly warnings: readonly string[];
  /** Project-relative directory with the gateway.db copy taken before the revert. */
  readonly backup: string;
}

/**
 * `zhin console migrate --revert` (before installing a version older than ADR 0059): writes the
 * gateway's tables back into the project database, verifies them, then empties them in
 * gateway.db and clears the record. The project database must not hold rows in those tables.
 * Run only while no gateway runs.
 */
export async function revertLegacyIamImport(options: LegacyImportOptions): Promise<RevertLegacyImportResult> {
  const now = options.now ?? Date.now;
  const { store, projectRoot } = options;
  let config: ProjectDatabaseConfig;
  try {
    config = await options.projectDatabase();
  } catch (error) {
    throw new LegacyImportError('unavailable', `无法读取项目数据库配置：${errorText(error)}`, { cause: error });
  }
  if (!SOURCE_DIALECTS.has(config.dialect)) {
    throw new LegacyImportError('unsupported', `项目数据库是 ${config.dialect}：旧版本无法在这里存放 Console 账号，不能回退`);
  }
  // A copy of gateway.db first (SQLite cannot back up a connection inside its own write transaction).
  const at = now();
  const backup = backupDirectory(projectRoot, at);
  await store.backupTo(join(projectRoot, backup, 'gateway.db'));
  return store.transaction(async (trx) => {
    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) rows[table] = await readStoreTable(trx, table, Object.keys(IAM_TABLE_DEFINITIONS[table] ?? {}));
    exportRows(projectRoot, backup, 'gateway-tables.json', { dialect: 'sqlite', location: '.zhin/gateway.db' }, rows, at);
    const target = new ProjectDatabase(config);
    defineConsoleIamTables(target);
    try {
      await target.start();
    } catch (error) {
      throw new LegacyImportError('unavailable', `无法连接项目数据库（${config.dialect}）：${errorText(error)}`, { cause: error });
    }
    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    try {
      const existing = await target.readSnapshot(TABLES);
      const occupied = TABLES.filter(table => (existing[table]?.length ?? 0) > 0);
      if (occupied.length) throw new LegacyImportError('conflict', `项目数据库里这些表已有数据，不覆盖：${occupied.join(', ')}`);
      if (target.relational) {
        await target.transaction(async (project) => {
          for (const table of TABLES) await insertRows(project, config.dialect, table, Object.keys(IAM_TABLE_DEFINITIONS[table] ?? {}), rows[table] ?? []);
        });
      } else {
        for (const table of TABLES) {
          const model = target.models.get(table);
          if (!model) throw new LegacyImportError('unavailable', `项目数据库缺少 ${table}`);
          for (const row of rows[table] ?? []) {
            await model.insert(Object.fromEntries(Object.keys(IAM_TABLE_DEFINITIONS[table] ?? {}).map(column => [column, targetCell(table, column, row[column])])));
          }
        }
      }
      const written = await target.readSnapshot(TABLES);
      for (const table of TABLES) {
        const columns = Object.keys(IAM_TABLE_DEFINITIONS[table] ?? {});
        if (tableChecksum(table, written[table] ?? [], columns) !== tableChecksum(table, rows[table] ?? [], columns)) {
          throw new LegacyImportError('mismatch', `${table} 写回项目数据库后校验和不一致；请检查项目数据库里的 console_* 表（gateway.db 未改动，备份在 ${backup}）`);
        }
        counts[table] = rows[table]?.length ?? 0;
      }
      // The older version knows no marker; a later upgrade migrates again.
      await target.deleteStoreMarker().catch((error: unknown) => { warnings.push(`无法删除项目数据库里的标记表 zhin_gateway_store：${errorText(error)}`); });
      warnings.push(...await revokeConsoleRoleAccess(target, config));
    } finally {
      await target.stop().catch(() => undefined);
    }
    for (const table of TABLES) await trx.query(`DELETE FROM ${quoteTableName('sqlite', table)}`);
    await store.deleteMeta(LEGACY_IMPORT_KEY, trx);
    await store.deleteMeta(LEGACY_IMPORT_FAILURE_KEY, trx);
    return Object.freeze({ counts: Object.freeze(counts), backup, warnings: Object.freeze(warnings) });
  });
}

/**
 * After a revert the account tables are back in the project database, where the restricted
 * Console account (`database.console`) would reach them: PostgreSQL's default privileges grant it
 * every new table of the main account, MySQL grants it the whole database. Revoke what can be
 * revoked and tell the operator to drop the account (an older version does not use it).
 */
async function revokeConsoleRoleAccess(target: ProjectDatabase, config: ProjectDatabaseConfig): Promise<string[]> {
  const consoleUser = (config as { console?: { user?: unknown } }).console?.user;
  if (typeof consoleUser !== 'string' || !consoleUser || (config.dialect !== 'pg' && config.dialect !== 'mysql')) return [];
  const warnings: string[] = [];
  const attempt = async (sql: string, params?: unknown[]): Promise<void> => {
    await target.query(sql, params).catch((error: unknown) => { warnings.push(`${sql.split(' ').slice(0, 6).join(' ')}… 失败：${errorText(error)}`); });
  };
  if (config.dialect === 'pg') {
    const role = quoteTableName('pg', consoleUser);
    for (const table of TABLES) await attempt(`REVOKE ALL ON TABLE ${quoteTableName('pg', table)} FROM ${role}`);
    await attempt(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`);
    await attempt(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`);
    warnings.push(`旧版本不使用受限账号 ${consoleUser}：请删除它（DROP OWNED BY ${role}; DROP ROLE ${role};）并从配置删除 database.console`);
  } else {
    const grantees = await target.query<Array<{ grantee: string }>>('SELECT DISTINCT GRANTEE AS grantee FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE ?', [`'${consoleUser.replace(/'/gu, "''")}'@%`])
      .catch(() => [] as Array<{ grantee: string }>);
    for (const { grantee } of grantees) await attempt(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${grantee}`);
    if (!grantees.length) warnings.push(`无法确认受限账号 ${consoleUser} 的授权已撤销`);
    warnings.push(`旧版本不使用受限账号 ${consoleUser}：请删除它（DROP USER '${consoleUser}'@'<主机>';）并从配置删除 database.console`);
  }
  return warnings;
}
