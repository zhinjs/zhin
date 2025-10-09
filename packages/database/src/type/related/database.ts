import { Database,Dialect } from '../../base';
import { RelatedModel } from './model.js';
import {
  QueryParams,
  BuildQueryResult,
  CreateQueryParams,
  SelectQueryParams,
  InsertQueryParams,
  UpdateQueryParams,
  DeleteQueryParams,
  AlterQueryParams,
  DropTableQueryParams,
  DropIndexQueryParams,
  Condition,
  Column,
  AddSchema,
  ModifySchema,
  DropSchema,
  isCreateQuery,
  isSelectQuery,
  isInsertQuery,
  isUpdateQuery,
  isDeleteQuery,
  isAlterQuery,
  isDropTableQuery,
  isDropIndexQuery,
} from '../../types.js';

/**
 * 关系型数据库类
 * 支持表、行、列的关系型数据模型
 */
export class RelatedDatabase<
  D=any,
  S extends Record<string, object> = Record<string, object>
> extends Database<D,S,string> {
  
  constructor(
    dialect: Dialect<D,string>,
    schemas?: Database.Schemas<S>,
  ) {
    super(dialect,schemas); 
  }

  protected async initialize(): Promise<void> {
    // 自动创建表
    for (const [tableName, schema] of Object.entries(this.schemas || {})) {
      await this.create(tableName, schema);
    }
  }

  // SQL generation method
  buildQuery<U extends object = any>(params: QueryParams<U>): BuildQueryResult<string> {
    if (isCreateQuery(params)) {
      return this.buildCreateQuery(params);
    } else if (isSelectQuery(params)) {
      return this.buildSelectQuery(params);
    } else if (isInsertQuery(params)) {
      return this.buildInsertQuery(params);
    } else if (isUpdateQuery(params)) {
      return this.buildUpdateQuery(params);
    } else if (isDeleteQuery(params)) {
      return this.buildDeleteQuery(params);
    } else if (isAlterQuery(params)) {
      return this.buildAlterQuery(params);
    } else if (isDropTableQuery(params)) {
      return this.buildDropTableQuery(params);
    } else if (isDropIndexQuery(params)) {
      return this.buildDropIndexQuery(params);
    } else {
      throw new Error(`Unsupported query type: ${(params as any).type}`);
    }
  }
  
  // ========================================================================
  // CREATE TABLE Query
  // ========================================================================
  
  protected buildCreateQuery<T extends object>(params: CreateQueryParams<T>): BuildQueryResult<string> {
    const columnDefs = Object.entries(params.schema).map(([field, column]) => this.formatColumnDefinition(field,column as Column));
    const query = this.dialect.formatCreateTable(params.tableName, columnDefs);
    return { query, params: [] };
  }
  
  // ========================================================================
  // SELECT Query
  // ========================================================================
  
  protected buildSelectQuery<T extends object>(params: SelectQueryParams<T>): BuildQueryResult<string> {
    const fields = params.fields && params.fields.length
      ? params.fields.map(f => this.dialect.quoteIdentifier(String(f))).join(', ')
      : '*';
    
    let query = `SELECT ${fields} FROM ${this.dialect.quoteIdentifier(params.tableName)}`;
    const queryParams: any[] = [];
    
    // WHERE clause
    if (params.conditions) {
      const [condition, conditionParams] = this.parseCondition(params.conditions);
      if (condition) {
        query += ` WHERE ${condition}`;
        queryParams.push(...conditionParams);
      }
    }
    
    // GROUP BY clause
    if (params.groupings && params.groupings.length) {
      const groupings = params.groupings.map(f => this.dialect.quoteIdentifier(String(f))).join(', ');
      query += ` GROUP BY ${groupings}`;
    }
    
    // ORDER BY clause
    if (params.orderings && params.orderings.length) {
      const orderings = params.orderings
        .map(o => `${this.dialect.quoteIdentifier(String(o.field))} ${o.direction}`)
        .join(', ');
      query += ` ORDER BY ${orderings}`;
    }
    
    // LIMIT and OFFSET
    if (params.limitCount !== undefined && params.offsetCount !== undefined) {
      query += ` ${this.dialect.formatLimitOffset(params.limitCount, params.offsetCount)}`;
    } else if (params.limitCount !== undefined) {
      query += ` ${this.dialect.formatLimit(params.limitCount)}`;
    } else if (params.offsetCount !== undefined) {
      query += ` ${this.dialect.formatOffset(params.offsetCount)}`;
    }
    
    return { query, params: queryParams };
  }
  
  // ========================================================================
  // INSERT Query
  // ========================================================================
  
  protected buildInsertQuery<T extends object>(params: InsertQueryParams<T>): BuildQueryResult<string> {
    const keys = Object.keys(params.data);
    const columns = keys.map(k => this.dialect.quoteIdentifier(k)).join(', ');
    const placeholders = keys.map((_, index) => this.dialect.getParameterPlaceholder(index)).join(', ');
    
    const query = `INSERT INTO ${this.dialect.quoteIdentifier(params.tableName)} (${columns}) VALUES (${placeholders})`;
    const values = Object.values(params.data).map(v => this.dialect.formatDefaultValue(v));
    
    return { query, params: values };
  }
  
  // ========================================================================
  // UPDATE Query
  // ========================================================================
  
  protected buildUpdateQuery<T extends object>(params: UpdateQueryParams<T>): BuildQueryResult<string> {
    const updateKeys = Object.keys(params.update);
    const setClause = updateKeys
      .map((k, index) => `${this.dialect.quoteIdentifier(k)} = ${this.dialect.getParameterPlaceholder(index)}`)
      .join(', ');
    
    let query = `UPDATE ${this.dialect.quoteIdentifier(params.tableName)} SET ${setClause}`;
    const queryParams: any[] = [...Object.values(params.update)];
    
    // WHERE clause
    if (params.conditions) {
      const [condition, conditionParams] = this.parseCondition(params.conditions);
      if (condition) {
        query += ` WHERE ${condition}`;
        queryParams.push(...conditionParams);
      }
    }
    
    return { query, params: queryParams };
  }
  
  // ========================================================================
  // DELETE Query
  // ========================================================================
  
  protected buildDeleteQuery<T extends object>(params: DeleteQueryParams<T>): BuildQueryResult<string> {
    let query = `DELETE FROM ${this.dialect.quoteIdentifier(params.tableName)}`;
    const queryParams: any[] = [];
    
    // WHERE clause
    if (params.conditions) {
      const [condition, conditionParams] = this.parseCondition(params.conditions);
      if (condition) {
        query += ` WHERE ${condition}`;
        queryParams.push(...conditionParams);
      }
    }
    
    return { query, params: queryParams };
  }
  
  // ========================================================================
  // ALTER TABLE Query
  // ========================================================================
  
  protected buildAlterQuery<T extends object>(params: AlterQueryParams<T>): BuildQueryResult<string> {
    const alterations = Object.entries(params.alterations).map(([field,alteration]) => this.formatAlteration(field, alteration as AddSchema<T> | ModifySchema<T> | DropSchema));
    const query = this.dialect.formatAlterTable(params.tableName, alterations);
    return { query, params: [] };
  }
  
  // ========================================================================
  // DROP TABLE Query
  // ========================================================================
  
  protected buildDropTableQuery<T extends object>(params: DropTableQueryParams<T>): BuildQueryResult<string> {
    const query = this.dialect.formatDropTable(params.tableName, true);
    return { query, params: [] };
  }
  
  // ========================================================================
  // DROP INDEX Query
  // ========================================================================
  
  protected buildDropIndexQuery(params: DropIndexQueryParams): BuildQueryResult<string> {
    const query = this.dialect.formatDropIndex(params.indexName, params.tableName, true);
    return { query, params: [] };
  }
  
  // ========================================================================
  // Helper Methods
  // ========================================================================
  
  protected formatColumnDefinition<T =any>(field: string, column: Column<T>): string {
    const name = this.dialect.quoteIdentifier(String(field));
    const type = this.dialect.mapColumnType(column.type);
    const length = column.length ? `(${column.length})` : '';
    const nullable = column.nullable === false ? ' NOT NULL' : '';
    const primary = column.primary ? ' PRIMARY KEY' : '';
    const unique = column.unique ? ' UNIQUE' : '';
    const defaultVal = column.default !== undefined 
      ? ` DEFAULT ${this.dialect.formatDefaultValue(column.default)}` 
      : '';
    
    return `${name} ${type}${length}${primary}${unique}${nullable}${defaultVal}`;
  }
  
  protected formatAlteration<T=any>(field:string,alteration: AddSchema<T> | ModifySchema<T> | DropSchema): string {
    const name = this.dialect.quoteIdentifier(field);
    
    switch (alteration.action) {
      case 'add':
        // 将 alteration 转换为 Column 格式
        const addColumn: Column<T> = {
          type: alteration.type,
          nullable: alteration.nullable,
          default: alteration.default,
          primary: alteration.primary,
          length: alteration.length
        };
        return `ADD COLUMN ${this.formatColumnDefinition(field, addColumn)}`;
      case 'modify':
        const type = alteration.type ? this.dialect.mapColumnType(alteration.type) : '';
        const length = alteration.length ? `(${alteration.length})` : '';
        const nullable = alteration.nullable !== undefined 
          ? (alteration.nullable ? ' NULL' : ' NOT NULL') 
          : '';
        const defaultVal = alteration.default !== undefined 
          ? ` DEFAULT ${this.dialect.formatDefaultValue(alteration.default)}` 
          : '';
        return `MODIFY COLUMN ${name} ${type}${length}${nullable}${defaultVal}`;
      case 'drop':
        return `DROP COLUMN ${name}`;
      default:
        throw new Error(`Unsupported alteration action`);
    }
  }
  
  protected parseCondition<T extends object>(condition: Condition<T>): [string, any[]] {
    const clauses: string[] = [];
    const params: any[] = [];

    for (const key in condition) {
      if (key === '$and' && Array.isArray((condition as any).$and)) {
        const subClauses: string[] = [];
        for (const subCondition of (condition as any).$and) {
          const [subClause, subParams] = this.parseCondition(subCondition);
          if (subClause) {
            subClauses.push(`(${subClause})`);
            params.push(...subParams);
          }
        }
        if (subClauses.length) {
          clauses.push(subClauses.join(' AND '));
        }
      } else if (key === '$or' && Array.isArray((condition as any).$or)) {
        const subClauses: string[] = [];
        for (const subCondition of (condition as any).$or) {
          const [subClause, subParams] = this.parseCondition(subCondition);
          if (subClause) {
            subClauses.push(`(${subClause})`);
            params.push(...subParams);
          }
        }
        if (subClauses.length) {
          clauses.push(subClauses.join(' OR '));
        }
      } else if (key === '$not' && (condition as any).$not) {
        const [subClause, subParams] = this.parseCondition((condition as any).$not);
        if (subClause) {
          clauses.push(`NOT (${subClause})`);
          params.push(...subParams);
        }
      } else {
        const value = (condition as any)[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const op in value) {
            const quotedKey = this.dialect.quoteIdentifier(key);
            const placeholder = this.dialect.getParameterPlaceholder(params.length);
            
            switch (op) {
              case '$eq':
                clauses.push(`${quotedKey} = ${placeholder}`);
                params.push(value[op]);
                break;
              case '$ne':
                clauses.push(`${quotedKey} <> ${placeholder}`);
                params.push(value[op]);
                break;
              case '$gt':
                clauses.push(`${quotedKey} > ${placeholder}`);
                params.push(value[op]);
                break;
              case '$gte':
                clauses.push(`${quotedKey} >= ${placeholder}`);
                params.push(value[op]);
                break;
              case '$lt':
                clauses.push(`${quotedKey} < ${placeholder}`);
                params.push(value[op]);
                break;
              case '$lte':
                clauses.push(`${quotedKey} <= ${placeholder}`);
                params.push(value[op]);
                break;
              case '$in':
                if (Array.isArray(value[op]) && value[op].length) {
                  const placeholders = value[op].map(() => this.dialect.getParameterPlaceholder(params.length + value[op].indexOf(value[op])));
                  clauses.push(`${quotedKey} IN (${placeholders.join(', ')})`);
                  params.push(...value[op]);
                } else {
                  clauses.push('1=0'); // Empty IN clause should yield no results
                }
                break;
              case '$nin':
                if (Array.isArray(value[op]) && value[op].length) {
                  const placeholders = value[op].map(() => this.dialect.getParameterPlaceholder(params.length + value[op].indexOf(value[op])));
                  clauses.push(`${quotedKey} NOT IN (${placeholders.join(', ')})`);
                  params.push(...value[op]);
                }
                break;
              case '$like':
                clauses.push(`${quotedKey} LIKE ${placeholder}`);
                params.push(value[op]);
                break;
              case '$nlike':
                clauses.push(`${quotedKey} NOT LIKE ${placeholder}`);
                params.push(value[op]);
                break;
            }
          }
        } else {
          const quotedKey = this.dialect.quoteIdentifier(key);
          const placeholder = this.dialect.getParameterPlaceholder(params.length);
          clauses.push(`${quotedKey} = ${placeholder}`);
          params.push(value);
        }
      }
    }

    return [clauses.join(' AND '), params];
  }

  /**
   * 获取模型
   */
  model<T extends keyof S>(name: T): RelatedModel<S[T], Dialect<D,string>> {
    let model = this.models.get(name as string);
    if (!model) {
      model = new RelatedModel(this as unknown as RelatedDatabase<D>, name as string);
      this.models.set(name as string, model);
    }
    return model as unknown as RelatedModel<S[T], Dialect<D,string>>;
  }

  /**
   * 获取所有模型名称
   */
  getModelNames(): string[] {
    return Object.keys(this.schemas || {});
  }
}
