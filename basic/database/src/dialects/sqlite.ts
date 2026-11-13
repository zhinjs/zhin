import type { StatementColumnMetadata } from 'node:sqlite';
import * as fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Dialect, Database } from '../base/index.js';

import { Column, Transaction, TransactionOptions, type StatementQueryOptions } from '../types.js';
import { capRows, markTruncated } from '../base/statement-rows.js';
import { RelatedDatabase } from '../type/related/database.js';

export interface SQLiteDialectConfig {
  filename: string;
  mode?: string;
  /**
   * `PRAGMA busy_timeout` in ms (default 0: no synchronous wait; see `busyRetryMs`). The wait
   * is synchronous (`node:sqlite`), so only a connection whose own writes are short statements
   * should set it — the gateway does for its `console_*` connection (ADR 0054 §7). Two
   * connections of one process with async transactions would block each other's event loop.
   */
  busyTimeoutMs?: number;
  /**
   * Without `busyTimeoutMs`, a statement outside a transaction (and `BEGIN IMMEDIATE`) that hits
   * `SQLITE_BUSY` is retried with an async backoff for at most this long (default 5000 ms; 0
   * disables). The event loop keeps running while another process (the gateway) holds the
   * write lock, so two connections in one process cannot deadlock each other.
   */
  busyRetryMs?: number;
  /**
   * Refuse `ATTACH DATABASE` on this connection (ADR 0059 §2). Every raw statement — `query`,
   * single statements of a transaction, the isolated read process — reads `PRAGMA database_list`
   * before and after it runs; any schema besides `main` / `temp` fails the statement. Inside a
   * transaction the transaction is rolled back and poisoned (later statements, `COMMIT` included,
   * are refused), then the extra schema is detached. Where Node provides `setAuthorizer`, an
   * authorizer denying `SQLITE_ATTACH` is installed as well. Off by default: the instance turns it
   * on, so its raw SQL cannot open the gateway's `.zhin/gateway.db` beside the project database.
   */
  denyAttach?: boolean;
}

/** A statement attached another database file to a connection with {@link SQLiteDialectConfig.denyAttach}. */
export class SqliteAttachRefusedError extends Error {
  readonly code = 'attach_refused';
  constructor(readonly schemas: readonly string[]) {
    super(`ATTACH DATABASE is not allowed on this connection (attached: ${schemas.join(', ')}); the statement was undone`);
    this.name = 'SqliteAttachRefusedError';
  }
}

/** Schemas of `PRAGMA database_list` other than `main` / `temp`. */
function attachedSchemas(db: { prepare(sql: string): any }): string[] {
  const rows = db.prepare('PRAGMA database_list').all() as Array<{ name?: unknown }>;
  return rows.map(row => String(row.name ?? '')).filter(name => name !== 'main' && name !== 'temp');
}

/** `SQLITE_ATTACH` / `SQLITE_DENY` / `SQLITE_OK` (sqlite3.h), for an authorizer where Node has one. */
const SQLITE_ATTACH_ACTION = 24;
const SQLITE_DENY_RESULT = 1;
const SQLITE_OK_RESULT = 0;

/** Installs an authorizer that denies ATTACH when `node:sqlite` supports `setAuthorizer` (feature-detected). */
function installAttachAuthorizer(db: unknown): boolean {
  const target = db as { setAuthorizer?: (callback: (action: number, ...rest: unknown[]) => number) => void };
  if (typeof target.setAuthorizer !== 'function') return false;
  try {
    target.setAuthorizer((action: number) => (action === SQLITE_ATTACH_ACTION ? SQLITE_DENY_RESULT : SQLITE_OK_RESULT));
    return true;
  } catch {
    return false;
  }
}

/** Default budget of {@link SQLiteDialectConfig.busyRetryMs}. */
export const SQLITE_BUSY_RETRY_MS = 5_000;
const BUSY_RETRY_FIRST_DELAY_MS = 2;
const BUSY_RETRY_MAX_DELAY_MS = 100;

/** `SQLITE_BUSY` and its extended codes except `SQLITE_BUSY_SNAPSHOT` (a stale read snapshot never clears by waiting). */
export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errcode = (error as { errcode?: unknown }).errcode;
  return typeof errcode === 'number' && (errcode & 0xff) === 5 && errcode !== 517;
}

/** Options of {@link SQLiteDialect.queryReadOnlyIsolated}. */
export interface SqliteIsolatedQueryOptions {
  readonly maxRows: number;
  readonly timeoutMs: number;
}

