import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { ThenableQuery } from './thenable.js';
import { QueryParams, AlterDefinition, Condition, Ordering, Definition, AggregateField, AggregateFunction } from '../types.js';

export class Alteration<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<void,S,T, C, D> {
  constructor(
    database: Database<C, S, D>,
    private readonly tableName: T,
    private readonly alterations: AlterDefinition<S[T]>
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'alter',
      tableName: this.tableName,
      alterations: this.alterations
    };
  }
}

export class DroppingTable<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<number,S,T, C, D> {
  private conditions: Condition<S[T]> = {};
  
  constructor(
    database: Database<C, S, any>, 
    private readonly tableName: T
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'drop_table',
      tableName: this.tableName,
      conditions: this.conditions
    };
  }
}

export class DroppingIndex<S extends Record<string, object>, T extends keyof S,C = any, D = string> extends ThenableQuery<number,S,T, C, D> {
  private conditions: Condition<any> = {};
  
  constructor(
    database: Database<C, S, D>,
    private readonly indexName: string,
    private readonly tableName: T
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'drop_index',
      tableName: this.tableName,
      indexName: this.indexName,
      conditions: this.conditions
    };
  }
}

export class Creation<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<void,S,T, C, D> {
  constructor(
    database: Database<C, S, D>,
    private readonly tableName: T,
    private readonly definition: Definition<S[T]>
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'create',
      tableName: this.tableName,
      definition: this.definition
    };
  }
}

export class Selection<
  S extends Record<string, object>, T extends keyof S,
  K extends keyof S[T],
  C = any,
  D = string
> extends ThenableQuery<Pick<S[T], K>[],S,T, C, D> {
  private conditions: Condition<S[T]> = {};
  private groupings: (keyof S[T])[] = [];
  private orderings: Ordering<S[T]>[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  
  constructor(
    database: Database<C, S, D>,
    private readonly modelName: T,
    private readonly fields: Array<K>
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  groupBy(...fields: (keyof S[T])[]): this {
    this.groupings.push(...fields);
    return this;
  }
  
  orderBy(field: keyof S[T], direction: "ASC" | "DESC" = "ASC"): this {
    this.orderings.push({ field, direction });
    return this;
  }
  
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'select',
      tableName: this.modelName,
      fields: this.fields,
      conditions: this.conditions,
      groupings: this.groupings,
      orderings: this.orderings,
      limitCount: this.limitCount,
      offsetCount: this.offsetCount
    };
  }
}

export class Insertion<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<S[T], S, T, C, D> {
  constructor(
    database: Database<C, S, D>, 
    private readonly modelName: T, 
    private readonly data: S[T]
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'insert',
      tableName: this.modelName,
      data: this.data
    };
  }
}

export class Updation<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<number,S,T, C, D> {
  private conditions: Condition<S[T]> = {};
  
  constructor(
    database: Database<C, S, D>,
    private readonly modelName: T,
    private readonly update: Partial<S[T]>
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'update',
      tableName: this.modelName,
      update: this.update,
      conditions: this.conditions
    };
  }
}

export class Deletion<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<S[T][],S,T, C, D> {
  private conditions: Condition<S[T]> = {};
  
  constructor(
    database: Database<C, S, D>, 
    private readonly modelName: T
  ) {
    super(database, database.dialect);
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'delete',
      tableName: this.modelName,
      conditions: this.conditions
    };
  }
}

/**
 * 批量插入查询类
 */
export class BatchInsertion<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<{ affectedRows: number; insertIds?: (number | string)[] }, S, T, C, D> {
  constructor(
    database: Database<C, S, D>, 
    private readonly modelName: T, 
    private readonly data: S[T][]
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'insert_many',
      tableName: this.modelName,
      data: this.data
    };
  }
}

/**
 * 聚合查询结果类型
 */
export interface AggregateResult {
  [key: string]: number | string | null;
}

/**
 * 聚合查询类
 */
export class Aggregation<S extends Record<string, object>, T extends keyof S, C = any, D = string> extends ThenableQuery<AggregateResult[], S, T, C, D> {
  private conditions: Condition<S[T]> = {};
  private groupings: (keyof S[T])[] = [];
  private havingConditions: Condition<S[T]> = {};
  private aggregates: AggregateField<S[T]>[] = [];
  
  constructor(
    database: Database<C, S, D>,
    private readonly modelName: T
  ) {
    super(database, database.dialect as Dialect<C,S, D>);
  }
  
  /**
   * COUNT 聚合
   */
  count(field: keyof S[T] | '*' = '*', alias?: string): this {
    this.aggregates.push({ fn: 'count', field, alias: alias || `count_${String(field)}` });
    return this;
  }
  
  /**
   * SUM 聚合
   */
  sum(field: keyof S[T], alias?: string): this {
    this.aggregates.push({ fn: 'sum', field, alias: alias || `sum_${String(field)}` });
    return this;
  }
  
  /**
   * AVG 聚合
   */
  avg(field: keyof S[T], alias?: string): this {
    this.aggregates.push({ fn: 'avg', field, alias: alias || `avg_${String(field)}` });
    return this;
  }
  
  /**
   * MIN 聚合
   */
  min(field: keyof S[T], alias?: string): this {
    this.aggregates.push({ fn: 'min', field, alias: alias || `min_${String(field)}` });
    return this;
  }
  
  /**
   * MAX 聚合
   */
  max(field: keyof S[T], alias?: string): this {
    this.aggregates.push({ fn: 'max', field, alias: alias || `max_${String(field)}` });
    return this;
  }
  
  /**
   * WHERE 条件
   */
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  /**
   * GROUP BY
   */
  groupBy(...fields: (keyof S[T])[]): this {
    this.groupings.push(...fields);
    return this;
  }
  
  /**
   * HAVING 条件（用于聚合后的过滤）
   */
  having(query: Condition<S[T]>): this {
    this.havingConditions = { ...this.havingConditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<S,T> {
    return {
      type: 'aggregate',
      tableName: this.modelName,
      aggregates: this.aggregates,
      conditions: this.conditions,
      groupings: this.groupings,
      havingConditions: this.havingConditions
    };
  }
}
