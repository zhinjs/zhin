
export type QueryType = 
  | 'create' 
  | 'alter' 
  | 'drop_table' 
  | 'drop_index' 
  | 'select' 
  | 'insert'
  | 'insert_many'
  | 'update' 
  | 'delete'
  | 'aggregate';

// ============================================================================
// Aggregation Types
// ============================================================================

export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateField<T extends object> {
  fn: AggregateFunction;
  field: keyof T | '*';
  alias?: string;
}

// ============================================================================
// Column Type Definitions
// ============================================================================

export type ColumnType = 
  | "text" 
  | "integer" 
  | "float" 
  | "boolean" 
  | "date" 
  | "json";

export interface Column<T = any> {
  type: ColumnType;
  nullable?: boolean;
  default?: T;
  autoIncrement?: boolean;
  primary?: boolean;
  unique?: boolean;
  length?: number;
}

export type Definition<T extends object=object> = {
  [P in keyof T]: Column<T[P]>;
}

// ============================================================================
// Model Options
// ============================================================================

export interface ModelOptions {
  /** 启用软删除（需要表中有 deletedAt 字段） */
  softDelete?: boolean;
  /** 软删除字段名，默认 'deletedAt' */
  deletedAtField?: string;
  /** 启用自动时间戳（createdAt, updatedAt） */
  timestamps?: boolean;
  /** createdAt 字段名，默认 'createdAt' */
  createdAtField?: string;
  /** updatedAt 字段名，默认 'updatedAt' */
  updatedAtField?: string;
}

// ============================================================================
// Lifecycle Hooks Types
// ============================================================================

/**
 * 生命周期钩子上下文
 * 包含当前操作的相关信息
 */
export interface HookContext<T extends object = object> {
  /** 模型名称 */
  modelName: string;
  /** 当前操作的数据（create/update 时） */
  data?: Partial<T>;
  /** 查询条件（find/update/delete 时） */
  where?: Condition<T>;
  /** 操作结果（after 钩子时） */
  result?: T | T[] | number;
}

/**
 * 钩子函数类型
 * 返回 false 可以取消操作（仅 before 钩子）
 */
export type HookFn<T extends object = object> = (
  context: HookContext<T>
) => void | boolean | Promise<void | boolean>;

/**
 * 生命周期钩子名称
 */
export type HookName = 
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeFind'
  | 'afterFind';

/**
 * 钩子配置
 */
export type HooksConfig<T extends object = object> = {
  [K in HookName]?: HookFn<T> | HookFn<T>[];
};

// ============================================================================
// Column Alteration Types
// ============================================================================

export interface AddDefinition<T = any> {
  action: "add";
  type: ColumnType;
  nullable?: boolean;
  default?: T;
  primary?: boolean;
  length?: number;
}

export interface ModifyDefinition<T = any> {
  action: "modify";
  type?: ColumnType;
  nullable?: boolean;
  default?: T;
  length?: number;
}

export interface DropDefinition {
  action: "drop";
}

export type AlterDefinition<T extends object> = {
  [P in keyof T]?: AddDefinition<T[P]> | ModifyDefinition<T[P]> | DropDefinition
};

// ============================================================================
// Subquery Types
// ============================================================================

/**
 * 子查询标识接口
 * @template T 子查询返回的字段类型
 */
export interface Subquery<T = any> {
  readonly __isSubquery: true;
  /** 子查询返回值类型标记（仅用于类型推断，运行时不存在） */
  readonly __returnType?: T;
  toSQL(): { sql: string; params: any[] };
}

// ============================================================================
// Condition Types
// ============================================================================

export interface ComparisonOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  /** 值在数组中或子查询结果中 */
  $in?: T[] | Subquery<T>;
  /** 值不在数组中或子查询结果中 */
  $nin?: T[] | Subquery<T>;
  $like?: string;
  $nlike?: string;
}

export interface LogicOperators<T = any> {
  $and?: Condition<T>[];
  $or?: Condition<T>[];
  $not?: Condition<T>;
}

export type Condition<T = object> ={
  [P in keyof T]?: T[P] | ComparisonOperators<T[P]> | LogicOperators<T[P]>;
}|LogicOperators<T>;

// ============================================================================
// Ordering Types
// ============================================================================

export type SortDirection = "ASC" | "DESC";

export interface Ordering<T extends object> {
  field: keyof T;
  direction: SortDirection;
}

// ============================================================================
// JOIN Types
// ============================================================================

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

/**
 * JOIN 子句定义
 * @template S Schema 类型
 * @template T 主表
 * @template J 关联表
 */
