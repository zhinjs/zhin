import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { ThenableQuery } from './thenable.js';
import { QueryParams, AlterDefinition, Condition, Ordering, Definition } from '../types.js';

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
