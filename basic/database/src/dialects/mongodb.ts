import {Database, Dialect} from '../base/index.js';
import {
  AlterQueryParams,
  BuildQueryResult,
  CreateQueryParams, DatabaseDialect, DeleteQueryParams,
  DocumentQueryResult, DropIndexQueryParams, DropTableQueryParams, InsertQueryParams,
  QueryParams,
  SelectQueryParams, UpdateQueryParams
} from "../types.js";
import {DocumentDatabase} from "../type/document/database.js";
import {Registry} from "../registry.js";
import type { MongoClientOptions } from 'mongodb';


export interface MongoDBDialectConfig extends MongoClientOptions {
  url: string;
  dbName: string;
}
export class MongoDBDialect<S extends Record<string, object> = Record<string, object>> extends Dialect<MongoDBDialectConfig, S, DocumentQueryResult> {
  private client: any = null;
  private db: any = null;

  constructor(config: MongoDBDialectConfig) {
    super('mongodb', config);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client !== null && this.db !== null;
  }

  /**
   * 连接数据库
   */
  async connect(): Promise<void> {
    return this.start();
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    return this.stop();
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }
    try {
      await this.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    try {
      // 动态导入 mongodb 客户端
      const { MongoClient } = await import('mongodb');
      
      this.client = new MongoClient(this.config.url, this.config);
      await this.client.connect();
      this.db = this.client.db(this.config.dbName);
    } catch (error) {
      console.error('forgot install mongodb ?');
      throw new Error(`MongoDB 连接失败: ${error}`);
    }
  }

  /**
   * 停止连接
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('MongoDB 连接已关闭');
    }
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    return this.stop();
  }

  /**
   * 执行查询
   */
  async query<T = any>(query: DocumentQueryResult, params: any[] = []): Promise<T> {
    if (!this.db) {
      throw new Error('MongoDB 未连接');
    }

    try {
      const collection = this.db.collection(query.collection);
      
      switch (query.operation || 'find') {
        case 'find':
          return await this.executeFind(collection, query) as T;
        case 'insertOne':
          return await this.executeInsertOne(collection, query, params) as T;
        case 'insertMany':
          return await this.executeInsertMany(collection, query, params) as T;
        case 'updateOne':
          return await this.executeUpdateOne(collection, query, params) as T;
        case 'updateMany':
          return await this.executeUpdateMany(collection, query, params) as T;
        case 'deleteOne':
          return await this.executeDeleteOne(collection, query) as T;
        case 'deleteMany':
          return await this.executeDeleteMany(collection, query) as T;
        case 'createIndex':
          return await this.executeCreateIndex(collection, query, params) as T;
        case 'dropIndex':
          return await this.executeDropIndex(collection, query, params) as T;
        case 'dropCollection':
          return await this.executeDropCollection(collection) as T;
        default:
          throw new Error(`不支持的 MongoDB 操作: ${query.operation}`);
      }
    } catch (error) {
      throw new Error(`MongoDB 查询执行失败: ${error}`);
    }
  }

  /**
   * 构建查询
   */
  buildQuery<T extends keyof S>(params: QueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    switch (params.type) {
      case 'create':
        return this.buildCreateQuery(params as CreateQueryParams<S,T>);
      case 'select':
        return this.buildSelectQuery(params as SelectQueryParams<S,T>);
      case 'insert':
        return this.buildInsertQuery(params as InsertQueryParams<S,T>);
      case 'update':
        return this.buildUpdateQuery(params as UpdateQueryParams<S,T>);
      case 'delete':
        return this.buildDeleteQuery(params as DeleteQueryParams<S,T>);
      case 'alter':
        return this.buildAlterQuery(params as AlterQueryParams<S,T>);
      case 'drop_table':
        return this.buildDropTableQuery(params as DropTableQueryParams<S,T>);
      case 'drop_index':
        return this.buildDropIndexQuery(params as DropIndexQueryParams<S,T>);
      default:
        throw new Error(`不支持的查询类型: ${(params as any).type}`);
    }
  }

  // 实现 Dialect 接口的所有必需方法
  mapColumnType(type: string): string {
    switch (type) {
      case 'string':
        return 'String';
      case 'integer':
        return 'Int32';
      case 'float':
        return 'Double';
      case 'boolean':
        return 'Boolean';
      case 'date':
        return 'Date';
      case 'json':
        return 'Object';
      default:
        return type;
    }
  }

