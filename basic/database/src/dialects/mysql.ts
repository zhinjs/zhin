import { Dialect, Database } from '../base/index.js';
import {RelatedDatabase} from "../type/related/database.js";
import { getLogger } from '@zhin.js/logger';
import type { ConnectionOptions, PoolOptions } from 'mysql2/promise';

import {Column, Transaction, TransactionOptions, PoolConfig, type Definition, type StatementQueryOptions} from "../types.js";
import { markTruncated } from '../base/statement-rows.js';

const logger = getLogger('database');

export interface MySQLDialectConfig extends ConnectionOptions {
  /**
   * 连接池配置
   * 如果提供此选项，将使用连接池而不是单连接
   */
  pool?: PoolConfig;
  /**
   * Pool mode: `COM_RESET_CONNECTION` (`connection.reset()`, MySQL 5.7.3+) before a connection
   * goes back to the pool, so session variables, user variables, temporary tables and prepared
   * statements never outlive one use; a connection that cannot be reset is destroyed. The
   * restricted Console account uses it (ADR 0059 §4).
   */
  resetSession?: boolean;
}

/** `ClientConstants.LOCAL_FILES` / `MULTI_STATEMENTS` of the MySQL protocol. */
const CLIENT_LOCAL_FILES = 0x80;
const CLIENT_MULTI_STATEMENTS = 0x10000;