export interface SqliteIsolatedQueryResult {
  readonly columns: readonly string[];
  readonly rows: Record<string, unknown>[];
  readonly truncated: boolean;
}

/** Thrown when an isolated read exceeded its time budget (its process is killed). */
export class SqliteQueryTimeoutError extends Error {
  readonly code = 'timeout';
  constructor(timeoutMs: number) {
    super(`Query exceeded the ${timeoutMs} ms time limit and was stopped`);
    this.name = 'SqliteQueryTimeoutError';
  }
}

/**
 * Child-process body of {@link SQLiteDialect.queryReadOnlyIsolated} (CommonJS, `node -e`): its own
 * read-only connection with `query_only`, rows iterated up to the cap and the wall-clock budget.
 * A separate process, because only a process can be stopped (SIGKILL) inside a native SQLite step.
 */
const ISOLATED_READ_CHILD = `
const { DatabaseSync } = require('node:sqlite');
const attached = (db) => db.prepare('PRAGMA database_list').all().map(row => String(row.name)).filter(name => name !== 'main' && name !== 'temp');
process.once('message', (job) => {
  const { filename, sql, maxRows, deadline, json, denyAttach } = job;
  let db;
  let reply;
  try {
    db = new DatabaseSync(filename, denyAttach ? { readOnly: true, limits: { attach: 0 } } : { readOnly: true });
    if (denyAttach && typeof db.setAuthorizer === 'function') {
      try { db.setAuthorizer((action) => (action === 24 ? 1 : 0)); } catch {}
    }
    db.exec('PRAGMA query_only = ON');
    const statement = db.prepare(sql);
    const meta = typeof statement.columns === 'function' ? statement.columns() : [];
    const decode = new Set(meta.filter(c => c.database === 'main' && c.table && c.column && (json[c.table] || []).includes(c.column)).map(c => c.name));
    const rows = [];
    let truncated = false;
    let timeout = false;
    for (const row of statement.iterate()) {
      if (rows.length >= maxRows) { truncated = true; break; }
      const out = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = value;
        if (decode.has(key) && typeof value === 'string') { try { out[key] = JSON.parse(value); } catch {} }
      }
      rows.push(out);
      if (Date.now() > deadline) { timeout = true; break; }
    }
    const extra = denyAttach ? attached(db) : [];
    reply = extra.length
      ? { ok: false, attach: extra }
      : timeout ? { ok: false, timeout: true } : { ok: true, rows, truncated, columns: meta.map(c => c.name) };
  } catch (error) {
    reply = { ok: false, message: String(error && error.message || error), code: error && error.code, errcode: error && error.errcode };
  } finally {
    try { db && db.close(); } catch {}
  }
  process.send(reply, () => process.exit(0));
});
`;

/** How long a new isolated read waits for a stopped one to be gone. */
const ISOLATED_READER_EXIT_WAIT_MS = 2_000;

function isInMemoryFilename(filename: string): boolean {
  return filename === ':memory:' || filename === '' || filename.startsWith('file::memory:');
}

export class SQLiteDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<SQLiteDialectConfig, S, string> {
  /** Node 内置 SQLite 连接（node:sqlite），在 connect() 中动态加载 */
  private db: { prepare(sql: string): any; exec(sql: string): void; close(): void; readonly isTransaction?: boolean } | null = null;
  /** Own transaction flag; `DatabaseSync#isTransaction` is preferred where Node provides it. */
  private transactionOpen = false;
  /** The transaction in progress; `poisoned` once a statement in it attached a database (denyAttach). */
  private currentTransaction: { poisoned: boolean } | null = null;
  /** Worker of the isolated read in flight (also while a terminated one is still unwinding). */
  private isolatedReader: { readonly child: import('node:child_process').ChildProcess; readonly exited: Promise<void>; killed: boolean } | null = null;

