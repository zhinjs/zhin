import { Database, Dialect } from '../../base';
import { KeyValueModel } from './model.js';
import { 
  QueryParams, 
  BuildQueryResult, 
  KeyValueQueryResult, 
  KeyValueOperationResult,
  CreateQueryParams,
  SelectQueryParams,
  InsertQueryParams,
  UpdateQueryParams,
  DeleteQueryParams,
  AlterQueryParams,
  DropTableQueryParams,
  DropIndexQueryParams
} from '../../types.js';

/**
 * 键值数据库类
 * 支持简单的键值对存储
 */
export class KeyValueDatabase<
  D=any,
  S extends Record<string, object> = Record<string, object>
> extends Database<D, S, KeyValueQueryResult> {
  
  constructor(
    dialect: Dialect<D,KeyValueQueryResult>,
    schemas?: Database.Schemas<S>,
  ) {
    super(dialect, schemas);
  }

  protected async initialize(): Promise<void> {
    // 键值数据库不需要预定义表结构
    // 桶会在第一次使用时自动创建
  }

  /**
   * 构建查询（重写基类方法）
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
        throw new Error(`Unsupported query type: ${(params as any).type}`);
    }
  }

  /**
   * 构建创建桶查询
   */
  protected buildCreateQuery<T extends object>(params: CreateQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: []
    };
  }

  /**
   * 构建查询键值查询
   */
  protected buildSelectQuery<T extends object>(params: SelectQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    // 键值数据库的查询通常是获取所有键或特定键
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

  /**
   * 构建插入键值查询
   */
  protected buildInsertQuery<T extends object>(params: InsertQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
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

  /**
   * 构建更新键值查询
   */
  protected buildUpdateQuery<T extends object>(params: UpdateQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
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

  /**
   * 构建删除键值查询
   */
  protected buildDeleteQuery<T extends object>(params: DeleteQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
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

  /**
   * 构建修改桶查询
   */
  protected buildAlterQuery<T extends object>(params: AlterQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: [params.alterations]
    };
  }

  /**
   * 构建删除桶查询
   */
  protected buildDropTableQuery<T extends object>(params: DropTableQueryParams<T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'clear'
      },
      params: []
    };
  }

  /**
   * 构建删除索引查询
   */
  protected buildDropIndexQuery(params: DropIndexQueryParams): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName,
        operation: 'keys'
      },
      params: [params.indexName]
    };
  }

  /**
   * 从条件中提取键名
   */
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

  /**
   * 从数据中提取键名
   */
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

  /**
   * 获取模型
   */
  model<T extends keyof S>(name: T): KeyValueModel<S[T], D> {
    let model = this.models.get(name as string);
    if (!model) {
      model = new KeyValueModel(this as unknown as KeyValueDatabase<D>, name as string);
      this.models.set(name as string, model);
    }
    return model as unknown as KeyValueModel<S[T], D>;
  }

  /**
   * 获取所有模型名称
   */
  getModelNames(): string[] {
    return Object.keys(this.schemas || {});
  }
}

