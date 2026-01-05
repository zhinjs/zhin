import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { ThenableQuery } from './thenable.js';
import { QueryParams, AlterDefinition, Condition, Ordering, Definition, AggregateField, AggregateFunction, Subquery, JoinClause, JoinType, ModelOptions } from '../types.js';

/** 软删除查询模式 */
export type SoftDeleteMode = 'default' | 'withTrashed' | 'onlyTrashed';

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

/**
 * SELECT 查询类
 * 实现 Subquery<S[T][K]> 以支持类型安全的子查询
 * 
 * @template S Schema 类型
 * @template T 表名
 * @template K 选择的字段
 * @template C 连接类型
 * @template D 方言类型
 * 
 * @example
 * ```ts
 * // 子查询类型推断示例
 * interface Schema {
 *   users: { id: number; name: string };
 *   orders: { id: number; userId: number; amount: number };
 * }
 * 
 * // ✅ 正确：userId 是 number，匹配 users.id
 * db.select('users', ['id']).where({
 *   id: { $in: db.select('orders', ['userId']) }
 * });
 * 
 * // ❌ 类型错误：name 是 string，不能与 number 的 id 匹配
 * db.select('users', ['id']).where({
 *   id: { $in: db.select('users', ['name']) }  // Type error!
 * });
 * ```
 */
export class Selection<
  S extends Record<string, object>, T extends keyof S,
  K extends keyof S[T],
  C = any,
  D = string
