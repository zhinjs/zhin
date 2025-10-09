import {Dialect} from "../base";
import {Registry} from "../registry";
import {Database} from "../base";
import {Column} from "../types";
import {RelatedDatabase} from "../type/related/database";


export interface SQLiteDialectConfig {
  filename: string;
  mode?:string
}

export class SQLiteDialect extends Dialect<SQLiteDialectConfig, string> {
  private db: any = null;

  constructor(config: SQLiteDialectConfig) {
    super('sqlite', config);
  }

  // Connection management
  isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    try {
      const { default: sqlite3 } = await import('sqlite3');
      this.db = new sqlite3.Database(this.config.filename);
    } catch (error) {
      console.error('forgot install sqlite3 ?');
      throw new Error(`SQLite 连接失败: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.db = null;
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected();
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: any, rows: any) => {
        if (err) {
          reject(err);
        } else {
          // 对查询结果进行后处理，移除多余的引号
          const processedRows = this.processQueryResults(rows);
          resolve(processedRows as U);
        }
      });
      this.db.get(sql, params, (err: any, row: any) => {
        if (err) {
          reject(err);
        } else {
          // 对单行结果进行后处理
          const processedRow = this.processQueryResults(row);
          resolve(processedRow as U);
        }
      });
    });
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
    
    return value;
  }

  async dispose(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
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
  
  formatCreateTable(tableName: string, columns: string[]): string {
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(tableName)} (${columns.join(', ')})`;
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
  
  formatAlterTable(tableName: string, alterations: string[]): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} ${alterations.join(', ')}`;
  }
  
  formatDropTable(tableName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TABLE ${ifExistsClause}${this.quoteIdentifier(tableName)}`;
  }
  
  formatDropIndex(indexName: string, tableName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)}`;
  }
}
Registry.register('sqlite', (config: SQLiteDialectConfig, schemas?: Database.Schemas<Record<string, object>>) => {
  return new RelatedDatabase(new SQLiteDialect(config), schemas);
});