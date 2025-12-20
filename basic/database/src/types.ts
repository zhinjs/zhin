
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
// Condition Types
// ============================================================================

export interface ComparisonOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
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
