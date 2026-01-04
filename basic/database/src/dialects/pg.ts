import {Dialect} from '../base/index.js';
import {RelatedDatabase} from "../type/related/database.js";
import {Database} from "../base/index.js";
import {Registry} from "../registry.js";
import type { ClientConfig, PoolConfig as PgPoolConfig } from 'pg';
import {Column, Transaction, TransactionOptions, PoolConfig} from "../types.js";

export interface PostgreSQLDialectConfig extends ClientConfig {
  /**
   * 连接池配置
   * 如果提供此选项，将使用连接池而不是单连接
   */
  pool?: PoolConfig;
}

export class PostgreSQLDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<PostgreSQLDialectConfig, S, string> {
  private connection: any = null;
  private pool: any = null;
  private usePool: boolean = false;

  constructor(config: PostgreSQLDialectConfig) {
    super('pg', config);
    this.usePool = !!config.pool;
  }

  // Connection management
  isConnected(): boolean {
    return this.usePool ? this.pool !== null : this.connection !== null;
  }

  async connect(): Promise<void> {
    try {
      if (this.usePool) {
        const { Pool } = await import('pg');
        const poolConfig: PgPoolConfig = {
          ...this.config,
          max: this.config.pool?.max ?? 10,
          min: this.config.pool?.min ?? 2,
          idleTimeoutMillis: this.config.pool?.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: this.config.pool?.acquireTimeoutMillis ?? 10000,
        };
        this.pool = new Pool(poolConfig);
        console.log(`PostgreSQL 连接池已创建 (max: ${poolConfig.max})`);
      } else {
      const { Client } = await import('pg');
      this.connection = new Client(this.config);
      await this.connection.connect();
      }
    } catch (error) {
      console.error('forgot install pg ?');
      throw new Error(`PostgreSQL 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.usePool && this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('PostgreSQL 连接池已关闭');
    } else if (this.connection) {
      await this.connection.end();
    this.connection = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConnected()) return false;
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    if (this.usePool) {
      const result = await this.pool.query(sql, params);
      return result.rows as U;
    } else {
    const result = await this.connection.query(sql, params);
    return result.rows as U;
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }
  
  /**
   * 获取连接池统计信息（仅在使用连接池时有效）
   */
  getPoolStats(): { total: number; idle: number; waiting: number } | null {
    if (!this.usePool || !this.pool) return null;
    return {
      total: this.pool.totalCount ?? 0,
      idle: this.pool.idleCount ?? 0,
      waiting: this.pool.waitingCount ?? 0,
    };
  }

  // SQL generation methods
  mapColumnType(type: string): string {
    const typeMap: Record<string, string> = {
      'text': 'TEXT',
      'integer': 'INTEGER',
      'float': 'REAL',
      'boolean': 'BOOLEAN',
      'date': 'TIMESTAMP',
      'json': 'JSONB'
    };
    return typeMap[type.toLowerCase()] || 'TEXT';
  }
  
  quoteIdentifier(identifier: string): string {
    return `"${identifier}"`;
  }
  
  getParameterPlaceholder(index: number): string {
    return `$${index + 1}`;
  }
  
  getStatementTerminator(): string {
    return ';';
  }
  
  formatBoolean(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }
  
  formatDate(value: Date): string {
    return `'${value.toISOString()}'::TIMESTAMP`;
  }
  
  formatJson(value: any): string {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::JSONB`;
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
   * PostgreSQL 支持事务
   */
  supportsTransactions(): boolean {
    return true;
  }
  
  /**
   * 开始事务
   * 在连接池模式下，会获取一个专用连接用于事务
   */
  async beginTransaction(options?: TransactionOptions): Promise<Transaction> {
    if (this.usePool) {
      // 从连接池获取一个连接用于事务
      const client = await this.pool.connect();
      
      // 开始事务（可以带隔离级别）
      let beginSql = 'BEGIN';
      if (options?.isolationLevel) {
        beginSql = `BEGIN ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`;
      }
      await client.query(beginSql);
      
      return {
        async commit(): Promise<void> {
          try {
            await client.query('COMMIT');
          } finally {
            client.release(); // 归还连接到池
          }
        },
        
        async rollback(): Promise<void> {
          try {
            await client.query('ROLLBACK');
          } finally {
            client.release(); // 归还连接到池
          }
        },
        
        async query<T = any>(sql: string, params?: any[]): Promise<T> {
          const result = await client.query(sql, params);
          return result.rows as T;
        }
      };
    } else {
      // 单连接模式
      const dialect = this;
      
      // 开始事务（可以带隔离级别）
      let beginSql = 'BEGIN';
      if (options?.isolationLevel) {
        beginSql = `BEGIN ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`;
      }
      await this.query(beginSql);
      
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
}
export class PG<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<PostgreSQLDialectConfig, S> {
  constructor(config: PostgreSQLDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new PostgreSQLDialect<S>(config), definitions);
  }
}
Registry.register('pg', PG);