export interface JoinClause<
  S extends Record<string, object>,
  T extends keyof S,
  J extends keyof S
> {
  /** JOIN 类型 */
  type: JoinType;
  /** 关联表名 */
  table: J;
  /** 主表字段 */
  leftField: keyof S[T];
  /** 关联表字段 */
  rightField: keyof S[J];
  /** 表别名（可选） */
  alias?: string;
}

// ============================================================================
// Query Parameter Types (Discriminated Union)
// ============================================================================

export interface BaseQueryParams<S extends Record<string, object> = Record<string, object>, T extends keyof S = keyof S>  {
  tableName: T;
}

export interface CreateQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'create';
  definition: Definition<S[T]>;
}

export interface AlterQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'alter';
  alterations: AlterDefinition<S[T]>;
}

export interface DropTableQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'drop_table';
  conditions?: Condition<S[T]>;
}

export interface DropIndexQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'drop_index';
  indexName: string;
  conditions?: Condition<any>;
}

export interface SelectQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'select';
  fields?: (keyof S[T])[];
  conditions?: Condition<S[T]>;
  groupings?: (keyof S[T])[];
  orderings?: Ordering<S[T]>[];
  limitCount?: number;
  offsetCount?: number;
  /** JOIN 子句列表 */
  joins?: JoinClause<S, T, keyof S>[];
}

export interface InsertQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'insert';
  data: S[T];
}

export interface InsertManyQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'insert_many';
  data: S[T][];
}

export interface UpdateQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'update';
  update: Partial<S[T]>;
  conditions?: Condition<S[T]>;
}

export interface DeleteQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'delete';
  conditions?: Condition<S[T]>;
}

export interface AggregateQueryParams<S extends Record<string, object>, T extends keyof S> extends BaseQueryParams<S,T> {
  type: 'aggregate';
  aggregates: AggregateField<S[T]>[];
  conditions?: Condition<S[T]>;
  groupings?: (keyof S[T])[];
  havingConditions?: Condition<S[T]>;
}

export type QueryParams<S extends Record<string, object>,T extends keyof S> = 
  | CreateQueryParams<S,T>
  | AlterQueryParams<S,T>
  | DropTableQueryParams<S,T>
  | DropIndexQueryParams<S,T>
  | SelectQueryParams<S,T>
  | InsertQueryParams<S,T>
  | InsertManyQueryParams<S,T>
  | UpdateQueryParams<S,T>
  | DeleteQueryParams<S,T>
  | AggregateQueryParams<S,T>;

// ============================================================================
// Query Result Types
// ============================================================================

export interface BuildQueryResult<R> {
  query: R;
  params: any[];
}

// ============================================================================
// NoSQL Query Result Types
// ============================================================================

/**
 * 文档查询结果类型
 */
export interface DocumentQueryResult {
  collection: string;
  filter: Record<string, any>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 1 | 0>;
  operation?: 'find' | 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'createCollection' | 'createIndex' | 'dropIndex' | 'dropCollection';
}

/**
 * 键值查询结果类型
 */
export interface KeyValueQueryResult {
  bucket: string;
  operation: 'get' | 'set' | 'delete' | 'has' | 'keys' | 'values' | 'entries' | 'clear' | 'size' | 'expire' | 'ttl' | 'persist' | 'cleanup' | 'keysByPattern';
  key?: string;
  value?: any;
  ttl?: number;
  pattern?: string;
  keys?: string[];
}

/**
 * 文档操作结果类型
 */
export interface DocumentOperationResult<T = any> {
  success: boolean;
  data?: T | T[];
  count?: number;
  error?: string;
}

/**
 * 键值操作结果类型
 */
export interface KeyValueOperationResult<T = any> {
  success: boolean;
  data?: T | T[] | number | boolean;
  error?: string;
}

/**
 * 数据库方言信息接口
 */
export interface DatabaseDialect {
  name: string;
  version: string;
  features: string[];
  dataTypes: Record<string, string>;
  identifierQuote: string;
  parameterPlaceholder: string;
  supportsTransactions: boolean;
  supportsIndexes: boolean;
  supportsForeignKeys: boolean;
  supportsViews: boolean;
  supportsStoredProcedures: boolean;
}

export interface SelectResult<T> {
  rows: T[];
  count?: number;
}

export interface InsertResult<T = any> {
  insertId?: number | string;
  affectedRows?: number;
  data?: T;
}

export interface UpdateResult {
  affectedRows: number;
}

