import { Database, Dialect } from '../../base/index.js';
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
    dialect: Dialect<D, S, KeyValueQueryResult>,
    definitions?: Database.DefinitionObj<S>,
  ) {
    super(dialect, definitions);
  }

  protected async initialize(): Promise<void> {
    // 键值数据库不需要预定义表结构
    // 桶会在第一次使用时自动创建
  }

  /**
   * 构建查询（重写基类方法）
   */
  buildQuery<T extends keyof S>(params: QueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    switch (params.type) {
      case 'create':
        return this.buildCreateQuery(params as CreateQueryParams<S, T>);
      case 'select':
        return this.buildSelectQuery(params as SelectQueryParams<S, T>);
      case 'insert':
        return this.buildInsertQuery(params as InsertQueryParams<S, T>);
      case 'update':
        return this.buildUpdateQuery(params as UpdateQueryParams<S, T>);
      case 'delete':
        return this.buildDeleteQuery(params as DeleteQueryParams<S, T>);
      case 'alter':
        return this.buildAlterQuery(params as AlterQueryParams<S, T>);
      case 'drop_table':
        return this.buildDropTableQuery(params as DropTableQueryParams<S, T>);
      case 'drop_index':
        return this.buildDropIndexQuery(params as DropIndexQueryParams<S, T>);
      default:
        throw new Error(`Unsupported query type: ${(params as any).type}`);
    }
  }

  /**
   * 构建创建桶查询
   */
  protected buildCreateQuery<T extends keyof S>(params: CreateQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName as string,
        operation: 'keys'
      },
      params: []
    };
  }

  /**
   * 构建查询键值查询
   */
  protected buildSelectQuery<T extends keyof S>(params: SelectQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    // 键值数据库的查询通常是获取所有键或特定键
    const query: KeyValueQueryResult = {
      bucket: params.tableName as string,
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
  protected buildInsertQuery<T extends keyof S>(params: InsertQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromData(params.data);
    
    return {
      query: {
        bucket: params.tableName as string,
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
  protected buildUpdateQuery<T extends keyof S>(params: UpdateQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromCondition(params.conditions);
    
    return {
      query: {
        bucket: params.tableName as string,
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
  protected buildDeleteQuery<T extends keyof S>(params: DeleteQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    const key = this.extractKeyFromCondition(params.conditions);
    
    return {
      query: {
        bucket: params.tableName as string,
        operation: 'delete',
        key: key || 'default'
      },
      params: []
    };
  }

  /**
   * 构建修改桶查询
   */
  protected buildAlterQuery<T extends keyof S>(params: AlterQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName as string,
        operation: 'keys'
      },
      params: [params.alterations]
    };
  }

  /**
   * 构建删除桶查询
   */
  protected buildDropTableQuery<T extends keyof S>(params: DropTableQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName as string,
        operation: 'clear'
      },
      params: []
    };
  }

  /**
   * 构建删除索引查询
   */
  protected buildDropIndexQuery<T extends keyof S>(params: DropIndexQueryParams<S, T>): BuildQueryResult<KeyValueQueryResult> {
    return {
      query: {
        bucket: params.tableName as string,
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
  model<T extends keyof S>(name: T): KeyValueModel<D, S, T> {
    let model = this.models.get(name) as KeyValueModel<D, S, T> | undefined;
    if (!model) {
      model = new KeyValueModel<D, S, T>(this, name);
      this.models.set(name, model as any);
    }
    return model as KeyValueModel<D, S, T>;
  }

  /**
   * 获取所有模型名称
   */
  getModelNames(): string[] {
    return Object.keys(this.definitions || {});
  }
}

