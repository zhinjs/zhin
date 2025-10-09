import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { AlterSchema, Condition } from '../types.js';
import * as QueryClasses from './query-classes.js';


/**
 * 基础模型抽象类
 * 定义所有模型类型的通用接口和行为
 */
export abstract class Model<C=any,O extends object = object,Q = string> {
  constructor(
    public readonly database: Database<C, any, Q>,
    public readonly name: string
  ) {}

  /**
   * 获取数据库方言
   */
  get dialect(): Dialect<C,Q> {
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
  get modelName(): string {
    return this.name;
  }

  alter(alterations: AlterSchema<O>): QueryClasses.Alteration<O, C, Q> {
    return this.database.alter<O>(this.name, alterations);
  }
  select<K extends keyof O>(...fields: Array<K>): QueryClasses.Selection<Pick<O, K>, K, C, Q> {
    return this.database.select<O, K>(this.name, fields);
  }
  
  insert(data: O): QueryClasses.Insertion<O, C, Q> {
    return this.database.insert<O>(this.name, data);
  }
  
  update(update: Partial<O>): QueryClasses.Updation<O, C, Q> {
    return this.database.update<O>(this.name, update);
  }
  
  delete(condition: Condition<O>): QueryClasses.Deletion<O, C, Q> {
    return this.database.delete<O>(this.name, condition);
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
    const message = `Model ${this.name} ${operation} failed: ${error.message}`;
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

