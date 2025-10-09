import {Dialect} from "../base";
import {KeyValueDatabase} from "../type/keyvalue/database";
import {Registry} from "../registry";
import {Database} from "../base";
import type { RedisClientOptions } from 'redis';
import { 
  BuildQueryResult, 
  KeyValueQueryResult, 
  DatabaseDialect,
  QueryParams,
  CreateQueryParams,
  SelectQueryParams,
  InsertQueryParams,
  UpdateQueryParams,
  DeleteQueryParams,
  AlterQueryParams,
  DropTableQueryParams,
  DropIndexQueryParams
} from "../types";

export interface RedisDialectConfig extends RedisClientOptions {}
export class RedisDialect extends Dialect<RedisDialectConfig, KeyValueQueryResult> {
  private client: any = null;

  constructor(config: RedisDialectConfig) {
    super('redis', config);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client !== null && this.client.isReady;
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
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    try {
      // 动态导入 redis 客户端
      const { createClient } = await import('redis');
      
      this.client = createClient(this.config);

      this.client.on('error', (err: Error) => {
        console.error('Redis 客户端错误:', err);
      });

      this.client.on('connect', () => {
        console.log('Redis 连接已建立');
      });

      this.client.on('ready', () => {
        console.log('Redis 客户端已准备就绪');
      });

      this.client.on('end', () => {
        console.log('Redis 连接已关闭');
      });

      await this.client.connect();
    } catch (error) {
      console.error('forgot install redis ?');
      throw new Error(`Redis 连接失败: ${error}`);
    }
  }

  /**
   * 停止连接
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      console.log('Redis 连接已关闭');
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
  async query<T = any>(query: KeyValueQueryResult, params: any[] = []): Promise<T> {
    if (!this.client) {
      throw new Error('Redis 未连接');
    }

    try {
      const keyPrefix = `${query.bucket}:`;
      
      switch (query.operation) {
        case 'get':
          return await this.executeGet(keyPrefix, query) as T;
        case 'set':
          return await this.executeSet(keyPrefix, query, params) as T;
        case 'delete':
          return await this.executeDelete(keyPrefix, query) as T;
        case 'has':
          return await this.executeHas(keyPrefix, query) as T;
        case 'keys':
          return await this.executeKeys(keyPrefix, query) as T;
        case 'values':
          return await this.executeValues(keyPrefix, query) as T;
        case 'entries':
          return await this.executeEntries(keyPrefix, query) as T;
        case 'clear':
          return await this.executeClear(keyPrefix, query) as T;
        case 'size':
          return await this.executeSize(keyPrefix, query) as T;
        case 'expire':
          return await this.executeExpire(keyPrefix, query, params) as T;
        case 'ttl':
          return await this.executeTtl(keyPrefix, query) as T;
        case 'persist':
          return await this.executePersist(keyPrefix, query) as T;
        case 'cleanup':
          return await this.executeCleanup(keyPrefix, query) as T;
        case 'keysByPattern':
          return await this.executeKeysByPattern(keyPrefix, query, params) as T;
        default:
          throw new Error(`不支持的 Redis 操作: ${query.operation}`);
      }
    } catch (error) {
      throw new Error(`Redis 查询执行失败: ${error}`);
    }
  }

  /**
   * 构建查询
   */
  buildQuery<U extends object = any>(params: QueryParams<U>): BuildQueryResult<KeyValueQueryResult> {
    switch (params.type) {
      case 'create':
        return this.buildCreateQuery(params as CreateQueryParams<U>);
      case 'select':
        return this.buildSelectQuery(params as SelectQueryParams<U>);
      case 'insert':
        return this.buildInsertQuery(params as InsertQueryParams<U>);
      case 'update':
        return this.buildUpdateQuery(params as UpdateQueryParams<U>);
      case 'delete':
        return this.buildDeleteQuery(params as DeleteQueryParams<U>);
      case 'alter':
        return this.buildAlterQuery(params as AlterQueryParams<U>);
      case 'drop_table':
        return this.buildDropTableQuery(params as DropTableQueryParams<U>);
      case 'drop_index':
        return this.buildDropIndexQuery(params as DropIndexQueryParams);
      default:
        throw new Error(`不支持的查询类型: ${(params as any).type}`);
    }
  }