export interface DeleteResult {
  affectedRows: number;
}

// ============================================================================
// Driver Configuration Types
// ============================================================================

export interface BaseDriverConfig {
  timeout?: number;
  retries?: number;
}




// ============================================================================
// Driver Interface Types
// ============================================================================

export interface DriverConnection {
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Transaction Types
// ============================================================================

export type IsolationLevel = 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  timeout?: number;
}

export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<T>;
}

/**
 * 增强的事务接口，支持链式调用
 */
export interface TransactionContext<S extends Record<string, object> = Record<string, object>> extends Transaction {
  /**
   * 插入单条数据
   */
  insert<T extends keyof S>(tableName: T, data: S[T]): Promise<S[T]>;
  
  /**
   * 批量插入数据
   */
  insertMany<T extends keyof S>(tableName: T, data: S[T][]): Promise<{ affectedRows: number }>;
  
  /**
   * 查询数据
   */
  select<T extends keyof S>(tableName: T, fields?: (keyof S[T])[]): TransactionSelection<S, T>;
  
  /**
   * 更新数据
   */
  update<T extends keyof S>(tableName: T, data: Partial<S[T]>): TransactionUpdation<S, T>;
  
  /**
   * 删除数据
   */
  delete<T extends keyof S>(tableName: T): TransactionDeletion<S, T>;
}

/**
 * 事务查询选择器
 */
export interface TransactionSelection<S extends Record<string, object>, T extends keyof S> {
  where(condition: Condition<S[T]>): this;
  orderBy(field: keyof S[T], direction?: 'ASC' | 'DESC'): this;
  limit(count: number): this;
  offset(count: number): this;
  then<R>(onfulfilled?: (value: S[T][]) => R | PromiseLike<R>): Promise<R>;
}

/**
 * 事务更新器
 */
export interface TransactionUpdation<S extends Record<string, object>, T extends keyof S> {
  where(condition: Condition<S[T]>): this;
  then<R>(onfulfilled?: (value: number) => R | PromiseLike<R>): Promise<R>;
}

/**
 * 事务删除器
 */
export interface TransactionDeletion<S extends Record<string, object>, T extends keyof S> {
  where(condition: Condition<S[T]>): this;
  then<R>(onfulfilled?: (value: number) => R | PromiseLike<R>): Promise<R>;
}

// ============================================================================
// Connection Pool Types
// ============================================================================

export interface PoolConfig {
  min?: number;
  max?: number;
  acquireTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

export interface DriverQuery {
  query<T = any>(sql: string, params?: any[]): Promise<T>;
}

export interface DriverSchema {
  getTables(): Promise<string[]>;
  getTableInfo(tableName: string): Promise<TableInfo[]>;
}

export interface DriverQueryBuilder<R> {
  buildQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): BuildQueryResult<R>;
}

export interface DriverLifecycle {
  dispose(): Promise<void>;
}

export interface TableInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: any;
  primaryKey: boolean;
  unique: boolean;
  length?: number;
}

// ============================================================================
// Model Types
// ============================================================================

export interface ModelField {
  type: 
    | "string"
    | "integer" 
    | "number"
    | "float"
    | "json"
    | "boolean"
    | "date"
    | "object"
    | "array";
  initial?: any;
  length?: number;
  primary?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  notNull?: boolean;
}

export interface ModelConfig {
  driver?: string;
  timestamps?: boolean;
  softDelete?: boolean;
  relations?: ModelRelation[];
}

export interface ModelRelation {
  model: string;
  type: "belongs-to" | "has-one" | "has-many" | "many-to-many";
  foreignKey?: string;
  through?: string;
}

// ============================================================================
// Utility Types
// ========================================

export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

// ============================================================================
// Type Guards
// ============================================================================

export function isCreateQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is CreateQueryParams<S, T> {
  return params.type === 'create';
}

export function isAlterQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is AlterQueryParams<S, T> {
  return params.type === 'alter';
}

export function isSelectQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is SelectQueryParams<S, T> {
  return params.type === 'select';
}

export function isInsertQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is InsertQueryParams<S, T> {
  return params.type === 'insert';
}

export function isUpdateQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is UpdateQueryParams<S, T> {
  return params.type === 'update';
}

export function isDeleteQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is DeleteQueryParams<S, T> {
  return params.type === 'delete';
}

export function isDropTableQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is DropTableQueryParams<S, T> {
  return params.type === 'drop_table';
}

export function isDropIndexQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is DropIndexQueryParams<S,T> {
  return params.type === 'drop_index';
}

