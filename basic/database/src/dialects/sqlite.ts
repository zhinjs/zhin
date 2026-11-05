import type { StatementColumnMetadata } from 'node:sqlite';
import * as fs from 'node:fs';
import path from 'node:path';
import { Dialect, Database } from '../base/index.js';

import { Column, Transaction, TransactionOptions } from '../types.js';
import { RelatedDatabase } from '../type/related/database.js';

export interface SQLiteDialectConfig {
  filename: string;
  mode?: string;
}

export class SQLiteDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<SQLiteDialectConfig, S, string> {
  /** Node 内置 SQLite 连接（node:sqlite），在 connect() 中动态加载 */
  private db: { prepare(sql: string): any; exec?(sql: string): void; close(): void } | null = null;

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
      this.db = new DatabaseSync(this.config.filename);
      try {
        if (this.config.filename !== ':memory:') {
          this.db?.exec?.('PRAGMA journal_mode = WAL;');
        }
        this.db?.exec?.('PRAGMA busy_timeout = 5000;');
      } catch {
        // Ignore PRAGMA errors on special/read-only database files
      }
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
    
    // 开始事务
    await this.query('BEGIN TRANSACTION');
    
    return {
      async commit(): Promise<void> {
        await dialect.query('COMMIT');
      },
      
      async rollback(): Promise<void> {
        await dialect.query('ROLLBACK');
      },
      
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