  formatBoolean(value: boolean): string {
    return value ? 'true' : 'false';
  }

  formatDate(value: Date): string {
    return value.toISOString();
  }

  formatJson(value: any): string {
    return JSON.stringify(value);
  }

  escapeString(value: string): string {
    return value;
  }

  formatDefaultValue(value: any): string {
    return value;
  }

  formatLimit(limit: number): string {
    return `${limit}`;
  }

  formatOffset(offset: number): string {
    return `${offset}`;
  }

  formatLimitOffset(limit: number, offset: number): string {
    return `${limit},${offset}`;
  }

  formatCreateTable(tableName: keyof S, columns: string[]): string {
    return `CREATE TABLE ${String(tableName)} (${columns.join(',')})`;
  }

  formatAlterTable(tableName: keyof S, alterations: string[]): string {
    return `ALTER TABLE ${String(tableName)} ${alterations.join(',')}`;
  }

  formatDropTable(tableName: keyof S  , ifExists?: boolean): string {
    return `DROP TABLE ${String(tableName)} ${ifExists ? 'IF EXISTS' : ''}`;
  }

  formatDropIndex(indexName: string, tableName: keyof S, ifExists?: boolean): string {
    return `DROP INDEX ${indexName} ON ${String(tableName)} ${ifExists ? 'IF EXISTS' : ''}`;
  } 

  quoteIdentifier(identifier: string): string {
    return identifier;
  }

  getParameterPlaceholder(index: number): string {
    return `$${index}`;
  }

  getStatementTerminator(): string {
    return ';';
  }

