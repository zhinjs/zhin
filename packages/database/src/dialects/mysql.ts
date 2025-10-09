import {Dialect} from '../base';
import {RelatedDatabase} from "../type/related/database";
import {Registry} from "../registry";
import type { ConnectionOptions } from 'mysql2/promise';
import {Database} from "../base";
import {Column} from "../types";

export interface MySQLDialectConfig extends ConnectionOptions {}

export class MySQLDialect extends Dialect<MySQLDialectConfig, string> {
  private connection: any = null;

  constructor(config: MySQLDialectConfig) {
    super('mysql', config);
  }

  // Connection management
  isConnected(): boolean {
    return this.connection !== null;
  }

  async connect(): Promise<void> {
    try {
      const { createConnection } = await import('mysql2/promise');
      this.connection = await createConnection(this.config);
    } catch (error) {
      console.error('forgot install mysql2 ?');
      throw new Error(`MySQL 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connection = null;
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected();
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    const [rows] = await this.connection.execute(sql, params);
    return rows as U;
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

  formatCreateTable(tableName: string, columns: string[]): string {
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(tableName)} (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
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

  formatAlterTable(tableName: string, alterations: string[]): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} ${alterations.join(', ')}`;
  }

  formatDropTable(tableName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TABLE ${ifExistsClause}${this.quoteIdentifier(tableName)}`;
  }

  formatDropIndex(indexName: string, tableName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}`;
  }
}

Registry.register('mysql', (config: MySQLDialectConfig, schemas?: Database.Schemas<Record<string, object>>) => {
  return new RelatedDatabase(new MySQLDialect(config), schemas);
});