  // 实现 Dialect 接口的所有必需方法
  mapColumnType(type: string): string {
    return type;
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

  formatCreateTable(tableName: string, columns: string[]): string {
    return `CREATE TABLE ${tableName} (${columns.join(',')})`;
  }

  formatAlterTable(tableName: string, alterations: string[]): string {
    return `ALTER TABLE ${tableName} ${alterations.join(',')}`;
  }

  formatDropTable(tableName: string, ifExists?: boolean): string {
    return `DROP TABLE ${tableName} ${ifExists ? 'IF EXISTS' : ''}`;
  }

  formatDropIndex(indexName: string, tableName: string, ifExists?: boolean): string {
    return `DROP INDEX ${indexName} ON ${tableName} ${ifExists ? 'IF EXISTS' : ''}`;
  }

  // Redis 特定的查询构建方法
  private buildCreateQuery<T extends object>(params: CreateQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: []
    };
  }

  private buildSelectQuery<T extends object>(params: SelectQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    const query: KeyValueQueryResult = {
      bucket: params.tableName,
      operation: 'keys'
    };

    // 如果有条件，尝试提取键名
    if (params.conditions) {
      const key = this.extractKeyFromCondition(params.conditions);
      if (key) {
        query.operation = 'get';
        query.key = key;
      }
    }

    return {
      query,
      params: []
    };
  }

  private buildInsertQuery<T extends object>(params: InsertQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromData(params.data);
    
    return {
      query: {
        bucket: params.tableName,
        operation: 'set',
        key: key || 'default',
        value: params.data
      },
      params: [params.data]
    };
  }

  private buildUpdateQuery<T extends object>(params: UpdateQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromCondition(params.conditions);
    
    return {
      query: {
        bucket: params.tableName,
        operation: 'set',
        key: key || 'default',
        value: params.update
      },
      params: [params.update]
    };
  }

  private buildDeleteQuery<T extends object>(params: DeleteQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromCondition(params.conditions);
    
    return {
      query: {
        bucket: params.tableName,
        operation: 'delete',
        key: key || 'default'
      },
      params: []
    };
  }