  // MongoDB 特定的查询构建方法
  private buildCreateQuery<T extends keyof S>(params: CreateQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: String(params.tableName),
        operation: 'createCollection',
        filter: {},
        projection: {}
      },
      params: []
    };
  }

  private buildSelectQuery<T extends keyof S>(params: SelectQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    // 转换条件为 MongoDB 查询格式
    if (params.conditions) {
      this.convertConditionToMongoFilter(params.conditions, filter);
    }

    const query: DocumentQueryResult = {
      collection: String(params.tableName),
      operation: 'find',
      filter
    };

    if (params.orderings) {
      query.sort = {};
      for (const order of params.orderings) {
        query.sort[order.field as string] = order.direction === 'ASC' ? 1 : -1;
      }
    }

    if (params.limitCount) {
      query.limit = params.limitCount;
    }

    if (params.offsetCount) {
      query.skip = params.offsetCount;
    }

    if (params.fields && params.fields.length > 0) {
      query.projection = {};
      for (const field of params.fields) {
        query.projection[field as string] = 1;
      }
    }

    return {
      query,
      params: []
    };
  }

  private buildInsertQuery<T extends keyof S>(params: InsertQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: String(params.tableName),
        operation: 'insertOne',
        filter: {},
        projection: {}
      },
      params: [params.data]
    };
  }

  private buildUpdateQuery<T extends keyof S>(params: UpdateQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    if (params.conditions) {
      this.convertConditionToMongoFilter(params.conditions, filter);
    }

    return {
      query: {
        collection: String(params.tableName),
        operation: 'updateMany',
        filter,
        projection: {}
      },
      params: [params.update]
    };
  }

  private buildDeleteQuery<T extends keyof S>(params: DeleteQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    if (params.conditions) {
      this.convertConditionToMongoFilter(params.conditions, filter);
    }

    return {
      query: {
        collection: String(params.tableName),
        operation: 'deleteMany',
        filter,
        projection: {}
      },
      params: []
    };
  }

  private buildAlterQuery<T extends keyof S>(params: AlterQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: String(params.tableName),
        operation: 'createIndex',
        filter: {},
        projection: {}
      },
      params: [params.alterations]
    };
  }

  private buildDropTableQuery<T extends keyof S>(params: DropTableQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: String(params.tableName),
        operation: 'dropCollection',
        filter: {},
        projection: {}
      },
      params: []
    };
  }

  private buildDropIndexQuery<T extends keyof S>(params: DropIndexQueryParams<S,T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: String(params.tableName),
        operation: 'dropIndex',
        filter: {},
        projection: {}
      },
      params: [params.indexName]
    };
  }

  private convertConditionToMongoFilter(condition: any, filter: Record<string, any>): void {
    if (typeof condition !== 'object' || condition === null) {
      return;
    }

    for (const [key, value] of Object.entries(condition)) {
      if (key.startsWith('$')) {
        // 逻辑操作符
        if (key === '$and' && Array.isArray(value)) {
          filter.$and = value.map(cond => {
            const subFilter: Record<string, any> = {};
            this.convertConditionToMongoFilter(cond, subFilter);
            return subFilter;
          });
        } else if (key === '$or' && Array.isArray(value)) {
          filter.$or = value.map(cond => {
            const subFilter: Record<string, any> = {};
            this.convertConditionToMongoFilter(cond, subFilter);
            return subFilter;
          });
        } else if (key === '$not') {
          const subFilter: Record<string, any> = {};
          this.convertConditionToMongoFilter(value, subFilter);
          filter.$not = subFilter;
        } else {
          filter[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        // 比较操作符
        const fieldFilter: Record<string, any> = {};
        for (const [op, opValue] of Object.entries(value)) {
          if (op.startsWith('$')) {
            fieldFilter[op] = opValue;
          } else {
            fieldFilter.$eq = value;
          }
        }
        filter[key] = Object.keys(fieldFilter).length > 0 ? fieldFilter : value;
      } else {
        // 简单相等
        filter[key] = value;
      }
    }
  }

  // MongoDB 执行方法
  private async executeFind(collection: any, query: DocumentQueryResult): Promise<any[]> {
    let cursor = collection.find(query.filter);

    if (query.sort) {
      cursor = cursor.sort(query.sort);
    }

    if (query.skip) {
      cursor = cursor.skip(query.skip);
    }

    if (query.limit) {
      cursor = cursor.limit(query.limit);
    }

    if (query.projection) {
      cursor = cursor.projection(query.projection);
    }

    return await cursor.toArray();
  }

  private async executeInsertOne(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.insertOne(params[0]);
    return [{ insertedId: result.insertedId, ...params[0] }];
  }

  private async executeInsertMany(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.insertMany(params);
    return Object.values(result.insertedIds).map((id, index) => ({ 
      insertedId: id, 
      ...params[index] 
    }));
  }

  private async executeUpdateOne(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.updateOne(query.filter, { $set: params[0] });
    return [{ modifiedCount: result.modifiedCount, matchedCount: result.matchedCount }];
  }

  private async executeUpdateMany(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.updateMany(query.filter, { $set: params[0] });
    return [{ modifiedCount: result.modifiedCount, matchedCount: result.matchedCount }];
  }

  private async executeDeleteOne(collection: any, query: DocumentQueryResult): Promise<any[]> {
    const result = await collection.deleteOne(query.filter);
    return [{ deletedCount: result.deletedCount }];
  }

  private async executeDeleteMany(collection: any, query: DocumentQueryResult): Promise<any[]> {
    const result = await collection.deleteMany(query.filter);
    return [{ deletedCount: result.deletedCount }];
  }

  private async executeCreateIndex(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.createIndex(params[0]);
    return [{ indexName: result }];
  }

  private async executeDropIndex(collection: any, query: DocumentQueryResult, params: any[]): Promise<any[]> {
    const result = await collection.dropIndex(params[0]);
    return [{ result }];
  }

  private async executeDropCollection(collection: any): Promise<any[]> {
    const result = await collection.drop();
    return [{ result }];
  }

  get dialectInfo(): DatabaseDialect {
    return {
      name: this.name,
      version: '1.0.0',
      features: [
        'document_storage',
        'indexing',
        'aggregation',
        'transactions',
        'replica_sets',
        'sharding'
      ],
      dataTypes: {
        'string': 'String',
        'integer': 'Int32',
        'float': 'Double',
        'boolean': 'Boolean',
        'date': 'Date',
        'json': 'Object'
      },
      identifierQuote: '',
      parameterPlaceholder: '?',
      supportsTransactions: true,
      supportsIndexes: true,
      supportsForeignKeys: false,
      supportsViews: false,
      supportsStoredProcedures: false
    };
  }
}
export class MongoDB<S extends Record<string, object> = Record<string, object>> extends DocumentDatabase<MongoDBDialectConfig, S> {
  constructor(config: MongoDBDialectConfig, definitions?: Database.DefinitionObj<S>) {
    super(new MongoDBDialect<S>(config), definitions);
  }
}
Registry.register('mongodb', MongoDB);
