import { Database,Dialect,Model } from '../../base/index.js';
import { RelatedModel } from './model.js';
import {
  QueryParams,
  BuildQueryResult,
  CreateQueryParams,
  SelectQueryParams,
  InsertQueryParams,
  InsertManyQueryParams,
  UpdateQueryParams,
  DeleteQueryParams,
  AlterQueryParams,
  DropTableQueryParams,
  DropIndexQueryParams,
  AggregateQueryParams,
  Condition,
  Column,
  AddDefinition,
  ModifyDefinition,
  DropDefinition,
  Subquery,
  JoinClause,
  isCreateQuery,
  isSelectQuery,
  isInsertQuery,
  isInsertManyQuery,
  isUpdateQuery,
  isDeleteQuery,
  isAlterQuery,
  isDropTableQuery,
  isDropIndexQuery,
  isAggregateQuery,
} from '../../types.js';

/**
 * 判断是否为子查询对象
 */
function isSubquery(value: any): value is Subquery {
  return value && typeof value === 'object' && value.__isSubquery === true;
}

/**
 * 关系型数据库类
 * 支持表、行、列的关系型数据模型
 */
export class RelatedDatabase<
  D=any,
  S extends Record<string, object> = Record<string, object>
> extends Database<D,S,string> {
  
  constructor(
    dialect: Dialect<D,S,string>,
    definitions?: Database.DefinitionObj<S>,
  ) {
    super(dialect,definitions); 
  }

  protected async initialize(): Promise<void> {
    // 自动创建表
    for (const [tableName, definition] of Object.entries(this.definitions || {})) {
      await this.create(tableName, definition);
    }
  }

  // SQL generation method
  buildQuery<T extends keyof S>(params: QueryParams<S,T>): BuildQueryResult<string> {
    if (isCreateQuery(params)) {
      return this.buildCreateQuery(params);
    } else if (isSelectQuery(params)) {
      return this.buildSelectQuery(params);
    } else if (isInsertQuery(params)) {
      return this.buildInsertQuery(params);
    } else if (isInsertManyQuery(params)) {
      return this.buildInsertManyQuery(params);
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
    } else if (isAggregateQuery(params)) {
      return this.buildAggregateQuery(params);
    } else {
      throw new Error(`Unsupported query type: ${(params as any).type}`);
    }
  }
  
  // ========================================================================
  // CREATE TABLE Query
  // ========================================================================
  
  protected buildCreateQuery<T extends keyof S>(params: CreateQueryParams<S,T>): BuildQueryResult<string> {
    const columnDefs = Object.entries(params.definition).map(([field, column]) => this.formatColumnDefinition(field,column as Column));
    const query = this.dialect.formatCreateTable(params.tableName, columnDefs);
    return { query, params: [] };
  }
  
  // ========================================================================
  // SELECT Query
  // ========================================================================
  
  protected buildSelectQuery<T extends keyof S>(params: SelectQueryParams<S,T>): BuildQueryResult<string> {
    const tableName = String(params.tableName);
    const hasJoins = params.joins && params.joins.length > 0;
    
    // 构建字段列表（有 JOIN 时需要加表名前缀）
    const fields = params.fields && params.fields.length
      ? params.fields.map(f => {
          const fieldName = this.dialect.quoteIdentifier(String(f));
          return hasJoins 
            ? `${this.dialect.quoteIdentifier(tableName)}.${fieldName}`
            : fieldName;
        }).join(', ')
      : hasJoins ? `${this.dialect.quoteIdentifier(tableName)}.*` : '*';
    
    let query = `SELECT ${fields} FROM ${this.dialect.quoteIdentifier(tableName)}`;
    const queryParams: any[] = [];
    
    // JOIN clauses
    if (hasJoins) {
      for (const join of params.joins!) {
        query += ` ${this.formatJoinClause(tableName, join)}`;
      }
    }
    
    // WHERE clause
    if (params.conditions) {
      const [condition, conditionParams] = this.parseCondition(params.conditions, hasJoins ? tableName : undefined);
      if (condition) {
        query += ` WHERE ${condition}`;
        queryParams.push(...conditionParams);
      }
    }
    
    // GROUP BY clause
    if (params.groupings && params.groupings.length) {
      const groupings = params.groupings.map(f => {
        const fieldName = this.dialect.quoteIdentifier(String(f));
        return hasJoins 
          ? `${this.dialect.quoteIdentifier(tableName)}.${fieldName}`
          : fieldName;
      }).join(', ');
      query += ` GROUP BY ${groupings}`;
    }
    
    // ORDER BY clause
    if (params.orderings && params.orderings.length) {
      const orderings = params.orderings
        .map(o => {
          const fieldName = this.dialect.quoteIdentifier(String(o.field));
          const fullField = hasJoins 
            ? `${this.dialect.quoteIdentifier(tableName)}.${fieldName}`
            : fieldName;
          return `${fullField} ${o.direction}`;
        })
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
  
  /**
   * 格式化 JOIN 子句
   */
  protected formatJoinClause<T extends keyof S>(
    mainTable: string, 
    join: JoinClause<S, T, keyof S>
  ): string {
    const joinTable = this.dialect.quoteIdentifier(String(join.table));
    const leftField = `${this.dialect.quoteIdentifier(mainTable)}.${this.dialect.quoteIdentifier(String(join.leftField))}`;
    const rightField = `${joinTable}.${this.dialect.quoteIdentifier(String(join.rightField))}`;
    
    return `${join.type} JOIN ${joinTable} ON ${leftField} = ${rightField}`;
  }
  
  // ========================================================================
  // INSERT Query
  // ========================================================================
  
  protected buildInsertQuery<T extends keyof S>(params: InsertQueryParams<S,T>): BuildQueryResult<string> {
    const keys = Object.keys(params.data);
    const columns = keys.map(k => this.dialect.quoteIdentifier(k)).join(', ');
    const placeholders = keys.map((_, index) => this.dialect.getParameterPlaceholder(index)).join(', ');
    
    const query = `INSERT INTO ${this.dialect.quoteIdentifier(params.tableName)} (${columns}) VALUES (${placeholders})`;
    // 直接传值，不要格式化（参数化查询由驱动处理）
    const values = Object.values(params.data);
    
    return { query, params: values };
  }
  
  // ========================================================================
  // INSERT MANY Query (Batch Insert)
  // ========================================================================
  
  protected buildInsertManyQuery<T extends keyof S>(params: InsertManyQueryParams<S,T>): BuildQueryResult<string> {
    if (!params.data.length) {
      throw new Error('Cannot insert empty array');
    }
    
    const keys = Object.keys(params.data[0]);
    const columns = keys.map(k => this.dialect.quoteIdentifier(k)).join(', ');
    
    const allValues: any[] = [];
    const valueRows: string[] = [];
    
    params.data.forEach((row, rowIndex) => {
      const placeholders = keys.map((_, colIndex) => 
        this.dialect.getParameterPlaceholder(rowIndex * keys.length + colIndex)
      ).join(', ');
      valueRows.push(`(${placeholders})`);
      
      keys.forEach(key => {
        // 直接传值，不要格式化（参数化查询由驱动处理）
        allValues.push((row as any)[key]);
      });
    });
    
    const query = `INSERT INTO ${this.dialect.quoteIdentifier(params.tableName)} (${columns}) VALUES ${valueRows.join(', ')}`;
    
    return { query, params: allValues };
  }
  
  // ========================================================================
  // UPDATE Query
  // ========================================================================
  
  protected buildUpdateQuery<T extends keyof S>(params: UpdateQueryParams<S,T>): BuildQueryResult<string> {
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
  
  protected buildDeleteQuery<T extends keyof S>(params: DeleteQueryParams<S,T>): BuildQueryResult<string> {
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
  
  protected buildAlterQuery<T extends keyof S>(params: AlterQueryParams<S,T>): BuildQueryResult<string> {
    const alterations = Object.entries(params.alterations).map(([field,alteration]) => this.formatAlteration(field, alteration as AddDefinition<T> | ModifyDefinition<T> | DropDefinition));
    const query = this.dialect.formatAlterTable(params.tableName, alterations);
    return { query, params: [] };
  }
  
  // ========================================================================
  // DROP TABLE Query
  // ========================================================================
  
  protected buildDropTableQuery<T extends keyof S>(params: DropTableQueryParams<S,T>): BuildQueryResult<string> {
    const query = this.dialect.formatDropTable(params.tableName, true);
    return { query, params: [] };
  }
  
  // ========================================================================
  // DROP INDEX Query
  // ========================================================================
  
  protected buildDropIndexQuery<T extends keyof S>(params: DropIndexQueryParams<S,T>): BuildQueryResult<string> {
    const query = this.dialect.formatDropIndex(params.indexName, params.tableName, true);
    return { query, params: [] };
  }
  
  // ========================================================================
  // AGGREGATE Query
  // ========================================================================
  
  protected buildAggregateQuery<T extends keyof S>(params: AggregateQueryParams<S,T>): BuildQueryResult<string> {
    if (!params.aggregates.length) {
      throw new Error('At least one aggregate function is required');
    }
    
    // Build SELECT fields with aggregate functions
    const selectFields: string[] = [];
    
    // Add grouping fields to select
    if (params.groupings && params.groupings.length) {
      params.groupings.forEach(field => {
        selectFields.push(this.dialect.quoteIdentifier(String(field)));
      });
    }
    
    // Add aggregate functions
    params.aggregates.forEach(agg => {
      selectFields.push(this.dialect.formatAggregate(agg.fn, String(agg.field), agg.alias));
    });
    
    let query = `SELECT ${selectFields.join(', ')} FROM ${this.dialect.quoteIdentifier(params.tableName)}`;
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
    
    // HAVING clause
    if (params.havingConditions && Object.keys(params.havingConditions).length) {
      const [havingCondition, havingParams] = this.parseCondition(params.havingConditions);
      if (havingCondition) {
        query += ` HAVING ${havingCondition}`;
        queryParams.push(...havingParams);
      }
    }
    
    return { query, params: queryParams };
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

  protected formatAlteration<T=any>(field:string,alteration: AddDefinition<T> | ModifyDefinition<T> | DropDefinition): string {
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
  
  /**
   * 解析条件对象为 SQL WHERE 子句
   * @param condition 条件对象
   * @param tablePrefix 表名前缀（用于 JOIN 查询）
   */
  protected parseCondition<T extends object>(condition: Condition<T>, tablePrefix?: string): [string, any[]] {
    const clauses: string[] = [];
    const params: any[] = [];
    
    // 辅助函数：生成带前缀的字段名
    const formatField = (field: string): string => {
      const quotedField = this.dialect.quoteIdentifier(field);
      return tablePrefix 
        ? `${this.dialect.quoteIdentifier(tablePrefix)}.${quotedField}`
        : quotedField;
    };

    for (const key in condition) {
      if (key === '$and' && Array.isArray((condition as any).$and)) {
        const subClauses: string[] = [];
        for (const subCondition of (condition as any).$and) {
          const [subClause, subParams] = this.parseCondition(subCondition, tablePrefix);
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
          const [subClause, subParams] = this.parseCondition(subCondition, tablePrefix);
          if (subClause) {
            subClauses.push(`(${subClause})`);
            params.push(...subParams);
          }
        }
        if (subClauses.length) {
          clauses.push(subClauses.join(' OR '));
        }
      } else if (key === '$not' && (condition as any).$not) {
        const [subClause, subParams] = this.parseCondition((condition as any).$not, tablePrefix);
        if (subClause) {
          clauses.push(`NOT (${subClause})`);
          params.push(...subParams);
        }
      } else {
        const value = (condition as any)[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const op in value) {
            const quotedKey = formatField(key);
            const placeholder = this.dialect.getParameterPlaceholder(params.length);
            
            switch (op) {
              case '$eq':
                if (value[op] === null) {
                  clauses.push(`${quotedKey} IS NULL`);
                } else {
                  clauses.push(`${quotedKey} = ${placeholder}`);
                  params.push(value[op]);
                }
                break;
              case '$ne':
                if (value[op] === null) {
                  clauses.push(`${quotedKey} IS NOT NULL`);
                } else {
                  clauses.push(`${quotedKey} <> ${placeholder}`);
                  params.push(value[op]);
                }
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
                if (isSubquery(value[op])) {
                  // 子查询
                  const subquery = value[op].toSQL();
                  clauses.push(`${quotedKey} IN (${subquery.sql})`);
                  params.push(...subquery.params);
                } else if (Array.isArray(value[op]) && value[op].length) {
                  const placeholders = value[op].map((_: any, i: number) => this.dialect.getParameterPlaceholder(params.length + i));
                  clauses.push(`${quotedKey} IN (${placeholders.join(', ')})`);
                  params.push(...value[op]);
                } else {
                  clauses.push('1=0'); // Empty IN clause should yield no results
                }
                break;
              case '$nin':
                if (isSubquery(value[op])) {
                  // 子查询
                  const subquery = value[op].toSQL();
                  clauses.push(`${quotedKey} NOT IN (${subquery.sql})`);
                  params.push(...subquery.params);
                } else if (Array.isArray(value[op]) && value[op].length) {
                  const placeholders = value[op].map((_: any, i: number) => this.dialect.getParameterPlaceholder(params.length + i));
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
          const quotedKey = formatField(key);
          // null 值使用 IS NULL / IS NOT NULL
          if (value === null) {
            clauses.push(`${quotedKey} IS NULL`);
          } else {
            const placeholder = this.dialect.getParameterPlaceholder(params.length);
            clauses.push(`${quotedKey} = ${placeholder}`);
            params.push(value);
          }
        }
      }
    }

    return [clauses.join(' AND '), params];
  }

  /**
   * 获取模型
   * @param name 模型名称
   * @param options 可选的模型选项（如 softDelete, timestamps）
   */
  model<T extends keyof S>(name: T, options?: import('../../types.js').ModelOptions): RelatedModel<D,S,T> {
    // 如果有 options，每次都创建新的实例（因为选项可能不同）
    if (options) {
      return new RelatedModel(this, name, options);
    }
    // 无选项时使用缓存
    let model = this.models.get(name) as RelatedModel<D,S,T> | undefined;
    if (!model) {
      model = new RelatedModel(this, name);
      this.models.set(name, model as any);
    }
    return model as RelatedModel<D,S,T>;
  }

  /**
   * 获取所有模型名称
   */
  getModelNames(): string[] {
    return Object.keys(this.definitions || {});
  }
}