  private buildAlterQuery<T extends object>(params: AlterQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: [params.alterations]
    };
  }

  private buildDropTableQuery<T extends object>(params: DropTableQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'clear'
      },
      params: []
    };
  }

  private buildDropIndexQuery(params: DropIndexQueryParams): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: [params.indexName]
    };
  }

  private extractKeyFromCondition(condition: any): string | null {
    if (typeof condition !== 'object' || condition === null) {
      return null;
    }

    // 查找 key 字段
    if ('key' in condition) {
      return condition.key;
    }

    // 查找 id 字段
    if ('id' in condition) {
      return condition.id;
    }

    // 递归查找
    for (const value of Object.values(condition)) {
      if (typeof value === 'object' && value !== null) {
        const result = this.extractKeyFromCondition(value);
        if (result) return result;
      }
    }

    return null;
  }

  private extractKeyFromData(data: any): string | null {
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    // 查找 key 字段
    if ('key' in data) {
      return data.key;
    }

    // 查找 id 字段
    if ('id' in data) {
      return data.id;
    }

    return null;
  }

  // Redis 执行方法
  private async executeGet(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    if (!query.key) {
      throw new Error('GET 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const value = await this.client.get(key);
    
    if (value === null) {
      return [];
    }

    try {
      return [JSON.parse(value)];
    } catch {
      return [value];
    }
  }

  private async executeSet(keyPrefix: string, query: KeyValueQueryResult, params: any[]): Promise<any[]> {
    if (!query.key) {
      throw new Error('SET 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const value = JSON.stringify(params[0] || query.value);
    
    let result: any;
    if (query.ttl) {
      result = await this.client.setEx(key, query.ttl, value);
    } else {
      result = await this.client.set(key, value);
    }

    return [{ key: query.key, result }];
  }

  private async executeDelete(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    if (!query.key) {
      throw new Error('DELETE 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const result = await this.client.del(key);
    return [{ key: query.key, deleted: result > 0 }];
  }

  private async executeHas(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    if (!query.key) {
      throw new Error('HAS 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const result = await this.client.exists(key);
    return [result === 1];
  }

  private async executeKeys(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    const pattern = `${keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    return keys.map((key: string) => key.replace(keyPrefix, ''));
  }

  private async executeValues(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    const pattern = `${keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    
    if (keys.length === 0) {
      return [];
    }

    const values = await this.client.mGet(keys);
    return values.map((value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });
  }

  private async executeEntries(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    const pattern = `${keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    
    if (keys.length === 0) {
      return [];
    }

    const values = await this.client.mGet(keys);
    return keys.map((key: string, index: number) => {
      const cleanKey = key.replace(keyPrefix, '');
      const value = values[index];
      try {
        return [cleanKey, JSON.parse(value)];
      } catch {
        return [cleanKey, value];
      }
    });
  }

  private async executeClear(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    const pattern = `${keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    
    if (keys.length === 0) {
      return [{ cleared: 0 }];
    }

    const result = await this.client.del(keys);
    return [{ cleared: result }];
  }

  private async executeSize(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    const pattern = `${keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    return [keys.length];
  }

  private async executeExpire(keyPrefix: string, query: KeyValueQueryResult, params: any[]): Promise<any[]> {
    if (!query.key) {
      throw new Error('EXPIRE 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const ttl = params[0] || query.ttl;
    const result = await this.client.expire(key, ttl);
    return [{ key: query.key, result }];
  }

  private async executeTtl(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    if (!query.key) {
      throw new Error('TTL 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const ttl = await this.client.ttl(key);
    return [ttl];
  }

  private async executePersist(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    if (!query.key) {
      throw new Error('PERSIST 操作需要指定 key');
    }

    const key = `${keyPrefix}${query.key}`;
    const result = await this.client.persist(key);
    return [{ key: query.key, result }];
  }

  private async executeCleanup(keyPrefix: string, query: KeyValueQueryResult): Promise<any[]> {
    // Redis 会自动清理过期的键，这里返回 0
    return [{ cleaned: 0 }];
  }

  private async executeKeysByPattern(keyPrefix: string, query: KeyValueQueryResult, params: any[]): Promise<any[]> {
    const pattern = params[0] || query.pattern || '*';
    const fullPattern = `${keyPrefix}${pattern}`;
    const keys = await this.client.keys(fullPattern);
    return keys.map((key: string) => key.replace(keyPrefix, ''));
  }

  get dialectInfo(): DatabaseDialect {
    return {
      name: this.name,
      version: '1.0.0',
      features: [
        'key_value_storage',
        'expiration',
        'pub_sub',
        'streams',
        'clustering',
        'persistence'
      ],
      dataTypes: {
        'string': 'String',
        'integer': 'Integer',
        'float': 'Float',
        'boolean': 'Boolean',
        'date': 'Timestamp',
        'json': 'JSON'
      },
      identifierQuote: '',
      parameterPlaceholder: '?',
      supportsTransactions: true,
      supportsIndexes: false,
      supportsForeignKeys: false,
      supportsViews: false,
      supportsStoredProcedures: false
    };
  }
}

Registry.register('redis', (config: RedisDialectConfig, schemas?: Database.Schemas<Record<string, object>>) => {
  return new KeyValueDatabase(new RedisDialect(config), schemas);
});
