import {Dialect} from '../base/index.js';
import {RelatedDatabase} from "../type/related/database.js";
import {Database} from "../base/index.js";
import {Registry} from "../registry.js";
import type { ClientConfig } from 'pg';
import {Column} from "../types.js";

export interface PostgreSQLDialectConfig extends ClientConfig {}

export class PostgreSQLDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<PostgreSQLDialectConfig, S, string> {
  private connection: any = null;

  constructor(config: PostgreSQLDialectConfig) {
    super('pg', config);
  }

  // Connection management
  isConnected(): boolean {
    return this.connection !== null;
  }

  async connect(): Promise<void> {
    try {
      const { Client } = await import('pg');
      this.connection = new Client(this.config);
      await this.connection.connect();
    } catch (error) {
      console.error('forgot install pg ?');
      throw new Error(`PostgreSQL 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connection = null;
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected();
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    const result = await this.connection.query(sql, params);
    return result.rows as U;
  }

  async dispose(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
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
}
export class PG<S extends Record<string, object> = Record<string, object>> extends RelatedDatabase<PostgreSQLDialectConfig, S> {
  constructor(config: PostgreSQLDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new PostgreSQLDialect<S>(config), definitions);
  }
}
Registry.register('pg', PG);