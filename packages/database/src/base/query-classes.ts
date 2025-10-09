import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { ThenableQuery } from './thenable.js';
import { QueryParams, AlterSchema, Condition, Ordering, Schema } from '../types.js';

export class Alteration<T extends object, C = any, D = string> extends ThenableQuery<void, C, D> {
  constructor(
    database: Database<C, Record<string, object>, D>,
    private readonly tableName: string,
    private readonly alterations: AlterSchema<T>
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'alter',
      tableName: this.tableName,
      alterations: this.alterations
    };
  }
}

export class DroppingTable<T extends object = any, C = any, D = string> extends ThenableQuery<number, C, D> {
  private conditions: Condition<T> = {};
  
  constructor(
    database: Database<C, Record<string, object>, any>, 
    private readonly tableName: string
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  where(query: Condition<T>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'drop_table',
      tableName: this.tableName,
      conditions: this.conditions
    };
  }
}

export class DroppingIndex<C = any, D = string> extends ThenableQuery<number, C, D> {
  private conditions: Condition<any> = {};
  
  constructor(
    database: Database<C, Record<string, object>, D>,
    private readonly indexName: string,
    private readonly tableName: string
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  where(query: Condition<any>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<any> {
    return {
      type: 'drop_index',
      tableName: this.tableName,
      indexName: this.indexName,
      conditions: this.conditions
    };
  }
}

export class Creation<T extends object, C = any, D = string> extends ThenableQuery<void, C, D> {
  constructor(
    database: Database<C, Record<string, object>, D>,
    private readonly tableName: string,
    private readonly schema: Schema<T>
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'create',
      tableName: this.tableName,
      schema: this.schema
    };
  }
}

export class Selection<
  T extends object,
  K extends keyof T,
  C = any,
  D = string
> extends ThenableQuery<Pick<T, K>[], C, D> {
  private conditions: Condition<T> = {};
  private groupings: (keyof T)[] = [];
  private orderings: Ordering<T>[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  
  constructor(
    database: Database<C, Record<string, object>, D>,
    private readonly modelName: string,
    private readonly fields: Array<K>
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  where(query: Condition<T>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  groupBy(...fields: (keyof T)[]): this {
    this.groupings.push(...fields);
    return this;
  }
  
  orderBy(field: keyof T, direction: "ASC" | "DESC" = "ASC"): this {
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
  
  protected getQueryParams(): QueryParams<T> {
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

export class Insertion<T extends object, C = any, D = string> extends ThenableQuery<T, C, D> {
  constructor(
    database: Database<C, Record<string, object>, D>, 
    private readonly modelName: string, 
    private readonly data: T
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'insert',
      tableName: this.modelName,
      data: this.data
    };
  }
}

export class Updation<T extends object, C = any, D = string> extends ThenableQuery<number, C, D> {
  private conditions: Condition<T> = {};
  
  constructor(
    database: Database<C, Record<string, object>, D>,
    private readonly modelName: string,
    private readonly update: Partial<T>
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  where(query: Condition<T>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'update',
      tableName: this.modelName,
      update: this.update,
      conditions: this.conditions
    };
  }
}

export class Deletion<T extends object = any, C = any, D = string> extends ThenableQuery<number, C, D> {
  private conditions: Condition<T> = {};
  
  constructor(
    database: Database<C, Record<string, object>, D>, 
    private readonly modelName: string
  ) {
    super(database, database.dialect as Dialect<C, D>);
  }
  
  where(query: Condition<T>): this {
    this.conditions = { ...this.conditions, ...query };
    return this;
  }
  
  protected getQueryParams(): QueryParams<T> {
    return {
      type: 'delete',
      tableName: this.modelName,
      conditions: this.conditions
    };
  }
}
