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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { ProjectDatabaseConfig } from '../database/config.js';
import type { GatewayStore } from '../database/gateway-store.js';
import {
  ProjectDatabase,
  quoteTableName,
  type ProjectDatabaseTransaction,
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
  | Readonly<{ status: 'fresh'; at: number; source: LegacySourceSummary; reason: 'no-tables' | 'no-database-file' | 'non-relational' }>
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

export type LegacyImportErrorCode = 'unavailable' | 'conflict' | 'mismatch' | 'unsupported';

export class LegacyImportError extends Error {
  constructor(readonly code: LegacyImportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LegacyImportError';
  }
}

/** What the import reads and drops (ProjectDatabase satisfies it). */
export interface LegacyIamSource {
  readonly dialect: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  tableExists(names: readonly string[]): Promise<string[]>;
  readSnapshot(tables: readonly string[]): Promise<TableRows>;
  dropTables(tables: readonly string[]): Promise<void>;
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

/**
 * Brings `gateway_meta.legacy_import` to `fresh` or `done` (or throws). Runs under the gateway
 * store's write lock (`BEGIN IMMEDIATE`), so the gateway and the CLI never import twice.
 * Throws {@link LegacyImportError}: `unavailable` (project database unreachable: nothing was
 * written, retry later), `conflict` (gateway.db already holds accounts without a record),
 * `mismatch` (the copy did not read back identically: rolled back).
 */
export async function importLegacyIamTables(options: LegacyImportOptions): Promise<LegacyImportRecord> {
  const now = options.now ?? Date.now;
  const { store, projectRoot } = options;
  const current = await readLegacyImportRecord(store);
  if (legacyImportSettled(current)) return current!;
  const copied = current?.status === 'copied' ? current : await copyLegacyTables(now);
  if (copied.status !== 'copied') return copied;
  return dropLegacyTables(options, now);

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
        const present = await legacy.tableExists(TABLES);
        if (!present.length) return fresh('no-tables');
        const rows = await legacy.readSnapshot(present);
        const at = clock();
        const backup = backupDirectory(projectRoot, at);
        exportRows(projectRoot, backup, 'console-tables.json', source, rows, at);
        const countsOut: Record<string, number> = {};
        const checksums: Record<string, string> = {};
        const columnsOut: Record<string, readonly string[]> = {};
        for (const table of present) {
          const tableRows = rows[table] ?? [];
          const columns = sharedColumns(table, tableRows);
          if (tableRows.length && !columns.includes('id')) throw new LegacyImportError('mismatch', `${table} 没有 id 列，无法迁移`);
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
      });
    });
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
          changedExport = exportRows(projectRoot, record.backup, 'console-tables-changed.json', record.source, rows, now());
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
    });
  });
}

export interface LegacyImportInspection {
  readonly record: LegacyImportRecord | undefined;
  /** Gateway tables present in the project database again (undefined: not checked or unreachable). */
  readonly reappeared?: readonly string[];
  /** Why the project database could not be checked. */
  readonly problem?: string;
}

/** For `zhin doctor`: the record, and whether old tables showed up again in the project database. */
export async function inspectLegacyIamImport(options: LegacyImportOptions): Promise<LegacyImportInspection> {
  const record = await readLegacyImportRecord(options.store);
  if (!legacyImportSettled(record)) return Object.freeze({ record });
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
    } finally {
      await target.stop().catch(() => undefined);
    }
    for (const table of TABLES) await trx.query(`DELETE FROM ${quoteTableName('sqlite', table)}`);
    await store.deleteMeta(LEGACY_IMPORT_KEY, trx);
    return Object.freeze({ counts: Object.freeze(counts), backup });
  });
}