export function isInsertManyQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is InsertManyQueryParams<S, T> {
  return params.type === 'insert_many';
}

export function isAggregateQuery<S extends Record<string, object>, T extends keyof S>(params: QueryParams<S, T>): params is AggregateQueryParams<S, T> {
  return params.type === 'aggregate';
}

// ============================================================================
// Relations Types
// ============================================================================

/**
 * 关联关系类型
 */
export type RelationType = 'hasOne' | 'hasMany' | 'belongsTo' | 'belongsToMany';

/**
 * Schema 中的关系声明
 * 
 * @example
 * ```ts
 * interface MySchema {
 *   users: {
 *     id: number;
 *     name: string;
 *     $hasMany: { orders: 'userId' };
 *     $hasOne: { profile: 'userId' };
 *   };
 *   orders: {
 *     id: number;
 *     userId: number;
 *     $belongsTo: { users: 'userId' };
 *   };
 * }
 * ```
 */
export interface SchemaRelations<S extends Record<string, object>> {
  /** 一对多关系: { 目标表名: '外键字段' } */
  $hasMany?: { [K in keyof S]?: string };
  /** 一对一关系: { 目标表名: '外键字段' } */
  $hasOne?: { [K in keyof S]?: string };
  /** 多对一关系: { 目标表名: '本表外键字段' } */
  $belongsTo?: { [K in keyof S]?: string };
}

/**
 * 从 Schema 表定义中提取纯数据字段（排除关系声明）
 */
export type SchemaFields<T> = Omit<T, '$hasMany' | '$hasOne' | '$belongsTo'>;

/**
 * 关联关系定义
 */
export interface RelationDefinition<
  S extends Record<string, object>,
  From extends keyof S,
  To extends keyof S
> {
  /** 关联类型 */
  type: RelationType;
  /** 目标表名 */
  target: To;
  /** 本表外键字段 */
  foreignKey: keyof S[From] | keyof S[To];
  /** 目标表主键字段（默认 'id'） */
  targetKey?: keyof S[To];
  /** 本表主键字段（默认 'id'） */
  localKey?: keyof S[From];
  /** 中间表配置（仅 belongsToMany） */
  pivot?: PivotConfig;
}

/**
 * 中间表（Pivot Table）配置
 * 用于多对多关系
 */
export interface PivotConfig {
  /** 中间表名 */
  table: string;
  /** 中间表中指向源表的外键 */
  foreignPivotKey: string;
  /** 中间表中指向目标表的外键 */
  relatedPivotKey: string;
  /** 中间表额外字段（可选） */
  pivotFields?: string[];
  /** 是否包含时间戳 */
  timestamps?: boolean;
}

/**
 * 带关联数据的结果类型
 */
export type WithRelation<
  T extends object,
  RelName extends string,
  RelType extends 'hasOne' | 'belongsTo' | 'hasMany' | 'belongsToMany',
  RelData extends object
> = T & {
  [K in RelName]: RelType extends ('hasMany' | 'belongsToMany') ? RelData[] : RelData | null;
};

/**
 * 带中间表数据的关联结果
 */
export type WithPivot<T extends object, PivotData extends object = Record<string, any>> = T & {
  pivot: PivotData;
};

/**
 * 关联查询选项
 */
export interface RelationQueryOptions<S extends Record<string, object>, T extends keyof S> {
  /** 要加载的关联名称 */
  relations?: string[];
  /** 关联数据的筛选条件 */
  where?: Condition<S[T]>;
}

/**
 * 关系配置中的外键字段类型
 * 表名是强类型的，字段名是 string（运行时验证）
 */
export type RelationForeignKey = string;

/**
 * hasMany 关系配置：{ 目标表名: 外键字段名 }
 */
export type HasManyConfig<S extends Record<string, object>> = {
  [K in Extract<keyof S, string>]?: RelationForeignKey;
};

/**
 * hasOne 关系配置：{ 目标表名: 外键字段名 }
 */
export type HasOneConfig<S extends Record<string, object>> = {
  [K in Extract<keyof S, string>]?: RelationForeignKey;
};

/**
 * belongsTo 关系配置：{ 目标表名: 本表外键字段名 }
 */
export type BelongsToConfig<S extends Record<string, object>> = {
  [K in Extract<keyof S, string>]?: RelationForeignKey;
};

/**
 * belongsToMany 关系配置
 * { 目标表名: { pivot: 中间表名, foreignKey: 源外键, relatedKey: 目标外键, pivotFields?: 额外字段 } }
 */
