import type { Dialect } from './dialect.js';
import { Model } from './model.js';
import { Definition, QueryParams, AlterDefinition, Condition, BuildQueryResult } from '../types.js';
import * as QueryClasses from './query-classes.js';

/**
 * 基础数据库抽象类
 * 定义所有数据库类型的通用接口和行为
 */
export abstract class Database<D=any,S extends Record<string, object>=Record<string, object>,Q=string> {
  protected hasStarted = false;
  public readonly definitions: Database.Definitions<S>=new Database.Definitions<S>();
  public readonly models: Database.Models<S,D,Q> = new Database.Models<S,D,Q>();
  constructor(
    public readonly dialect: Dialect<D,S,Q>,
    definitions?: Database.DefinitionObj<S>,
  ) {
    for (const key in definitions) {
      this.definitions.set(key, definitions[key]);
    }
  }
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
    console.log(`Database disconnected from dialect: ${this.dialect.name}`);
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
  abstract buildQuery<T extends keyof S>(params: QueryParams<S,T>): BuildQueryResult<Q>;
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
  define<K extends keyof S>(name: K, definition: Definition<S[K]>) {
    this.definitions.set(name, definition);
  }
  desstory<K extends keyof S>(name: K) {
    this.definitions.delete(name);
  }
  
  /**
   * 创建表
   */
  create<T extends keyof S>(
    name: T,
    definition: Definition<S[T]>
  ): QueryClasses.Creation<S,T,D,Q> {
    return new QueryClasses.Creation<S,T,D,Q>(this, name, definition);
  }
  alter<T extends keyof S>(name: T, alterations: AlterDefinition<S[T]>): QueryClasses.Alteration<S,T,D,Q>{
    return new QueryClasses.Alteration<S,T,D,Q>(this, name, alterations);
  }
  select<T extends keyof S, K extends keyof S[T]>(name: T, fields: Array<K>): QueryClasses.Selection<S,T,K,D,Q>{
    return new QueryClasses.Selection<S,T,K,D,Q>(this, name, fields);
  }
  insert<T extends keyof S>(name: T, data: S[T]): QueryClasses.Insertion<S,T,D,Q>{
    return new QueryClasses.Insertion<S,T,D,Q>(this, name, data);
  }
  update<T extends keyof S>(name: T, update: Partial<S[T]>): QueryClasses.Updation<S,T,D,Q>{
    return new QueryClasses.Updation<S,T,D,Q>(this, name, update);
  }
  delete<T extends keyof S>(name: T, condition: Condition<S[T]>): QueryClasses.Deletion<S,T,D,Q>{
    return new QueryClasses.Deletion<S,T,D,Q>(this, name).where(condition);
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
  export class Definitions<S extends Record<string, object>> extends Map<keyof S, Definition<S[keyof S]>> {
    constructor() {
      super();
    }
  }
  export class Models<S extends Record<string, object>,D=any,Q=string> extends Map<keyof S, Model<D,S,Q,keyof S>> {
    constructor() {
      super();
    }
    get<K extends keyof S>(key: K): Model<D,S,Q,K> | undefined {
      return super.get(key) as Model<D,S,Q,K> | undefined;
    }
  }
  export type DefinitionObj<S extends Record<string, object>> = {
    [K in keyof S]: Definition<S[K]>;
  };
}
