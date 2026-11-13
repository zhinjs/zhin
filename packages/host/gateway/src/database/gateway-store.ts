/**
 * The gateway's own store `.zhin/gateway.db` (ADR 0059 §1): the six Console access-control
 * tables (`IAM_TABLES`) and `gateway_meta`, in SQLite whatever dialect the project database
 * uses. Owner-only (0600, `-wal` / `-shm` included).
 *
 * Opened only by the gateway, by `zhin console …` while no gateway runs, and by a standalone
 * instance (`zhin start --standalone`, development and tests only: there the instance process
 * holds both connections, so there is no process isolation). A supervised instance never opens
 * it, and its own SQLite connection refuses `ATTACH` (`denyAttach`).
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseHostModel } from '@zhin.js/plugin-runtime';
import { defineConsoleIamTables, IAM_TABLES } from '../iam/tables.js';
import { GATEWAY_SQLITE_BUSY_RETRY_MS, ProjectDatabase, type ProjectDatabaseTransaction } from './project-database.js';

/** Project-relative path of the gateway store. */
export const GATEWAY_STORE_FILE = join('.zhin', 'gateway.db');
/** Key / value table of the gateway store (`schema_version`, `legacy_import`). */
export const GATEWAY_META_TABLE = 'gateway_meta';
/** Schema version written to `gateway_meta.schema_version`. */
export const GATEWAY_STORE_SCHEMA_VERSION = 1;

const META_DEFINITION = Object.freeze({
  key: { type: 'text', length: 64, primary: true, nullable: false },
  value: { type: 'text', nullable: false },
});

export interface GatewayStore {
  /** Absolute path of `gateway.db`. */
  readonly filename: string;
  readonly started: boolean;
  readonly models: { get(name: string): DatabaseHostModel | undefined };
  /** JSON value of a `gateway_meta` key, or undefined. */
  getMeta<T = unknown>(key: string, trx?: ProjectDatabaseTransaction): Promise<T | undefined>;
  setMeta(key: string, value: unknown, trx?: ProjectDatabaseTransaction): Promise<void>;
  deleteMeta(key: string, trx?: ProjectDatabaseTransaction): Promise<void>;
  /** A write transaction (`BEGIN IMMEDIATE`: also the lock between the gateway and the CLI). */
  transaction<T>(callback: (trx: ProjectDatabaseTransaction) => Promise<T>): Promise<T>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  /** Rows in each of the access-control tables. */
  counts(trx?: ProjectDatabaseTransaction): Promise<Readonly<Record<string, number>>>;
  /** A consistent copy of `gateway.db` (0600). */
  backupTo(destination: string): Promise<void>;
  close(): Promise<void>;
}

export interface OpenGatewayStoreOptions {
  /** Overrides the file (tests). Default `<projectRoot>/.zhin/gateway.db`. */
  readonly filename?: string;
  /** `SQLITE_BUSY` async retry budget (default {@link GATEWAY_SQLITE_BUSY_RETRY_MS}). */
  readonly busyRetryMs?: number;
}

/** `<projectRoot>/.zhin/gateway.db`. */
export function gatewayStorePath(projectRoot: string): string {
  return join(projectRoot, GATEWAY_STORE_FILE);
}

function restrict(file: string): void {
  if (process.platform === 'win32') return;
  if (existsSync(file)) chmodSync(file, 0o600);
}

/** Opens (creating if needed) the gateway store with its tables. */
export async function openGatewayStore(projectRoot: string, options: OpenGatewayStoreOptions = {}): Promise<GatewayStore> {
  const filename = options.filename ?? gatewayStorePath(projectRoot);
  mkdirSync(dirname(filename), { recursive: true });
  // Create the file owner-only before SQLite does (it would follow the umask); SQLite gives the
  // -wal / -shm files the mode of the database file.
  if (!existsSync(filename)) closeSync(openSync(filename, 'a', 0o600));
  restrict(filename);
  const database = new ProjectDatabase({ dialect: 'sqlite', filename, busyRetryMs: options.busyRetryMs ?? GATEWAY_SQLITE_BUSY_RETRY_MS });
  defineConsoleIamTables(database);
  database.define(GATEWAY_META_TABLE, META_DEFINITION);
  await database.start();
  for (const suffix of ['', '-wal', '-shm']) restrict(`${filename}${suffix}`);
  const run = <T>(sql: string, params: unknown[], trx?: ProjectDatabaseTransaction) => (trx ? trx.query<T>(sql, params) : database.query<T>(sql, params));
  const store: GatewayStore = {
    filename,
    get started() { return database.started; },
    models: database.models,
    async getMeta<T>(key: string, trx?: ProjectDatabaseTransaction): Promise<T | undefined> {
      const rows = await run<Array<{ value: string }>>(`SELECT value FROM ${GATEWAY_META_TABLE} WHERE key = ?`, [key], trx);
      return rows[0] ? JSON.parse(rows[0].value) as T : undefined;
    },
    async setMeta(key: string, value: unknown, trx?: ProjectDatabaseTransaction): Promise<void> {
      await run(`INSERT INTO ${GATEWAY_META_TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(value)], trx);
    },
    async deleteMeta(key: string, trx?: ProjectDatabaseTransaction): Promise<void> {
      await run(`DELETE FROM ${GATEWAY_META_TABLE} WHERE key = ?`, [key], trx);
    },
    transaction: callback => database.transaction(callback),
    query: (sql, params) => database.query(sql, params),
    async counts(trx?: ProjectDatabaseTransaction) {
      const out: Record<string, number> = {};
      for (const table of Object.values(IAM_TABLES)) {
        const [row] = await run<Array<{ n: number }>>(`SELECT count(*) AS n FROM "${table}"`, [], trx);
        out[table] = Number(row?.n ?? 0);
      }
      return Object.freeze(out);
    },
    backupTo: destination => database.backupTo(destination),
    close: () => database.stop(),
  };
  if (await store.getMeta('schema_version') === undefined) await store.setMeta('schema_version', GATEWAY_STORE_SCHEMA_VERSION);
  return Object.freeze(store);
}
