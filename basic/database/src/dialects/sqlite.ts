import * as fs from 'node:fs';
import path from 'node:path';
import { Dialect } from '../base/index.js';
import { Registry } from '../registry.js';
import { Database } from '../base/index.js';
import { Column, Transaction, TransactionOptions } from '../types.js';
import { RelatedDatabase } from '../type/related/database.js';

export interface SQLiteDialectConfig {
  filename: string;
  mode?: string;
}

export class SQLiteDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<SQLiteDialectConfig, S, string> {
  /** Node 内置 SQLite 连接（node:sqlite），在 connect() 中动态加载 */
  private db: { prepare(sql: string): any; close(): void } | null = null;

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
    const isSelect = trimmedSql.startsWith('select');
    const isInsert = trimmedSql.startsWith('insert');
    const isUpdateOrDelete = trimmedSql.startsWith('update') || trimmedSql.startsWith('delete');
    const args = this.prepareBindParams(params ?? []);

    try {
      const stmt = this.db.prepare(sql);
      if (isSelect) {
        const rows = stmt.all(...args) as any[];
        return this.processQueryResults(rows) as U;
      }
      if (isInsert) {
        const result = stmt.run(...args) as { changes: number | bigint; lastInsertRowid: number | bigint };
        return {
          lastID: Number(result.lastInsertRowid),
          changes: Number(result.changes),
        } as U;
      }
      if (isUpdateOrDelete) {
        const result = stmt.run(...args) as { changes: number | bigint };
        return Number(result.changes) as U;
      }
      stmt.run(...args);
      return undefined as U;
    } catch (err) {
      throw err;
    }
  }

  /**
   * 处理查询结果，移除字符串字段的多余引号
   */
  private processQueryResults(data: any): any {
    if (!data) return data;
    
    if (Array.isArray(data)) {
      return data.map(row => this.processRowData(row));
    } else if (typeof data === 'object') {
      return this.processRowData(data);
    }
    
    return data;
  }

  /**
   * 处理单行数据
   */
  private processRowData(row: any): any {
    if (!row || typeof row !== 'object') return row;
    
    const processedRow: any = {};
    
    for (const [key, value] of Object.entries(row)) {
      processedRow[key] = this.processFieldValue(value);
    }
    
    return processedRow;
  }

  /**
   * 处理字段值，移除多余的引号并解析 JSON
   */
  private processFieldValue(value: any): any {
    if (typeof value !== 'string') return value;
    
    // 移除字符串两端的引号（如果存在）
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      const unquoted = value.slice(1, -1);
      
      // 尝试解析为 JSON（用于 json 类型字段）
      if (unquoted.startsWith('{') || unquoted.startsWith('[')) {
        try {
          return JSON.parse(unquoted);
        } catch {
          // 如果解析失败，返回去除引号的字符串
          return unquoted;
        }
      }
      
      return unquoted;
    }
    
    // 尝试解析没有引号包裹但看起来像 JSON 的值（SQLite 驱动返回的 json 类型字段）
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        // 解析失败，返回原始字符串
      }
    }
    
    return value;
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
    const length = column.length ? `(${column.length})` : '';
    const nullable = column.nullable === false ? ' NOT NULL' : '';
    const primary = column.primary ? ' PRIMARY KEY' : '';
    const unique = column.unique ? ' UNIQUE' : '';
    const defaultVal = column.default !== undefined 
      ? ` DEFAULT ${this.formatDefaultValue(column.default)}` 
      : '';
    
    return `${name} ${type}${length}${primary}${unique}${nullable}${defaultVal}`;
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
Registry.register('sqlite', Sqlite);