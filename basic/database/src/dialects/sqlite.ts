import type { StatementColumnMetadata } from 'node:sqlite';
import * as fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Dialect, Database } from '../base/index.js';

import { Column, Transaction, TransactionOptions } from '../types.js';
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

function isInMemoryFilename(filename: string): boolean {
  return filename === ':memory:' || filename === '' || filename.startsWith('file::memory:');
}

export class SQLiteDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<SQLiteDialectConfig, S, string> {
  /** Node 内置 SQLite 连接（node:sqlite），在 connect() 中动态加载 */
  private db: { prepare(sql: string): any; exec(sql: string): void; close(): void; readonly isTransaction?: boolean } | null = null;
  /** Own transaction flag; `DatabaseSync#isTransaction` is preferred where Node provides it. */
  private transactionOpen = false;

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
      const db = new DatabaseSync(this.config.filename);
      try {
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

  async disconnect(): Promise<void> {
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

  private async execute<U = any>(sql: string, params?: any[]): Promise<U> {
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
    return `"${identifier}"`;
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
      if (readOnly) await dialect.query('PRAGMA query_only = OFF').catch(() => undefined);
    };
    const finish = async (sql: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
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
      }
    };
  }
}
export class Sqlite<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<SQLiteDialectConfig, S> {
  constructor(config: SQLiteDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new SQLiteDialect<S>(config), definitions);
  }
}
