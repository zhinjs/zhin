import { Dialect, Database } from '../base/index.js';
import {RelatedDatabase} from "../type/related/database.js";

import {Registry} from "../registry.js";
import { getLogger } from '@zhin.js/logger';
import type { ClientConfig, PoolConfig as PgPoolConfig } from 'pg';
import {Column, Transaction, TransactionOptions, PoolConfig, type Definition} from "../types.js";

const logger = getLogger('database');

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
        const { pool, ...connectionOptions } = this.config;
        const poolConfig: PgPoolConfig = {
          ...connectionOptions,
          max: pool?.max ?? 10,
          min: pool?.min ?? 2,
          idleTimeoutMillis: pool?.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: pool?.acquireTimeoutMillis ?? 10000,
        };
        this.pool = new Pool(poolConfig);
        logger.info(`PostgreSQL 连接池已创建 (max: ${poolConfig.max})`);
      } else {
      const { Client } = await import('pg');
      this.connection = new Client(this.config);
      await this.connection.connect();
      }
    } catch (error) {
      logger.error('forgot install pg ?');
      throw new Error(`PostgreSQL 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.usePool && this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('PostgreSQL 连接池已关闭');
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
      return this.normalizeResult(result) as U;
    } else {
    const result = await this.connection.query(sql, params);
    return this.normalizeResult(result) as U;
    }
  }

  private normalizeResult(result: { rows: Record<string, unknown>[]; fields?: Array<{ name: string; dataTypeID: number }> }): Record<string, unknown>[] {
    const bigintFields = new Set((result.fields ?? [])
      .filter((field) => field.dataTypeID === 20)
      .map((field) => field.name));
    if (bigintFields.size === 0) return result.rows;
    return result.rows.map((row) => {
      const normalized = { ...row };
      for (const field of bigintFields) {
        const value = normalized[field];
        if (typeof value !== 'string' || !/^-?\d+$/u.test(value)) continue;
        const number = Number(value);
        if (Number.isSafeInteger(number)) normalized[field] = number;
      }
      return normalized;
    });
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
      'bigint': 'BIGINT',
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
    const autoIncrement = column.autoIncrement ? ' GENERATED BY DEFAULT AS IDENTITY' : '';
    const defaultVal = column.default !== undefined 
      ? ` DEFAULT ${this.formatDefaultValue(column.default)}` 
      : '';
    
    return `${name} ${type}${length}${autoIncrement}${primary}${unique}${nullable}${defaultVal}`;
  }

  async reconcileDefinitions(
    definitions: ReadonlyMap<keyof S, Definition<S[keyof S]>>,
  ): Promise<void> {
    const expected = new Map<string, Column<any>>();
    for (const [tableName, definition] of definitions) {
      for (const [columnName, column] of Object.entries(definition) as Array<[string, Column<any>]>) {
        if (column.type === 'bigint' || column.autoIncrement) {
          expected.set(`${String(tableName)}\0${columnName}`, column);
        }
      }
    }
    if (expected.size === 0) return;

    const tableNames = [...new Set([...expected.keys()].map((key) => key.slice(0, key.indexOf('\0'))))];
    const rows = await this.query<Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_identity: 'YES' | 'NO';
      column_default: string | null;
    }>>(
      `SELECT table_name, column_name, data_type, is_identity, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [tableNames],
    );
    for (const row of rows) {
      const definition = expected.get(`${row.table_name}\0${row.column_name}`);
      if (!definition) continue;
      const table = this.quoteIdentifier(row.table_name);
      const column = this.quoteIdentifier(row.column_name);
      if (definition.type === 'bigint' && (row.data_type === 'smallint' || row.data_type === 'integer')) {
        await this.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE BIGINT USING ${column}::BIGINT`);
      }
      const hasSequenceDefault = row.column_default?.startsWith('nextval(') ?? false;
      if (definition.autoIncrement && row.is_identity !== 'YES' && !hasSequenceDefault) {
        await this.query(`ALTER TABLE ${table} ALTER COLUMN ${column} ADD GENERATED BY DEFAULT AS IDENTITY`);
        const maximum = await this.query<Array<{ max_value: number | string | null }>>(
          `SELECT MAX(${column}) AS max_value FROM ${table}`,
        );
        const maximumValue = maximum[0]?.max_value;
        const next = (maximumValue == null ? 1n : BigInt(maximumValue) + 1n).toString();
        const relation = `"${row.table_name.replaceAll('"', '""')}"`;
        await this.query(
          'SELECT setval(pg_get_serial_sequence($1, $2), $3, false)',
          [relation, row.column_name, next],
        );
      }
    }
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
    const dialect = this;
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
          return dialect.normalizeResult(result) as T;
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