  constructor(config: SQLiteDialectConfig) {
    super('sqlite', config);
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const { DatabaseSync } = require('node:sqlite');
      const dirname = path.dirname(this.config.filename);
      if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
      }
      const deny = this.config.denyAttach === true;
      // `limits.attach = 0` where Node honours it (ignored by Node 22); the database_list check is the defense.
      const db = deny ? new DatabaseSync(this.config.filename, { limits: { attach: 0 } }) : new DatabaseSync(this.config.filename);
      try {
        if (deny) installAttachAuthorizer(db);
        // Two processes share the file (gateway: console_* tables, instance: the rest):
        // WAL lets readers run beside one writer and never blocks readers on a writer.
        const busy = this.config.busyTimeoutMs;
        if (busy !== undefined && Number.isSafeInteger(busy) && busy > 0) db.exec(`PRAGMA busy_timeout = ${busy}`);
        if (!isInMemoryFilename(this.config.filename)) db.exec('PRAGMA journal_mode = WAL');
      } catch (error) {
        db.close();
        throw error;
      }
      this.db = db;
    } catch (error) {
      throw new Error(`SQLite 连接失败（需要 Node.js 22.5+，推荐 24+）: ${error}`);
    }
  }

  /** True when {@link queryReadOnlyIsolated} can open its own connection (a file database). */
  supportsIsolatedReads(): boolean {
    return this.db !== null && !isInMemoryFilename(this.config.filename);
  }

  /**
   * Runs one read statement on its own read-only connection in a child process, so a slow query
   * never blocks this event loop: rows are iterated up to `maxRows`, and the process is killed
   * (SIGKILL — SQLite cannot be interrupted inside a step otherwise) when `timeoutMs` passes. One
   * isolated read runs at a time per connection; the child never keeps this process alive.
   */
  async queryReadOnlyIsolated(sql: string, options: SqliteIsolatedQueryOptions): Promise<SqliteIsolatedQueryResult> {
    if (!this.supportsIsolatedReads()) throw new Error('Isolated reads need a file database');
    const previous = this.isolatedReader;
    if (previous) {
      // A killed reader is gone within milliseconds; a running one is not waited for.
      if (previous.killed) await Promise.race([previous.exited, delay(ISOLATED_READER_EXIT_WAIT_MS, undefined, { ref: false })]);
      if (this.isolatedReader) throw new Error('A previous query is still running; try again shortly');
    }
    const { spawn } = await import('node:child_process');
    const json = Object.fromEntries([...this.jsonColumns].map(([table, columns]) => [table, [...columns]]));
    const { NODE_OPTIONS: _options, ...env } = process.env;
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', ISOLATED_READ_CHILD], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
      env,
      windowsHide: true,
    });
    let markExited!: () => void;
    const reader = { child, exited: new Promise<void>(resolve => { markExited = resolve; }), killed: false };
    this.isolatedReader = reader;
    // Neither the child nor its channel keeps this process alive (the pending timer does, while needed).
    child.unref();
    (child as unknown as { channel?: { unref?(): void } }).channel?.unref?.();
    const kill = () => {
      reader.killed = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    return await new Promise<SqliteIsolatedQueryResult>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, value?: SqliteIsolatedQueryResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      };
      const timer = setTimeout(() => {
        kill();
        finish(new SqliteQueryTimeoutError(options.timeoutMs));
      }, options.timeoutMs);
      child.once('exit', code => {
        if (this.isolatedReader === reader) this.isolatedReader = null;
        markExited();
        finish(new Error(`SQLite query process exited (${code ?? 'killed'})`));
      });
      child.once('error', error => {
        if (this.isolatedReader === reader) this.isolatedReader = null;
        markExited();
        finish(error);
      });
      child.once('message', (message: { ok: boolean; timeout?: boolean; attach?: string[]; message?: string; code?: string; errcode?: number; rows?: Record<string, unknown>[]; columns?: string[]; truncated?: boolean }) => {
        // A child that answered has closed SQLite and is exiting: the next read need not wait.
        if (this.isolatedReader === reader) this.isolatedReader = null;
        if (message.attach?.length) {
          finish(new SqliteAttachRefusedError(message.attach));
        } else if (message.ok) {
          finish(null, { columns: message.columns ?? [], rows: message.rows ?? [], truncated: message.truncated === true });
        } else if (message.timeout) {
          finish(new SqliteQueryTimeoutError(options.timeoutMs));
        } else {
          finish(Object.assign(new Error(message.message ?? 'SQLite query failed'), { code: message.code, errcode: message.errcode }));
        }
      });
      child.send({ filename: this.config.filename, sql, maxRows: options.maxRows, deadline: Date.now() + options.timeoutMs, json, denyAttach: this.config.denyAttach === true }, error => {
        if (error) { kill(); finish(error); }
      });
    });
  }

  /**
   * Copies the database to `destination` (a consistent snapshot, also while WAL frames are not
   * checkpointed): `node:sqlite` `backup()` where Node provides it, otherwise `VACUUM INTO`. The
   * copy is created owner-only (0600). The destination must not exist.
   */
  async backupTo(destination: string): Promise<void> {
    if (!this.db) throw new Error('SQLite 未连接');
    if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const { createRequire } = await import('node:module');
    const sqlite = createRequire(import.meta.url)('node:sqlite') as { backup?: (source: unknown, path: string) => Promise<unknown> };
    if (typeof sqlite.backup === 'function') await sqlite.backup(this.db, destination);
    else this.db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
  }

  async disconnect(): Promise<void> {
    if (this.isolatedReader) {
      this.isolatedReader.killed = true;
      try { this.isolatedReader.child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected();
  }

  /** node:sqlite 仅支持 number/string/bigint/buffer/null；JSON 列在库内为 TEXT，对象需序列化 */
  private prepareBindParams(params: any[]): any[] {
    return params.map((v) => {
      if (v == null) return null;
      if (typeof v === 'bigint') return v;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (Buffer.isBuffer(v)) return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    const budget = this.busyRetryBudget();
    if (budget <= 0) return this.execute<U>(sql, params);
    const deadline = Date.now() + budget;
    let wait = BUSY_RETRY_FIRST_DELAY_MS;
    for (;;) {
      // A statement inside an open transaction is never replayed here: the transaction's caller
      // owns that retry (BEGIN IMMEDIATE takes the write lock up front, so this is rare).
      // COMMIT is the exception: SQLite documents a busy COMMIT as safe to retry.
      const replayable = !this.inTransaction() || /^\s*commit\b/i.test(sql);
      try {
        return await this.execute<U>(sql, params);
      } catch (error) {
        if (!replayable || !isSqliteBusyError(error) || Date.now() + wait > deadline) throw error;
      }
      await delay(wait);
      wait = Math.min(wait * 2, BUSY_RETRY_MAX_DELAY_MS);
    }
  }

  /** Async retry budget: only for connections that do not wait synchronously (`busyTimeoutMs`). */
  private busyRetryBudget(): number {
    const busy = this.config.busyTimeoutMs;
    if (busy !== undefined && busy > 0) return 0;
    if (isInMemoryFilename(this.config.filename)) return 0;
    const budget = this.config.busyRetryMs ?? SQLITE_BUSY_RETRY_MS;
    return Number.isFinite(budget) && budget > 0 ? budget : 0;
  }

  private inTransaction(): boolean {
    const native = this.db?.isTransaction;
    return typeof native === 'boolean' ? native : this.transactionOpen;
  }

  /**
   * denyAttach: fails when `db` has a schema besides main / temp. Inside a transaction the
   * transaction is rolled back first and marked poisoned (DETACH is refused while it holds
   * locks); then every extra schema is detached.
   */
  private assertNotAttached(): void {
    if (this.config.denyAttach !== true || !this.db) return;
    const extra = attachedSchemas(this.db);
    if (!extra.length) return;
    if (this.currentTransaction) {
      this.currentTransaction.poisoned = true;
      try { this.db.exec('ROLLBACK'); } catch { /* not in a transaction any more */ }
      this.transactionOpen = false;
    }
    for (const schema of extra) {
      try { this.db.exec(`DETACH DATABASE ${this.quoteIdentifier(schema)}`); } catch { /* already gone */ }
    }
    throw new SqliteAttachRefusedError(extra);
  }

  /** Statements of a poisoned transaction are refused (it was rolled back when ATTACH was found). */
  private assertTransactionUsable(): void {
    if (this.currentTransaction?.poisoned) {
      throw new SqliteAttachRefusedError(['(transaction rolled back after ATTACH)']);
    }
  }

  private async execute<U = any>(sql: string, params?: any[]): Promise<U> {
    if (!this.db) throw new Error('SQLite 未连接');
    this.assertTransactionUsable();
    this.assertNotAttached();
    try {
      return await this.executeUnchecked<U>(sql, params);
    } finally {
      this.assertNotAttached();
    }
  }

  private async executeUnchecked<U = any>(sql: string, params?: any[]): Promise<U> {
    if (!this.db) throw new Error('SQLite 未连接');
    const trimmedSql = sql.trim().toLowerCase();
    const isInsert = trimmedSql.startsWith('insert');
    const isUpdateOrDelete = trimmedSql.startsWith('update') || trimmedSql.startsWith('delete');
    // 带 RETURNING 的 DML 有结果集，不能走 run 丢行（剥离引号标识符与字符串字面量避免列名误判）
    const sqlWithoutLiterals = trimmedSql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    const hasReturning = /\breturning\b/.test(sqlWithoutLiterals);
    const args = this.prepareBindParams(params ?? []);

    const stmt = this.db.prepare(sql);
    if (isInsert && !hasReturning) {
      const result = stmt.run(...args) as { changes: number | bigint; lastInsertRowid: number | bigint };
      return {
        lastID: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      } as U;
    }
    if (isUpdateOrDelete && !hasReturning) {
      const result = stmt.run(...args) as { changes: number | bigint };
      return Number(result.changes) as U;
    }
    // SELECT / WITH / PRAGMA / DDL / 带 RETURNING 的 DML：按可能有结果集处理。
    // node:sqlite 的 all() 对无结果集语句返回空数组，不会抛错。
    const rows = stmt.all(...args) as any[];
    return this.processQueryResults(rows, stmt.columns()) as U;
  }

  /** Column declarations are scoped to the table in this database, never the result alias. */
  private readonly jsonColumns = new Map<string, ReadonlySet<string>>();

  registerTableSchema(table: string, definition: Record<string, { type: string }>): void {
    this.jsonColumns.set(table, new Set(Object.entries(definition)
      .filter(([, column]) => column?.type === 'json').map(([name]) => name)));
  }

  /** node:sqlite columns() is available since Node 22.16. It preserves table/column
   * provenance through aliases and joins; expression results have no origin. */
  private processQueryResults(data: any, columns: readonly StatementColumnMetadata[]): any {
    const decoded = new Set<string>();
    for (const column of columns) {
      // Registered model definitions describe the main database. Attached tables
      // with the same name do not inherit their schema.
      if (column.database === 'main' && column.table && column.column
        && this.jsonColumns.get(column.table)?.has(column.column)) decoded.add(column.name);
      else decoded.delete(column.name);
    }
    return Array.isArray(data) ? data.map(row => this.processRowData(row, decoded)) : data;
  }

  private processRowData(row: any, decoded: ReadonlySet<string>): any {
    if (!row || typeof row !== 'object') return row;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      result[key] = value;
      if (decoded.has(key) && typeof value === 'string') {
        try { result[key] = JSON.parse(value); } catch { /* Preserve invalid JSON exactly as before. */ }
      }
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }

  // SQL generation methods
  mapColumnType(type: string): string {
    const typeMap: Record<string, string> = {
      'text': 'TEXT',
      'integer': 'INTEGER',
      'bigint': 'INTEGER',
      'float': 'REAL',
      'boolean': 'INTEGER',
      'date': 'TEXT',
      'json': 'TEXT'
    };
    return typeMap[type.toLowerCase()] || 'TEXT';
  }
  
  quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
  
  getParameterPlaceholder(index: number): string {
    return '?';
  }
  
  getStatementTerminator(): string {
    return ';';
  }
  
  formatBoolean(value: boolean): string {
    return value ? '1' : '0';
  }
  
  formatDate(value: Date): string {
    return `'${value.toISOString()}'`;
  }
  
  formatJson(value: any): string {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  
  escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }
  
  formatDefaultValue(value: any): string {
    if (typeof value === 'string') {
      return `'${this.escapeString(value)}'`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      return value.toString();
    } else if (value instanceof Date) {
      return this.formatDate(value);
    } else if (value === null) {
      return 'NULL';
    } else if (typeof value === 'object') {
      return this.formatJson(value);
    } else {
      throw new Error(`Unsupported default value type: ${typeof value}`);
    }
  }
  
  formatLimit(limit: number): string {
    return `LIMIT ${limit}`;
  }
  
  formatOffset(offset: number): string {
    return `OFFSET ${offset}`;
  }
  
  formatLimitOffset(limit: number, offset: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`;
  }
  
  formatCreateTable<T extends keyof S>(tableName: T, columns: string[]): string {
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(String(tableName))} (${columns.join(', ')})`;
  }
  
  formatColumnDefinition(field: string, column: Column<any>): string {
    const name = this.quoteIdentifier(String(field));
    const type = this.mapColumnType(column.type);
    // SQLite only enables rowid auto-increment for the exact INTEGER PRIMARY KEY form.
    const length = column.length && !column.autoIncrement ? `(${column.length})` : '';
    const nullable = column.nullable === false ? ' NOT NULL' : '';
    const primary = column.primary ? ' PRIMARY KEY' : '';
    const unique = column.unique ? ' UNIQUE' : '';
    const autoIncrement = column.autoIncrement ? ' AUTOINCREMENT' : '';
    const defaultVal = column.default !== undefined 
      ? ` DEFAULT ${this.formatDefaultValue(column.default)}` 
      : '';
    
    return `${name} ${type}${length}${primary}${autoIncrement}${unique}${nullable}${defaultVal}`;
  }
  
  formatAlterTable<T extends keyof S>(tableName: T, alterations: string[]): string {
    return `ALTER TABLE ${this.quoteIdentifier(String(tableName))} ${alterations.join(', ')}`;
  }
  
  formatDropTable<T extends keyof S>(tableName: T, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TABLE ${ifExistsClause}${this.quoteIdentifier(String(tableName))}`;
  }
  
  formatDropIndex<T extends keyof S>(indexName: string, tableName: T, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)}`;
  }
  
  // ============================================================================
  // Transaction Support
  // ============================================================================
  
  /**
   * SQLite 支持事务
   */
  supportsTransactions(): boolean {
    return true;
  }
  
  /**
   * 开始事务
   */
  async beginTransaction(options?: TransactionOptions): Promise<Transaction> {
    const dialect = this;
    const readOnly = options?.readOnly === true;

    // Write transactions: IMMEDIATE takes the write lock at BEGIN, so contention with the
    // gateway's connection surfaces there (retried by query()), never as SQLITE_BUSY_SNAPSHOT
    // halfway through. A declared read-only transaction takes no write lock (DEFERRED: WAL
    // readers never wait for a writer) and query_only makes an accidental write fail loudly.
    // Callers that cannot declare intent (the plugin-runtime Database Host) stay IMMEDIATE.
    await this.query(readOnly ? 'BEGIN DEFERRED' : 'BEGIN IMMEDIATE');
    this.transactionOpen = true;
    const state = { poisoned: false };
    this.currentTransaction = state;
    if (readOnly) {
      try {
        await this.query('PRAGMA query_only = ON');
      } catch (error) {
        await this.query('ROLLBACK').catch(() => undefined);
        this.transactionOpen = false;
        throw error;
      }
    }
    const close = async (): Promise<void> => {
      dialect.transactionOpen = false;
      if (dialect.currentTransaction === state) dialect.currentTransaction = null;
      if (readOnly) await dialect.query('PRAGMA query_only = OFF').catch(() => undefined);
    };
    const finish = async (sql: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
      if (state.poisoned) {
        // Already rolled back when the ATTACH was found: nothing to commit, nothing to roll back.
        await close();
        if (sql === 'COMMIT') throw new SqliteAttachRefusedError(['(transaction rolled back after ATTACH)']);
        return;
      }
      try {
        await dialect.query(sql);
      } catch (error) {
        // A failed COMMIT (e.g. busy past the budget) leaves the transaction to the caller's rollback.
        if (sql === 'ROLLBACK') await close();
        throw error;
      }
      await close();
    };

    return {
      commit: () => finish('COMMIT'),
      rollback: () => finish('ROLLBACK'),
      async query<T = any>(sql: string, params?: any[]): Promise<T> {
        return dialect.query<T>(sql, params);
      },
      /** `prepare()` compiles only the first statement; with `maxRows` rows are iterated, not all read. */
      async queryStatement<T = any>(sql: string, options?: StatementQueryOptions): Promise<T> {
        const maxRows = options?.maxRows;
        if (maxRows === undefined || !dialect.db) return capRows(await dialect.query<T>(sql), maxRows);
        dialect.assertTransactionUsable();
        dialect.assertNotAttached();
        const rows: unknown[] = [];
        let truncated = false;
        let statement: any;
        try {
          statement = dialect.db.prepare(sql);
          for (const row of statement.iterate()) {
            if (rows.length >= maxRows) { truncated = true; break; }
            rows.push(row);
          }
        } finally {
          dialect.assertNotAttached();
        }
        return markTruncated(dialect.processQueryResults(rows, statement.columns()) as unknown[], truncated) as T;
      }
    };
  }
}
export class Sqlite<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<SQLiteDialectConfig, S> {
  constructor(config: SQLiteDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new SQLiteDialect<S>(config), definitions);
  }
}