export interface BelongsToManyRelationConfig {
  /** 中间表名 */
  pivot: string;
  /** 中间表中指向源表的外键 */
  foreignKey: string;
  /** 中间表中指向目标表的外键 */
  relatedKey: string;
  /** 要获取的中间表额外字段 */
  pivotFields?: string[];
}

export type BelongsToManyConfig<S extends Record<string, object>> = {
  [K in Extract<keyof S, string>]?: BelongsToManyRelationConfig;
};

/**
 * 单个表的关系配置
 */
export interface TableRelationsConfig<S extends Record<string, object>> {
  hasMany?: HasManyConfig<S>;
  hasOne?: HasOneConfig<S>;
  belongsTo?: BelongsToConfig<S>;
  belongsToMany?: BelongsToManyConfig<S>;
}

/**
 * 关系配置对象（用于 Database 构造）
 * 
 * 表名是强类型的（必须是 Schema 中定义的表），
 * 字段名是字符串（在运行时通过模型方法验证）
 * 
 * @example
 * ```ts
 * interface Schema {
 *   users: { id: number; name: string };
 *   orders: { id: number; userId: number };
 * }
 * 
 * db.defineRelations({
 *   users: {
 *     hasMany: { orders: 'userId' }  // ✅ 'orders' 是有效表名
 *   },
 *   orders: {
 *     belongsTo: { users: 'userId' } // ✅ 'users' 是有效表名
 *   },
 *   // wrongTable: {}  // ❌ 类型错误：'wrongTable' 不在 Schema 中
 * });
 * ```
 */
export type RelationsConfig<S extends Record<string, object>> = {
  [T in Extract<keyof S, string>]?: TableRelationsConfig<S>;
};

// ============================================================================
// Migration Types
// ============================================================================

/**
 * 迁移上下文 - 提供迁移操作所需的数据库方法
 */
export interface MigrationContext {
  /** 创建表 */
  createTable(tableName: string, columns: Record<string, Column>): Promise<void>;
  /** 删除表 */
  dropTable(tableName: string): Promise<void>;
  /** 添加列 */
  addColumn(tableName: string, columnName: string, column: Column): Promise<void>;
  /** 删除列 */
  dropColumn(tableName: string, columnName: string): Promise<void>;
  /** 修改列 */
  modifyColumn(tableName: string, columnName: string, column: Column): Promise<void>;
  /** 重命名列 */
  renameColumn(tableName: string, oldName: string, newName: string): Promise<void>;
  /** 添加索引 */
  addIndex(tableName: string, indexName: string, columns: string[], unique?: boolean): Promise<void>;
  /** 删除索引 */
  dropIndex(tableName: string, indexName: string): Promise<void>;
  /** 执行原生 SQL */
  query<T = any>(sql: string, params?: any[]): Promise<T>;
}

/**
 * 迁移定义
 */
/**
 * 迁移操作记录（用于自动生成 down）
 */
export type MigrationOperation = 
  | { type: 'createTable'; tableName: string; columns: Record<string, Column> }
  | { type: 'dropTable'; tableName: string }
  | { type: 'addColumn'; tableName: string; columnName: string; column: Column }
  | { type: 'dropColumn'; tableName: string; columnName: string }
  | { type: 'addIndex'; tableName: string; indexName: string; columns: string[]; unique?: boolean }
  | { type: 'dropIndex'; tableName: string; indexName: string }
  | { type: 'renameColumn'; tableName: string; oldName: string; newName: string }
  | { type: 'query'; sql: string; params?: any[] };

export interface Migration {
  /** 迁移名称（唯一标识） */
  name: string;
  /** 迁移版本（时间戳或序号） */
  version?: string | number;
  /** 升级操作 */
  up(context: MigrationContext): Promise<void>;
  /** 
   * 降级操作（可选）
   * 如果不提供，将自动根据 up 操作生成反向操作
   */
  down?(context: MigrationContext): Promise<void>;
}

/**
 * 迁移记录（存储在数据库中）
 */
export interface MigrationRecord {
  id: number;
  name: string;
  batch: number;
  executedAt: Date;
}

/**
 * 迁移状态
 */
export interface MigrationStatus {
  name: string;
  status: 'pending' | 'executed';
  batch?: number;
  executedAt?: Date;
}

/**
 * 迁移运行器配置
 */
export interface MigrationRunnerConfig {
  /** 迁移记录表名 */
  tableName?: string;
  /** 迁移文件目录 */
  migrationsPath?: string;
}
