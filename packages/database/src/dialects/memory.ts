import {Dialect} from '../base';
import {MemoryConfig} from "../types";
import {RelatedDatabase} from "../type/related/database";
import {Registry} from "../registry";

interface MemoryTable {
  name: string;
  schema: Record<string, any>;
  data: Record<string, any>[];
  indexes: Map<string, MemoryIndex>;
}

interface MemoryIndex {
  index: Map<any, number[]>;
  columns: string[];
  unique: boolean;
}

export class MemoryDialect extends Dialect<MemoryConfig,string> {
  private connected = false;
  private tables: Map<string, MemoryTable> = new Map();
  private autoIncrementCounters: Map<string, Map<string, number>> = new Map();

  constructor(config: MemoryConfig = {}) {
    super('memory', config);
  }

  // Connection management
  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.tables.clear();
    this.autoIncrementCounters.clear();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.tables.clear();
    this.autoIncrementCounters.clear();
  }

  async healthCheck(): Promise<boolean> {
    return this.isConnected();
  }

  async query<U = any>(sql: string, params?: any[]): Promise<U> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }

    // 简单的 SQL 解析和执行
    const trimmedSql = sql.trim().toLowerCase();
    
    if (trimmedSql.startsWith('create table')) {
      return this.executeCreateTable(sql, params) as U;
    } else if (trimmedSql.startsWith('insert into')) {
      return this.executeInsert(sql, params) as U;
    } else if (trimmedSql.startsWith('select')) {
      return this.executeSelect(sql, params) as U;
    } else if (trimmedSql.startsWith('update')) {
      return this.executeUpdate(sql, params) as U;
    } else if (trimmedSql.startsWith('delete')) {
      return this.executeDelete(sql, params) as U;
    } else if (trimmedSql.startsWith('alter table')) {
      return this.executeAlterTable(sql, params) as U;
    } else if (trimmedSql.startsWith('drop table')) {
      return this.executeDropTable(sql, params) as U;
    } else if (trimmedSql.startsWith('drop index')) {
      return this.executeDropIndex(sql, params) as U;
    } else if (trimmedSql.startsWith('create index')) {
      return this.executeCreateIndex(sql, params) as U;
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }

  // SQL generation methods
  mapColumnType(type: string): string {
    // 内存数据库不需要严格的类型映射，但保持一致性
    const typeMap: Record<string, string> = {
      'text': 'TEXT',
      'integer': 'INTEGER',
      'float': 'REAL',
      'boolean': 'BOOLEAN',
      'date': 'DATE',
      'json': 'JSON'
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
    return value ? 'true' : 'false';
  }
  
  formatDate(value: Date): string {
    return `'${value.toISOString()}'`;
  }
  
  formatJson(value: any): string {
    return `'${JSON.stringify(value)}'`;
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
    return `CREATE TABLE ${this.quoteIdentifier(tableName)} (${columns.join(', ')})`;
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

  // 私有方法：SQL 执行实现
  private executeCreateTable(sql: string, params?: any[]): any {
    // 解析 CREATE TABLE 语句
    const match = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?\s*\((.*)\)/i);
    if (!match) {
      throw new Error(`Invalid CREATE TABLE syntax: ${sql}`);
    }

    const tableName = match[1];
    const columnsStr = match[2];
    
    // 解析列定义
    const schema: Record<string, any> = {};
    const columnDefs = columnsStr.split(',').map(col => col.trim());
    
    for (const colDef of columnDefs) {
      const parts = colDef.split(/\s+/);
      const columnName = parts[0].replace(/"/g, '');
      const columnType = parts[1];
      
      schema[columnName] = {
        type: columnType,
        primary: colDef.toLowerCase().includes('primary key'),
        nullable: !colDef.toLowerCase().includes('not null'),
        unique: colDef.toLowerCase().includes('unique'),
        autoIncrement: colDef.toLowerCase().includes('auto_increment') || colDef.toLowerCase().includes('autoincrement')
      };
    }

    // 创建表
    const table: MemoryTable = {
      name: tableName,
      schema,
      data: [],
      indexes: new Map()
    };

    this.tables.set(tableName, table);
    this.autoIncrementCounters.set(tableName, new Map());

    return { affectedRows: 0 };
  }

  private executeInsert(sql: string, params: any[] = []): any {
    // 解析 INSERT 语句
    const match = sql.match(/INSERT INTO "?(\w+)"?\s*\((.*?)\)\s*VALUES\s*\((.*?)\)/i);
    if (!match) {
      throw new Error(`Invalid INSERT syntax: ${sql}`);
    }

    const tableName = match[1];
    const columnsStr = match[2];
    const valuesStr = match[3];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const columns = columnsStr.split(',').map(col => col.trim().replace(/"/g, ''));
    const values = params || this.parseValues(valuesStr);

    // 创建新记录
    const record: Record<string, any> = {};
    
    // 处理自增字段
    for (const [columnName, columnDef] of Object.entries(table.schema)) {
      if (columnDef.autoIncrement && columnDef.primary) {
        const counter = this.autoIncrementCounters.get(tableName)!;
        const currentId = counter.get(columnName) || 0;
        const nextId = currentId + 1;
        counter.set(columnName, nextId);
        record[columnName] = nextId;
      }
    }

    // 设置提供的值
    columns.forEach((col, index) => {
      if (index < values.length) {
        record[col] = values[index];
      }
    });

    // 设置默认值
    for (const [columnName, columnDef] of Object.entries(table.schema)) {
      if (!(columnName in record) && columnDef.default !== undefined) {
        record[columnName] = columnDef.default;
      }
    }

    table.data.push(record);

    return record;
  }

  private executeSelect(sql: string, params: any[] = []): any {
    // 简单的 SELECT 解析
    const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM\s+"?(\w+)"?/i);
    if (!selectMatch) {
      throw new Error(`Invalid SELECT syntax: ${sql}`);
    }

    const fieldsStr = selectMatch[1].trim();
    const tableName = selectMatch[2];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    let results = [...table.data];

    // 处理 WHERE 条件
    const whereMatch = sql.match(/WHERE\s+(.*?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|$)/i);
    if (whereMatch) {
      const whereClause = whereMatch[1].trim();
      results = this.applyWhereCondition(results, whereClause, params);
    }

    // 处理 ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(.*?)(?:\s+LIMIT|\s+OFFSET|$)/i);
    if (orderMatch) {
      const orderClause = orderMatch[1].trim();
      results = this.applyOrderBy(results, orderClause);
    }

    // 处理 LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
      results = results.slice(offset, offset + limit);
    }

    // 处理字段选择
    if (fieldsStr !== '*') {
      const fields = fieldsStr.split(',').map(f => f.trim().replace(/"/g, ''));
      results = results.map(row => {
        const newRow: Record<string, any> = {};
        fields.forEach(field => {
          if (field in row) {
            newRow[field] = row[field];
          }
        });
        return newRow;
      });
    }

    return results;
  }

  private executeUpdate(sql: string, params: any[] = []): any {
    // 解析 UPDATE 语句
    const match = sql.match(/UPDATE\s+"?(\w+)"?\s+SET\s+(.*?)(?:\s+WHERE\s+(.*?))?$/i);
    if (!match) {
      throw new Error(`Invalid UPDATE syntax: ${sql}`);
    }

    const tableName = match[1];
    const setClause = match[2];
    const whereClause = match[3];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    let results = [...table.data];

    // 应用 WHERE 条件
    if (whereClause) {
      results = this.applyWhereCondition(results, whereClause, params.slice(1));
    }

    // 解析 SET 子句
    const setPairs = setClause.split(',').map(pair => pair.trim());
    const updates: Record<string, any> = {};
    
    setPairs.forEach((pair, index) => {
      const [field, placeholder] = pair.split('=').map(p => p.trim());
      const fieldName = field.replace(/"/g, '');
      updates[fieldName] = params[index];
    });

    // 应用更新
    let affectedRows = 0;
    table.data.forEach(row => {
      if (results.includes(row)) {
        Object.assign(row, updates);
        affectedRows++;
      }
    });

    return { affectedRows };
  }

  private executeDelete(sql: string, params: any[] = []): any {
    // 解析 DELETE 语句
    const match = sql.match(/DELETE\s+FROM\s+"?(\w+)"?(?:\s+WHERE\s+(.*?))?$/i);
    if (!match) {
      throw new Error(`Invalid DELETE syntax: ${sql}`);
    }

    const tableName = match[1];
    const whereClause = match[2];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    let toDelete = [...table.data];

    // 应用 WHERE 条件
    if (whereClause) {
      toDelete = this.applyWhereCondition(toDelete, whereClause, params);
    }

    // 删除记录
    const affectedRows = toDelete.length;
    table.data = table.data.filter(row => !toDelete.includes(row));

    return { affectedRows };
  }

  private executeAlterTable(sql: string, params?: any[]): any {
    // 简单的 ALTER TABLE 实现
    const match = sql.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+(.*)/i);
    if (!match) {
      throw new Error(`Invalid ALTER TABLE syntax: ${sql}`);
    }

    const tableName = match[1];
    const alteration = match[2];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (alteration.toLowerCase().startsWith('add column')) {
      // 添加列的简单实现
      const columnMatch = alteration.match(/ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)/i);
      if (columnMatch) {
        const columnName = columnMatch[1];
        const columnType = columnMatch[2];
        table.schema[columnName] = { type: columnType, nullable: true };
        
        // 为现有记录添加默认值
        table.data.forEach(row => {
          row[columnName] = null;
        });
      }
    }

    return { affectedRows: 0 };
  }

  private executeDropTable(sql: string, params?: any[]): any {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
    if (!match) {
      throw new Error(`Invalid DROP TABLE syntax: ${sql}`);
    }

    const tableName = match[1];
    const ifExists = sql.toLowerCase().includes('if exists');
    
    const table = this.tables.get(tableName);
    if (!table) {
      if (ifExists) {
        return { affectedRows: 0 };
      } else {
        throw new Error(`Table ${tableName} does not exist`);
      }
    }

    this.tables.delete(tableName);
    this.autoIncrementCounters.delete(tableName);

    return { affectedRows: 0 };
  }

  private executeDropIndex(sql: string, params?: any[]): any {
    const match = sql.match(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?/i);
    if (!match) {
      throw new Error(`Invalid DROP INDEX syntax: ${sql}`);
    }

    const indexName = match[1];
    const tableName = match[2];
    const ifExists = sql.toLowerCase().includes('if exists');
    
    const table = this.tables.get(tableName);
    if (!table) {
      if (ifExists) {
        return { affectedRows: 0 };
      } else {
        throw new Error(`Table ${tableName} does not exist`);
      }
    }

    const indexExists = table.indexes.has(indexName);
    if (!indexExists) {
      if (ifExists) {
        return { affectedRows: 0 };
      } else {
        throw new Error(`Index ${indexName} does not exist on table ${tableName}`);
      }
    }

    table.indexes.delete(indexName);
    return { affectedRows: 0 };
  }

  private executeCreateIndex(sql: string, params?: any[]): any {
    const match = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?\s*\(([^)]+)\)/i);
    if (!match) {
      throw new Error(`Invalid CREATE INDEX syntax: ${sql}`);
    }

    const indexName = match[1];
    const tableName = match[2];
    const columnsStr = match[3];
    const unique = sql.toLowerCase().includes('unique');
    const ifNotExists = sql.toLowerCase().includes('if not exists');
    
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (table.indexes.has(indexName)) {
      if (ifNotExists) {
        return { affectedRows: 0 };
      } else {
        throw new Error(`Index ${indexName} already exists on table ${tableName}`);
      }
    }

    // 解析列名
    const columns = columnsStr.split(',').map(col => col.trim().replace(/"/g, ''));
    
    // 验证列是否存在
    for (const column of columns) {
      if (!(column in table.schema)) {
        throw new Error(`Column ${column} does not exist in table ${tableName}`);
      }
    }

    // 创建索引
    const indexMap = new Map<any, number[]>();
    
    // 为现有数据建立索引
    table.data.forEach((row, rowIndex) => {
      const key = columns.map(col => row[col]).join('|');
      if (!indexMap.has(key)) {
        indexMap.set(key, []);
      }
      indexMap.get(key)!.push(rowIndex);
    });

    table.indexes.set(indexName, { index: indexMap, columns, unique });
    return { affectedRows: 0 };
  }

  private parseValues(valuesStr: string): any[] {
    const values: any[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    
    for (let i = 0; i < valuesStr.length; i++) {
      const char = valuesStr[i];
      
      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar) {
        // 检查是否是转义字符
        if (i > 0 && valuesStr[i - 1] === '\\') {
          current += char;
        } else {
          inString = false;
          current += char;
        }
      } else if (!inString && char === '(') {
        parenDepth++;
        current += char;
      } else if (!inString && char === ')') {
        parenDepth--;
        current += char;
      } else if (!inString && char === ',' && parenDepth === 0) {
        values.push(this.parseValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      values.push(this.parseValue(current.trim()));
    }
    
    return values;
  }

  private parseValue(value: string): any {
    value = value.trim();
    
    // 参数占位符
    if (value === '?') return undefined;
    
    // NULL 值
    if (value.toUpperCase() === 'NULL') return null;
    
    // 布尔值
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // 字符串（单引号或双引号）
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      return this.unescapeString(value.slice(1, -1));
    }
    
    // 数字
    if (!isNaN(Number(value)) && value !== '') {
      return Number(value);
    }
    
    // JSON 对象
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    
    // JSON 数组
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    
    // 日期
    if (this.isDateString(value)) {
      return new Date(value);
    }
    
    return value;
  }

  private unescapeString(str: string): string {
    return str
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }

  private isDateString(str: string): boolean {
    // 简单的日期字符串检测
    const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
    return dateRegex.test(str) && !isNaN(Date.parse(str));
  }

  private applyWhereCondition(data: any[], whereClause: string, params: any[]): any[] {
    if (!whereClause.trim()) return data;
    
    try {
      const condition = this.parseWhereClause(whereClause, params);
      return data.filter(row => this.evaluateCondition(row, condition));
    } catch (error) {
      console.warn('WHERE clause parsing error:', error);
      return data;
    }
  }

  private parseWhereClause(whereClause: string, params: any[]): any {
    // 处理括号优先级
    const tokens = this.tokenizeWhereClause(whereClause);
    return this.parseLogicalExpression(tokens, params);
  }

  private tokenizeWhereClause(whereClause: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    
    for (let i = 0; i < whereClause.length; i++) {
      const char = whereClause[i];
      
      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar) {
        if (i > 0 && whereClause[i - 1] === '\\') {
          current += char;
        } else {
          inString = false;
          current += char;
        }
      } else if (!inString && char === '(') {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        tokens.push('(');
        parenDepth++;
      } else if (!inString && char === ')') {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        tokens.push(')');
        parenDepth--;
      } else if (!inString && /\s/.test(char)) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else if (!inString && /[=<>!]/.test(char)) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        current += char;
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      tokens.push(current.trim());
    }
    
    return tokens;
  }

  private parseLogicalExpression(tokens: string[], params: any[]): any {
    // 处理 AND 和 OR 操作符
    let result = this.parseComparisonExpression(tokens, params);
    
    while (tokens.length > 0) {
      const operator = tokens[0].toUpperCase();
      if (operator === 'AND' || operator === 'OR') {
        tokens.shift(); // 移除操作符
        const right = this.parseComparisonExpression(tokens, params);
        result = { type: 'logical', operator: operator.toLowerCase(), left: result, right };
      } else {
        break;
      }
    }
    
    return result;
  }

  private parseComparisonExpression(tokens: string[], params: any[]): any {
    // 处理括号
    if (tokens.length > 0 && tokens[0] === '(') {
      tokens.shift(); // 移除 '('
      const result = this.parseLogicalExpression(tokens, params);
      if (tokens.length > 0 && (tokens[0] as string) === ')') {
        tokens.shift(); // 移除 ')'
      }
      return result;
    }
    
    // 处理比较表达式
    if (tokens.length >= 3) {
      const field = tokens[0].replace(/"/g, '');
      const operator = tokens[1];
      let value = tokens[2];
      
      // 移除已处理的 tokens
      tokens.splice(0, 3);
      
      // 处理参数占位符
      if (value === '?') {
        value = params.shift();
      } else {
        value = this.parseValue(value);
      }
      
      return { type: 'comparison', field, operator, value };
    }
    
    throw new Error('Invalid comparison expression');
  }

  private evaluateCondition(row: any, condition: any): boolean {
    if (!condition) return true;
    
    switch (condition.type) {
      case 'logical':
        const left = this.evaluateCondition(row, condition.left);
        const right = this.evaluateCondition(row, condition.right);
        
        if (condition.operator === 'and') {
          return left && right;
        } else if (condition.operator === 'or') {
          return left || right;
        }
        return false;
        
      case 'comparison':
        return this.evaluateComparison(row[condition.field], condition.operator, condition.value);
        
      default:
        return true;
    }
  }

  private evaluateComparison(fieldValue: any, operator: string, value: any): boolean {
    switch (operator) {
      case '=':
        return fieldValue == value;
      case '!=':
      case '<>':
        return fieldValue != value;
      case '>':
        return fieldValue > value;
      case '>=':
        return fieldValue >= value;
      case '<':
        return fieldValue < value;
      case '<=':
        return fieldValue <= value;
      case 'LIKE':
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp(`^${pattern}$`, 'i').test(fieldValue);
        }
        return false;
      case 'NOT LIKE':
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
          return !new RegExp(`^${pattern}$`, 'i').test(fieldValue);
        }
        return true;
      case 'IN':
        if (Array.isArray(value)) {
          return value.includes(fieldValue);
        }
        return false;
      case 'NOT IN':
        if (Array.isArray(value)) {
          return !value.includes(fieldValue);
        }
        return true;
      case 'IS NULL':
        return fieldValue === null || fieldValue === undefined;
      case 'IS NOT NULL':
        return fieldValue !== null && fieldValue !== undefined;
      case 'BETWEEN':
        if (Array.isArray(value) && value.length === 2) {
          return fieldValue >= value[0] && fieldValue <= value[1];
        }
        return false;
      case 'NOT BETWEEN':
        if (Array.isArray(value) && value.length === 2) {
          return fieldValue < value[0] || fieldValue > value[1];
        }
        return true;
      default:
        return true;
    }
  }

  private applyOrderBy(data: any[], orderClause: string): any[] {
    const orderParts = orderClause.split(',').map(part => part.trim());
    
    return data.sort((a, b) => {
      for (const part of orderParts) {
        const match = part.match(/"?(\w+)"?\s*(ASC|DESC)?/i);
        if (!match) continue;
        
        const field = match[1];
        const direction = (match[2] || 'ASC').toUpperCase();
        
        const aVal = a[field];
        const bVal = b[field];
        
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        else if (aVal > bVal) comparison = 1;
        
        if (direction === 'DESC') comparison *= -1;
        
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }
}
Registry.register('memory', (config, schemas?: any) => {
  return new RelatedDatabase(new MemoryDialect(config), schemas);
});
