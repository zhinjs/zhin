import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { AlterDefinition, Condition } from '../types.js';
import * as QueryClasses from './query-classes.js';


/**
 * 基础模型抽象类
 * 定义所有模型类型的通用接口和行为
 */
export abstract class Model<C=any,S extends Record<string,object>=Record<string, object>,Q = string,T extends keyof S=keyof S> {
  constructor(
    public readonly database: Database<any, S, Q>,
    public readonly name: T
  ) {}

  /**
   * 获取数据库方言
   */
  get dialect(): Dialect<C,S,Q> {
    return this.database.dialect;
  }

  /**
   * 获取数据库是否已启动
   */
  get isStarted(): boolean {
    return this.database.isStarted;
  }

  /**
   * 获取模型名称
   */
  get modelName(): T {
    return this.name;
  }

  alter(alterations: AlterDefinition<S[T]>): QueryClasses.Alteration<S,T, C, Q> {
    return this.database.alter<T>(this.name, alterations);
  }
  select<K extends keyof S[T]>(...fields: Array<K>): QueryClasses.Selection<S,T,K, C, Q> {
    return this.database.select<T, K>(this.name, fields);
  }
  
  insert(data: S[T]): QueryClasses.Insertion<S,T, C, Q> {
    return this.database.insert<T>(this.name, data);
  }
  
  update(update: Partial<S[T]>): QueryClasses.Updation<S,T, C, Q> {
    return this.database.update<T>(this.name, update);
  }
  
  delete(condition: Condition<S[T]>): QueryClasses.Deletion<S,T, C, Q> {
    return this.database.delete<T>(this.name, condition);
  }
  /**
   * 验证查询条件
   */
  protected validateQuery(query: any): boolean {
    return query !== null && query !== undefined;
  }

  /**
   * 验证数据
   */
  protected validateData(data: any): boolean {
    return data !== null && data !== undefined;
  }

  /**
   * 处理错误
   */
  protected handleError(error: Error, operation: string): never {
    const message = `Model ${String(this.name)} ${operation} failed: ${error.message}`;
    throw new Error(message);
  }
}

/**
 * 模型信息接口
 */
export interface ModelInfo {
  name: string;
  databaseName: string;
  dialectName: string;
  isStarted: boolean;
  modelCount: number;
}