export class MySQLDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<MySQLDialectConfig, S, string> {
  private connection: any = null;
  private pool: any = null;
  private usePool: boolean = false;
  private readonly booleanColumns = new Set<string>();
  private readonly bigintColumns = new Set<string>();
  /** `SELECT VERSION()` of the server, read once at connect ('' when it could not be read). */
  private serverVersion = '';

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
        const { pool, resetSession: _reset, ...connectionOptions } = this.config;
        const poolConfig: PoolOptions = {
          ...connectionOptions,
          waitForConnections: true,
          connectionLimit: pool?.max ?? 10,
          queueLimit: 0,
          idleTimeout: pool?.idleTimeoutMillis ?? 60000,
        };
        this.pool = createPool(poolConfig);
        logger.info(`MySQL 连接池已创建 (max: ${poolConfig.connectionLimit})`);
      } else {
      const { createConnection } = await import('mysql2/promise');
      const { resetSession: _reset, ...connectionOptions } = this.config;
      this.connection = await createConnection(connectionOptions);
      }
    } catch (error) {
      logger.error('forgot install mysql2 ?');
      throw new Error(`MySQL 连接失败: ${error}`);
    }
    try {
      const rows = await this.query<Array<{ v?: unknown }>>('SELECT VERSION() AS v');
      this.serverVersion = String(rows?.[0]?.v ?? '');
    } catch (error) {
      this.serverVersion = '';
      // Unknown server: indexed text keys fall back to utf8mb4_0900_bin, which MariaDB < 11.4 lacks.
      logger.warn(`MySQL: could not read VERSION() (${error instanceof Error ? error.message : String(error)}); assuming MySQL 8 collations`);
    }
  }

  /** Whether the server is MariaDB (from `VERSION()`; false when unknown). */
  isMariaDb(): boolean {
    return /mariadb/iu.test(this.serverVersion);
  }

  /**
   * Binary, NO PAD collation for indexed text keys: `utf8mb4_0900_bin` (MySQL 8.0+),
   * `utf8mb4_nopad_bin` (MariaDB 10.2+, which has no 0900 collations before 11.4), and
   * `utf8mb4_bin` on MySQL 5.7 (binary, but PAD SPACE: the only binary utf8mb4 collation there).
   */
  indexedTextCollation(): string {
    if (this.isMariaDb()) return 'utf8mb4_nopad_bin';
    const major = Number(/^(\d+)\./u.exec(this.serverVersion)?.[1]);
    return Number.isFinite(major) && major > 0 && major < 8 ? 'utf8mb4_bin' : 'utf8mb4_0900_bin';
  }

  async disconnect(): Promise<void> {
    if (this.usePool && this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('MySQL 连接池已关闭');
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

  /**
   * What the driver will actually send at connect time (after merging `uri` and `flags`):
   * whether `LOAD DATA LOCAL` and multiple statements are possible on this connection.
   */
  connectionSafety(): { readonly localFiles: boolean; readonly multipleStatements: boolean } | undefined {
    const config = this.usePool ? this.pool?.pool?.config?.connectionConfig : this.connection?.connection?.config;
    if (!config || typeof config.clientFlags !== 'number') return undefined;
    return Object.freeze({
      localFiles: (config.clientFlags & CLIENT_LOCAL_FILES) !== 0 || typeof config.infileStreamFactory === 'function',
      multipleStatements: config.multipleStatements === true || (config.clientFlags & CLIENT_MULTI_STATEMENTS) !== 0,
    });
  }

  /** Gives a pool connection back, reset first with {@link MySQLDialectConfig.resetSession}. */
  private async releaseConnection(connection: { reset?(): Promise<void>; release(): void; destroy(): void }): Promise<void> {
    if (!this.config.resetSession) { connection.release(); return; }
    try {
      if (typeof connection.reset !== 'function') throw new Error('connection.reset() is not available');
      await connection.reset();
      connection.release();
    } catch {
      connection.destroy();
    }
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    if (this.usePool && this.config.resetSession) {
      const connection = await this.pool.getConnection();
      try {
        const [rows, fields] = await connection.execute(sql, params);
        return this.processQueryResults(rows, fields) as U;
      } finally {
        await this.releaseConnection(connection);
      }
    }
    if (this.usePool) {
      const [rows, fields] = await this.pool.execute(sql, params);
      return this.processQueryResults(rows, fields) as U;
    } else {
    const [rows, fields] = await this.connection.execute(sql, params);
    return this.processQueryResults(rows, fields) as U;
    }
  }

  /**
   * One statement as a prepared statement (binary protocol): MySQL never runs a second statement
   * from it, even when the connection was configured with `multipleStatements`. With `maxRows`
   * the rows are streamed and those past the cap discarded, so memory stays bounded.
   */
  private async queryStatementOn(connection: any, sql: string, options?: StatementQueryOptions): Promise<unknown> {
    const maxRows = options?.maxRows;
    const core = connection?.connection;
    if (maxRows === undefined || typeof core?.execute !== 'function') {
      const [rows, fields] = await connection.execute(sql, []);
      if (maxRows === undefined || !Array.isArray(rows)) return this.processQueryResults(rows, fields);
      const extra = rows.length > maxRows;
      return markTruncated(this.processQueryResults(rows.slice(0, maxRows), fields) as unknown[], extra);
    }
    const { rows, fields, truncated, header } = await new Promise<{ rows: unknown[]; fields: unknown; truncated: boolean; header?: unknown }>((resolve, reject) => {
      const rows: unknown[] = [];
      let fields: unknown;
      let header: unknown;
      let truncated = false;
      const command = core.execute(sql, []);
      command.on('error', reject);
      command.on('fields', (value: unknown) => { fields = value; });
      command.on('result', (row: unknown) => {
        if (fields === undefined) { header = row; return; }
        if (rows.length < maxRows) rows.push(row);
        else truncated = true;
      });
      command.on('end', () => resolve({ rows, fields, truncated, header }));
    });
    if (fields === undefined && header !== undefined) return header;
    return markTruncated(this.processQueryResults(rows, fields) as unknown[], truncated);
  }

  registerTableSchema(table: string, definition: Record<string, { type: string }>): void {
    for (const [columnName, column] of Object.entries(definition)) {
      if (column.type === 'boolean') this.booleanColumns.add(`${table}.${columnName}`);
      if (column.type === 'bigint') this.bigintColumns.add(`${table}.${columnName}`);
    }
  }

  private processQueryResults(data: unknown, fields: any): unknown {
    if (!Array.isArray(data)) return data;
    return data.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const normalized = { ...row } as Record<string, unknown>;
      for (const field of Array.isArray(fields) ? fields : []) {
        const table = String(field.orgTable ?? field.table ?? '');
        const column = String(field.orgName ?? field.name ?? '');
        const outputName = String(field.name ?? column);
        if (
          this.booleanColumns.has(`${table}.${column}`) &&
          typeof normalized[outputName] === 'number'
        ) {
          normalized[outputName] = normalized[outputName] !== 0;
        }
        if (
          this.bigintColumns.has(`${table}.${column}`) &&
          typeof normalized[outputName] === 'string' &&
          /^-?\d+$/u.test(normalized[outputName])
        ) {
          const number = Number(normalized[outputName]);
          if (Number.isSafeInteger(number)) normalized[outputName] = number;
        }
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
      'bigint': 'BIGINT',
      'float': 'FLOAT',
      'boolean': 'BOOLEAN',
      'date': 'DATETIME',
      'json': 'JSON'
    };
    return typeMap[type.toLowerCase()] || 'TEXT';
  }

  quoteIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
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
    return `'${this.escapeString(JSON.stringify(value))}'`;
  }

  /** MySQL string literals treat `\\` as an escape (unless `NO_BACKSLASH_ESCAPES`): double both. */
  escapeString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
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
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(String(tableName))} (${columns.join(', ')}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`;
  }

  formatColumnDefinition(field: string, column: Column<any>): string {
    const name = this.quoteIdentifier(String(field));
    // TEXT cannot be indexed in full. Bounded keys retain full-value uniqueness
    // within InnoDB's 3072-byte index limit under utf8mb4 (4 bytes per character).
    const boundedText = column.type.toLowerCase() === 'text'
      && (column.length !== undefined || column.primary || column.unique);
    const indexedText = boundedText && (column.primary || column.unique);
    if (boundedText && (!Number.isInteger(column.length ?? 768) || (column.length ?? 768) < 1)) {
      throw new RangeError(`MySQL text column ${field} requires a positive integer length`);
    }
    if (indexedText && (column.length ?? 768) > 768) {
      throw new RangeError(`MySQL indexed text column ${field} exceeds the utf8mb4 index limit of 768 characters`);
    }
    const collation = indexedText ? ` CHARACTER SET utf8mb4 COLLATE ${this.indexedTextCollation()}` : '';
    const type = boundedText ? 'VARCHAR' : this.mapColumnType(column.type);
    const length = boundedText ? `(${column.length ?? 768})` : column.length ? `(${column.length})` : '';
    const nullable = column.nullable === false ? ' NOT NULL' : '';
    const primary = column.primary ? ' PRIMARY KEY' : '';
    const unique = column.unique ? ' UNIQUE' : '';
    const autoIncrement = column.autoIncrement ? ' AUTO_INCREMENT' : '';
    let defaultVal = '';
    if (column.default !== undefined) {
      const value = this.formatDefaultValue(column.default);
      // MySQL 8.0.13+ requires even literal TEXT/JSON defaults to be expressions.
      const expression = (type === 'TEXT' || type === 'JSON') && column.default !== null;
      defaultVal = ` DEFAULT ${expression ? `(${value})` : value}`;
    }

    return `${name} ${type}${length}${collation}${primary}${unique}${autoIncrement}${nullable}${defaultVal}`;
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
    const placeholders = tableNames.map(() => '?').join(', ');
    const rows = await this.query<Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      extra: string;
    }>>(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, EXTRA AS extra
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
      tableNames,
    );
    const narrowTypes = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer']);
    for (const row of rows) {
      const column = expected.get(`${row.table_name}\0${row.column_name}`);
      if (!column) continue;
      const needsBigint = column.type === 'bigint' && narrowTypes.has(row.data_type.toLowerCase());
      const needsAutoIncrement = Boolean(column.autoIncrement) && !row.extra.toLowerCase().includes('auto_increment');
      if (!needsBigint && !needsAutoIncrement) continue;
      const definition = this.formatColumnDefinition(row.column_name, {
        ...column,
        primary: false,
        unique: false,
      });
      await this.query(`ALTER TABLE ${this.quoteIdentifier(row.table_name)} MODIFY COLUMN ${definition}`);
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
    const dialect = this;
    if (this.usePool) {
      // 从连接池获取一个连接用于事务
      const connection = await this.pool.getConnection();
      try {
        // 设置隔离级别
        if (options?.isolationLevel) {
          await connection.query(`SET TRANSACTION ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`);
        }
        
        // 开始事务；声明只读时数据库拒绝写入
        if (options?.readOnly) await connection.query('START TRANSACTION READ ONLY');
        else await connection.beginTransaction();
      } catch (error) {
        await dialect.releaseConnection(connection);
        throw error;
      }
      
      return {
        async commit(): Promise<void> {
          try {
            await connection.commit();
          } finally {
            await dialect.releaseConnection(connection); // 归还连接到池
          }
        },
        
        async rollback(): Promise<void> {
          try {
            await connection.rollback();
          } finally {
            await dialect.releaseConnection(connection); // 归还连接到池
          }
        },
        
        async query<T = any>(sql: string, params?: any[]): Promise<T> {
          const [rows, fields] = await connection.execute(sql, params);
          return dialect.processQueryResults(rows, fields) as T;
        },

        async queryStatement<T = any>(sql: string, options?: StatementQueryOptions): Promise<T> {
          return await dialect.queryStatementOn(connection, sql, options) as T;
        }
      };
    } else {
      // 设置隔离级别
      if (options?.isolationLevel) {
        await this.connection.query(`SET TRANSACTION ISOLATION LEVEL ${this.formatIsolationLevel(options.isolationLevel)}`);
      }
      
      // 开始事务；声明只读时数据库拒绝写入
      if (options?.readOnly) await this.connection.query('START TRANSACTION READ ONLY');
      else await this.connection.beginTransaction();
      const connection = this.connection;
      
      return {
        async commit(): Promise<void> {
          await connection.commit();
        },
        
        async rollback(): Promise<void> {
          await connection.rollback();
        },
        
        async query<T = any>(sql: string, params?: any[]): Promise<T> {
          const [rows, fields] = await connection.execute(sql, params);
          return dialect.processQueryResults(rows, fields) as T;
        },

        async queryStatement<T = any>(sql: string, options?: StatementQueryOptions): Promise<T> {
          return await dialect.queryStatementOn(connection, sql, options) as T;
        }
      };
    }
  }
}
export class MySQL<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<MySQLDialectConfig, S> {
  constructor(config: MySQLDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new MySQLDialect<S>(config), definitions);
  }

  protected override async initialize(): Promise<void> {
    const indexedText = [...this.definitions.values()].flatMap(definition =>
      (Object.entries(definition) as Array<[string, Column<any>]>).filter(([, column]) => column.type.toLowerCase() === 'text' && (column.primary || column.unique)));
    if (indexedText.length) {
      const [settings] = await this.dialect.query<Array<{ page_size: number }>>('SELECT @@innodb_page_size AS page_size');
      const maxLength = Math.min(768, Number(settings?.page_size) * 3 / 64);
      if (!Number.isFinite(maxLength) || maxLength < 1) throw new Error('Cannot determine MySQL InnoDB text index limit');
      for (const [name, column] of indexedText) {
        if ((column.length ?? 768) > maxLength) {
          throw new RangeError(`MySQL indexed text column ${name} requires ${column.length ?? 768} characters, but innodb_page_size=${settings.page_size} allows ${maxLength}; use a 16KB-or-larger InnoDB page size or declare a smaller key length`);
        }
      }
    }
    await super.initialize();
  }
}

declare module '../registry.js' {
  interface Databases<S extends Record<string, object> = Record<string, object>> {
    mysql: MySQL<S>;
  }
  namespace Registry {
    interface Config { mysql: MySQLDialectConfig; }
  }
}
