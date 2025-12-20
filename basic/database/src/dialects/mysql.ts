import {Dialect} from '../base/index.js';
import {RelatedDatabase} from "../type/related/database.js";
import {Registry} from "../registry.js";
import type { ConnectionOptions, PoolOptions } from 'mysql2/promise';
import {Database} from "../base/index.js";
import {Column, Transaction, TransactionOptions, IsolationLevel, PoolConfig} from "../types.js";

export interface MySQLDialectConfig extends ConnectionOptions {
  /**
   * 连接池配置
   * 如果提供此选项，将使用连接池而不是单连接
   */
  pool?: PoolConfig;
}

export class MySQLDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<MySQLDialectConfig, S, string> {
  private connection: any = null;
  private pool: any = null;
  private usePool: boolean = false;

  constructor(config: MySQLDialectConfig) {
    super('mysql', config);
    this.usePool = !!config.pool;
  }

  // Connection management
  isConnected(): boolean {
    return this.usePool ? this.pool !== null : this.connection !== null;
  }

  async connect(): Promise<void> {
    try {
      if (this.usePool) {
        const { createPool } = await import('mysql2/promise');
        const poolConfig: PoolOptions = {
          ...this.config,
          waitForConnections: true,
          connectionLimit: this.config.pool?.max ?? 10,
          queueLimit: 0,
          idleTimeout: this.config.pool?.idleTimeoutMillis ?? 60000,
        };
        this.pool = createPool(poolConfig);
        console.log(`MySQL 连接池已创建 (max: ${poolConfig.connectionLimit})`);
      } else {
        const { createConnection } = await import('mysql2/promise');
        this.connection = await createConnection(this.config);
      }
    } catch (error) {
      console.error('forgot install mysql2 ?');
      throw new Error(`MySQL 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.usePool && this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('MySQL 连接池已关闭');
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
      const [rows] = await this.pool.execute(sql, params);
      return rows as U;
    } else {
      const [rows] = await this.connection.execute(sql, params);
      return rows as U;
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
      total: this.pool.pool?._allConnections?.length ?? 0,
      idle: this.pool.pool?._freeConnections?.length ?? 0,
      waiting: this.pool.pool?._connectionQueue?.length ?? 0,
    };
  }

  // SQL generation methods
  mapColumnType(type: string): string {
    const typeMap: Record<string, string> = {
      'text': 'TEXT',
      'integer': 'INT',
      'float': 'FLOAT',
      'boolean': 'BOOLEAN',
      'date': 'DATETIME',
      'json': 'JSON'
    };
    return typeMap[type.toLowerCase()] || 'TEXT';
  }

  quoteIdentifier(identifier: string): string {
    return `\`${identifier}\``;
  }

  getParameterPlaceholder(index: number): string {
    return '?';
  }

  getStatementTerminator(): string {
    return ';';
  }

  formatBoolean(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }

  formatDate(value: Date): string {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
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
    return `LIMIT ${offset}, ${limit}`;
  }

  formatCreateTable<T extends keyof S>(tableName: T, columns: string[]): string {
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(String(tableName))} (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
  }

  formatColumnDefinition(field: string, column: Column<any>): string {
    const name = this.quoteIdentifier(String(field));
    const type = this.mapColumnType(column.type);
    const length = column.length ? `(${column.length})` : '';
    const nullable = column.nullable === false ? ' NOT NULL' : '';
    const primary = column.primary ? ' PRIMARY KEY' : '';
    const unique = column.unique ? ' UNIQUE' : '';
    const autoIncrement = column.autoIncrement ? ' AUTO_INCREMENT' : '';
    const defaultVal = column.default !== undefined
      ? ` DEFAULT ${this.formatDefaultValue(column.default)}`
      : '';

    return `${name} ${type}${length}${primary}${unique}${autoIncrement}${nullable}${defaultVal}`;
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
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(String(tableName))}`;
  }
  
  // ============================================================================
  // Transaction Support
  // ============================================================================
  
  /**
   * MySQL 支持事务
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
      const connection = await this.pool.getConnection();
      
      // 设置隔离级别
      if (options?.isolationLevel) {
        await connection.execute(`SET TRANSACTION ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`);
      }
      
      // 开始事务
      await connection.execute('START TRANSACTION');
      
      return {
        async commit(): Promise<void> {
          try {
            await connection.execute('COMMIT');
          } finally {
            connection.release(); // 归还连接到池
          }
        },
        
        async rollback(): Promise<void> {
          try {
            await connection.execute('ROLLBACK');
          } finally {
            connection.release(); // 归还连接到池
          }
        },
        
        async query<T = any>(sql: string, params?: any[]): Promise<T> {
          const [rows] = await connection.execute(sql, params);
          return rows as T;
        }
      };
    } else {
      // 单连接模式
      const dialect = this;
      
      // 设置隔离级别
      if (options?.isolationLevel) {
        await this.query(`SET TRANSACTION ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`);
      }
      
      // 开始事务
      await this.query('START TRANSACTION');
      
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
export class MySQL<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<MySQLDialectConfig, S> {
  constructor(config: MySQLDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new MySQLDialect<S>(config), definitions);
  }
}
Registry.register('mysql', MySQL);