import { Database, Dialect } from '../../base';
import { DocumentModel } from './model.js';
import { 
  QueryParams, 
  BuildQueryResult, 
  DocumentQueryResult, 
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
 * 文档型数据库类
 * 支持集合、文档的文档型数据模型
 */
export class DocumentDatabase<
  D = any,
  S extends Record<string, object> = Record<string, object>
> extends Database<D, S, DocumentQueryResult> {
  
  constructor(
    dialect: Dialect<D,DocumentQueryResult>,
    schemas?: Database.Schemas<S>,
  ) {
    super(dialect, schemas);
  }

  protected async initialize(): Promise<void> {
    // 文档数据库不需要预定义表结构
    // 集合会在第一次使用时自动创建
  }

  /**
   * 构建查询（重写基类方法）
   */
  buildQuery<U extends object = any>(params: QueryParams<U>): BuildQueryResult<DocumentQueryResult> {
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
   * 构建创建集合查询
   */
  protected buildCreateQuery<T extends object>(params: CreateQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: params.tableName,
        filter: {},
        projection: {}
      },
      params: []
    };
  }

  /**
   * 构建查询文档查询
   */
  protected buildSelectQuery<T extends object>(params: SelectQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    // 转换条件为文档查询格式
    if (params.conditions) {
      this.convertConditionToFilter(params.conditions, filter);
    }

    const query: DocumentQueryResult = {
      collection: params.tableName,
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

  /**
   * 构建插入文档查询
   */
  protected buildInsertQuery<T extends object>(params: InsertQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: params.tableName,
        filter: {},
        projection: {}
      },
      params: [params.data]
    };
  }

  /**
   * 构建更新文档查询
   */
  protected buildUpdateQuery<T extends object>(params: UpdateQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    if (params.conditions) {
      this.convertConditionToFilter(params.conditions, filter);
    }

    return {
      query: {
        collection: params.tableName,
        filter,
        projection: {}
      },
      params: [params.update]
    };
  }

  /**
   * 构建删除文档查询
   */
  protected buildDeleteQuery<T extends object>(params: DeleteQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    const filter: Record<string, any> = {};
    
    if (params.conditions) {
      this.convertConditionToFilter(params.conditions, filter);
    }

    return {
      query: {
        collection: params.tableName,
        filter,
        projection: {}
      },
      params: []
    };
  }

  /**
   * 构建修改集合查询
   */
  protected buildAlterQuery<T extends object>(params: AlterQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: params.tableName,
        filter: {},
        projection: {}
      },
      params: [params.alterations]
    };
  }

  /**
   * 构建删除集合查询
   */
  protected buildDropTableQuery<T extends object>(params: DropTableQueryParams<T>): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: params.tableName,
        filter: {},
        projection: {}
      },
      params: []
    };
  }

  /**
   * 构建删除索引查询
   */
  protected buildDropIndexQuery(params: DropIndexQueryParams): BuildQueryResult<DocumentQueryResult> {
    return {
      query: {
        collection: params.tableName,
        filter: {},
        projection: {}
      },
      params: [params.indexName]
    };
  }

  /**
   * 转换条件为文档查询格式
   */
  private convertConditionToFilter(condition: any, filter: Record<string, any>): void {
    if (typeof condition !== 'object' || condition === null) {
      return;
    }

    for (const [key, value] of Object.entries(condition)) {
      if (key.startsWith('$')) {
        // 逻辑操作符
        if (key === '$and' && Array.isArray(value)) {
          filter.$and = value.map(cond => {
            const subFilter: Record<string, any> = {};
            this.convertConditionToFilter(cond, subFilter);
            return subFilter;
          });
        } else if (key === '$or' && Array.isArray(value)) {
          filter.$or = value.map(cond => {
            const subFilter: Record<string, any> = {};
            this.convertConditionToFilter(cond, subFilter);
            return subFilter;
          });
        } else if (key === '$not') {
          const subFilter: Record<string, any> = {};
          this.convertConditionToFilter(value, subFilter);
          filter.$not = subFilter;
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
        filter[key] = { $eq: value };
      }
    }
  }

  /**
   * 获取模型
   */
  model<T extends keyof S>(name: T): DocumentModel<S[T], D> {
    let model = this.models.get(name as string);
    if (!model) {
      model = new DocumentModel(this as unknown as DocumentDatabase<D>, name as string);
      this.models.set(name as string, model);
    }
    return model as unknown as DocumentModel<S[T], D>;
  }

  /**
   * 获取所有模型名称
   */
  getModelNames(): string[] {
    return Object.keys(this.schemas || {});
  }
}