> extends ThenableQuery<Pick<S[T], K>[],S,T, C, D> implements Subquery<S[T][K]> {
  readonly __isSubquery = true as const;
  readonly __returnType?: S[T][K];
  
  protected conditions: Condition<S[T]> = {};
  protected groupings: (keyof S[T])[] = [];
  protected orderings: Ordering<S[T]>[] = [];
  protected limitCount?: number;
  protected offsetCount?: number;
  
  constructor(
    database: Database<C, S, D>,
    protected readonly modelName: T,
    protected readonly fields: Array<K>
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
  
  // ========================================================================
  // JOIN Methods - 返回带扩展类型的 JoinedSelection
  // ========================================================================
  
  /**
   * INNER JOIN - 只返回两表都有匹配的行
   * 返回类型扩展为包含关联表字段
   * 
   * @example
   * ```ts
   * const result = await db.select('users', ['id', 'name'])
   *   .join('orders', 'id', 'userId');
   * // result 类型: { users: { id, name }, orders: { id, userId, amount } }[]
   * ```
   */
  join<J extends keyof S>(
    table: J,
    leftField: keyof S[T],
    rightField: keyof S[J]
  ): JoinedSelection<S, T, K, J, C, D> {
    return new JoinedSelection<S, T, K, J, C, D>(
      this.database,
      this.modelName,
      this.fields,
      table,
      'INNER',
      leftField,
      rightField,
      this.conditions,
      this.orderings,
      this.groupings,
      this.limitCount,
      this.offsetCount
    );
  }
  
  /**
   * LEFT JOIN - 返回左表所有行，右表无匹配则为 NULL
   */
  leftJoin<J extends keyof S>(
    table: J,
    leftField: keyof S[T],
    rightField: keyof S[J]
  ): JoinedSelection<S, T, K, J, C, D, true> {
    return new JoinedSelection<S, T, K, J, C, D, true>(
      this.database,
      this.modelName,
      this.fields,
      table,
      'LEFT',
      leftField,
      rightField,
      this.conditions,
      this.orderings,
      this.groupings,
      this.limitCount,
      this.offsetCount
    );
  }
  
  /**
   * RIGHT JOIN - 返回右表所有行，左表无匹配则为 NULL
   */
  rightJoin<J extends keyof S>(
    table: J,
    leftField: keyof S[T],
    rightField: keyof S[J]
  ): JoinedSelection<S, T, K, J, C, D, false, true> {
    return new JoinedSelection<S, T, K, J, C, D, false, true>(
      this.database,
      this.modelName,
      this.fields,
      table,
      'RIGHT',
      leftField,
      rightField,
      this.conditions,
      this.orderings,
      this.groupings,
      this.limitCount,
      this.offsetCount
    );
  }
  
  /**
   * 转换为子查询 SQL
   * 用于 $in / $nin 等操作符中嵌套查询
   */
  toSQL(): { sql: string; params: any[] } {
    const { query, params } = this.database.buildQuery(this.getQueryParams());
    return { sql: String(query), params };
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

/**
 * JOIN 结果类型 - 根据表名命名空间化
 */
type JoinResult<
  S extends Record<string, object>,
  T extends keyof S,
  K extends keyof S[T],
  J extends keyof S,
  LeftNullable extends boolean = false,
  RightNullable extends boolean = false
> = {
  [P in T]: LeftNullable extends true ? Partial<Pick<S[T], K>> : Pick<S[T], K>;
} & {
  [P in J]: RightNullable extends true ? Partial<S[J]> | null : S[J];
};

/**
 * JOIN 查询类 - 支持类型安全的关联查询
 * 
 * @template S Schema 类型
 * @template T 主表名
 * @template K 主表选择的字段
 * @template J 关联表名
 * @template LeftNullable LEFT JOIN 时主表可能为 null
 * @template RightNullable RIGHT JOIN 时关联表可能为 null
 */
export class JoinedSelection<
  S extends Record<string, object>,
  T extends keyof S,
  K extends keyof S[T],
  J extends keyof S,
  C = any,
  D = string,
  LeftNullable extends boolean = false,
  RightNullable extends boolean = false
> extends ThenableQuery<JoinResult<S, T, K, J, LeftNullable, RightNullable>[], S, T, C, D> {
  
  private joinClauses: JoinClause<S, T, keyof S>[] = [];
  
  constructor(
    database: Database<C, S, D>,
    private readonly modelName: T,
    private readonly fields: Array<K>,
    joinTable: J,
    joinType: JoinType,
    leftField: keyof S[T],
    rightField: keyof S[J],
    private conditions: Condition<S[T]> = {},
    private orderings: Ordering<S[T]>[] = [],
    private groupings: (keyof S[T])[] = [],
    private limitCount?: number,
    private offsetCount?: number
  ) {
    super(database, database.dialect as Dialect<C, S, D>);
    this.joinClauses.push({
      type: joinType,
      table: joinTable,
      leftField,
      rightField: rightField as keyof S[keyof S]
    });
  }
  
  where(query: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...query };
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
  
  /**
   * 继续 JOIN 更多表
   */
  join<J2 extends keyof S>(
    table: J2,
    leftField: keyof S[T],
    rightField: keyof S[J2]
  ): this {
    this.joinClauses.push({
      type: 'INNER',
      table,
      leftField,
      rightField: rightField as keyof S[keyof S]
    });
    return this;
  }
  
  leftJoin<J2 extends keyof S>(
    table: J2,
    leftField: keyof S[T],
    rightField: keyof S[J2]
  ): this {
    this.joinClauses.push({
      type: 'LEFT',
      table,
      leftField,
      rightField: rightField as keyof S[keyof S]
    });
    return this;
  }
  
  rightJoin<J2 extends keyof S>(
    table: J2,
    leftField: keyof S[T],
    rightField: keyof S[J2]
  ): this {
    this.joinClauses.push({
      type: 'RIGHT',
      table,
      leftField,
      rightField: rightField as keyof S[keyof S]
    });
    return this;
  }
  
  protected getQueryParams(): QueryParams<S, T> {
    return {
      type: 'select',
      tableName: this.modelName,
      fields: this.fields,
      conditions: this.conditions,
      groupings: this.groupings,
      orderings: this.orderings,
      limitCount: this.limitCount,
      offsetCount: this.offsetCount,
      joins: this.joinClauses
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
  
  // 重写 then 方法来转换返回值
  then<TResult1 = { affectedRows: number; insertIds?: (number | string)[] }, TResult2 = never>(
    onfulfilled?: ((value: { affectedRows: number; insertIds?: (number | string)[] }) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    // 使用 database.query 以支持日志记录
    return this.database.query<any>(query, queryParams).then((result) => {
      // 转换不同数据库的返回格式
      const normalized = {
        affectedRows: result?.changes ?? result?.affectedRows ?? this.data.length,
        insertIds: result?.lastID ? [result.lastID] : result?.insertIds
      };
      return onfulfilled ? onfulfilled(normalized) : normalized as any;
    }, onrejected);
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
