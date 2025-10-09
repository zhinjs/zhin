import type { Dialect } from './dialect.js';
import { Model } from './model.js';
import { Schema, QueryParams, AlterSchema, Condition, BuildQueryResult } from '../types.js';
import * as QueryClasses from './query-classes.js';

/**
 * 基础数据库抽象类
 * 定义所有数据库类型的通用接口和行为
 */
export abstract class Database<D=any,S extends Record<string, object>=Record<string, object>,Q=string> {
  protected hasStarted = false;
  public readonly models: Map<string, Model<D,object,Q>> = new Map();
  constructor(
    public readonly dialect: Dialect<D,Q>,
    public schemas?: Database.Schemas<S>,
  ) {}
  /**
   * 数据库是否已启动
   */
  get isStarted(): boolean {
    return this.dialect !== undefined && this.dialect.isConnected();
  }

  /**
   * 启动数据库
   */
  async start(): Promise<void> {
    await this.dialect.connect();
    await this.initialize();
    this.hasStarted = true;
  }

  /**
   * 停止数据库
   */
  async stop(): Promise<void> {
    await this.dialect.disconnect();
    this.hasStarted = false;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    return this.dialect.healthCheck();
  }

  /**
   * 执行原生查询
   */
  async query<U = any>(sql: Q, params?: any[]): Promise<U> {
    if (!this.isStarted) {
      throw new Error('Database not started');
    }
    return this.dialect.query<U>(sql, params);
  }
  abstract buildQuery<U extends object = any>(params: QueryParams<U>): BuildQueryResult<Q>;
  /**
   * 获取数据库方言名称
   */
  get dialectName(): string {
    if(this.dialect === undefined){
      throw new Error('Database not started');
    }
    return this.dialect.name;
  }

  /**
   * 获取数据库配置
   */
  get config(): any {
    if(this.dialect === undefined){
      throw new Error('Database not started');
    }
    return this.dialect.config;
  }

  /**
   * 抽象方法：初始化数据库
   */
  protected abstract initialize(): Promise<void>;

  
  /**
   * 创建表
   */
  create<T extends object>(
    name: string,
    schema: Schema<T>
  ): QueryClasses.Creation<T,D,Q> {
    return new QueryClasses.Creation<T,D,Q>(this, name, schema);
  }
  alter<T extends object>(name: string, alterations: AlterSchema<T>): QueryClasses.Alteration<T,D,Q>{
    return new QueryClasses.Alteration<T,D,Q>(this, name, alterations);
  }
  select<T extends object, K extends keyof T>(name: string, fields: Array<K>): QueryClasses.Selection<Pick<T, K>, K,D,Q>{
    return new QueryClasses.Selection<Pick<T, K>, K,D,Q>(this, name, fields);
  }
  insert<T extends object>(name: string, data: T): QueryClasses.Insertion<T,D,Q>{
    return new QueryClasses.Insertion<T,D,Q>(this, name, data);
  }
  update<T extends object>(name: string, update: Partial<T>): QueryClasses.Updation<T,D,Q>{
    return new QueryClasses.Updation<T,D,Q>(this, name, update);
  }
  delete<T extends object>(name: string, condition: Condition<T>): QueryClasses.Deletion<T,D,Q>{
    return new QueryClasses.Deletion<T,D,Q>(this, name).where(condition);
  }
  /**
   * 抽象方法：获取所有模型名称
   */
  abstract getModelNames(): string[];

  /**
   * 抽象方法：清理资源
   */
  async dispose(): Promise<void> {
    this.models.clear();
    if(this.dialect === undefined){
      throw new Error('Database not started');
    }
    await this.dialect.dispose();
  }
}
export namespace Database {
  export type Schemas<S extends Record<string, object>> = {
    [K in keyof S]: Schema<S[K]>;
  };
}
