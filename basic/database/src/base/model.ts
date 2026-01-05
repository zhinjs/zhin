import type { Database } from './database.js';
import type { Dialect } from './dialect.js';
import { AlterDefinition, Condition, ModelOptions, HookName, HookFn, HookContext, HooksConfig } from '../types.js';
import * as QueryClasses from './query-classes.js';

/** 默认软删除字段名 */
const DEFAULT_DELETED_AT = 'deletedAt';
/** 默认创建时间字段名 */
const DEFAULT_CREATED_AT = 'createdAt';
/** 默认更新时间字段名 */
const DEFAULT_UPDATED_AT = 'updatedAt';

/**
 * 基础模型抽象类
 * 定义所有模型类型的通用接口和行为
 * 支持软删除、自动时间戳和生命周期钩子
 */
export abstract class Model<C=any,S extends Record<string,object>=Record<string, object>,Q = string,T extends keyof S=keyof S> {
  /** 模型配置选项 */
  public readonly options: ModelOptions;
  /** 生命周期钩子注册表 */
  private readonly hooks: Map<HookName, HookFn<S[T]>[]> = new Map();
  
  constructor(
    public readonly database: Database<any, S, Q>,
    public readonly name: T,
    options?: ModelOptions
  ) {
    this.options = options ?? {};
  }
  
  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================
  
  /**
   * 注册生命周期钩子
   * @param hookName 钩子名称
   * @param fn 钩子函数
   * @returns this（支持链式调用）
   * 
   * @example
   * ```ts
   * userModel
   *   .addHook('beforeCreate', (ctx) => {
   *     ctx.data.createdBy = 'system';
   *   })
   *   .addHook('afterDelete', async (ctx) => {
   *     await logService.log('User deleted', ctx.result);
   *   });
   * ```
   */
  addHook(hookName: HookName, fn: HookFn<S[T]>): this {
    const fns = this.hooks.get(hookName) ?? [];
    fns.push(fn);
    this.hooks.set(hookName, fns);
    return this;
  }
  
  /**
   * addHook 的别名
   */
  on(hookName: HookName, fn: HookFn<S[T]>): this {
    return this.addHook(hookName, fn);
  }
  
  /**
   * 批量注册钩子
   * @example
   * ```ts
   * userModel.registerHooks({
   *   beforeCreate: (ctx) => { ... },
   *   afterUpdate: [(ctx) => { ... }, (ctx) => { ... }]
   * });
   * ```
   */
  registerHooks(hooks: HooksConfig<S[T]>): this {
    for (const [name, fn] of Object.entries(hooks)) {
      if (Array.isArray(fn)) {
        fn.forEach(f => this.addHook(name as HookName, f));
      } else if (fn) {
        this.addHook(name as HookName, fn);
      }
    }
    return this;
  }
  
  /**
   * 移除指定钩子
   */
  removeHook(hookName: HookName, fn?: HookFn<S[T]>): this {
    if (!fn) {
      this.hooks.delete(hookName);
    } else {
      const fns = this.hooks.get(hookName);
      if (fns) {
        const index = fns.indexOf(fn);
        if (index > -1) {
          fns.splice(index, 1);
        }
      }
    }
    return this;
  }
  
  /**
   * 清除所有钩子
   */
  clearHooks(): this {
    this.hooks.clear();
    return this;
  }
  
  /**
   * 触发钩子
   * @returns 如果任何 before 钩子返回 false，则返回 false
   */
  protected async runHooks(hookName: HookName, context: HookContext<S[T]>): Promise<boolean> {
    const fns = this.hooks.get(hookName);
    if (!fns || fns.length === 0) return true;
    
    for (const fn of fns) {
      const result = await fn(context);
      // before 钩子返回 false 可以取消操作
      if (hookName.startsWith('before') && result === false) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * 创建钩子上下文
   */
  protected createHookContext(options: Partial<HookContext<S[T]>> = {}): HookContext<S[T]> {
    return {
      modelName: String(this.name),
      ...options
    };
  }

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
  
  /**
   * 是否启用软删除
   */
  get isSoftDelete(): boolean {
    return this.options.softDelete === true;
  }
  
  /**
   * 软删除字段名
   */
  get deletedAtField(): string {
    return this.options.deletedAtField ?? DEFAULT_DELETED_AT;
  }

  alter(alterations: AlterDefinition<S[T]>): QueryClasses.Alteration<S,T, C, Q> {
    return this.database.alter<T>(this.name, alterations);
  }
  
  /**
   * 查询（软删除模式下自动排除已删除记录）
   */
  select<K extends keyof S[T]>(...fields: Array<K>): QueryClasses.Selection<S,T,K, C, Q> {
    const selection = this.database.select<T, K>(this.name, fields);
    // 软删除模式下自动添加条件
    if (this.isSoftDelete) {
      selection.where({ [this.deletedAtField]: null } as any);
    }
    return selection;
  }
  
  /**
   * 查询（包含已删除的记录）
   */
  selectWithTrashed<K extends keyof S[T]>(...fields: Array<K>): QueryClasses.Selection<S,T,K, C, Q> {
    return this.database.select<T, K>(this.name, fields);
  }
  
  /**
   * 仅查询已删除的记录
   */
  selectOnlyTrashed<K extends keyof S[T]>(...fields: Array<K>): QueryClasses.Selection<S,T,K, C, Q> {
    const selection = this.database.select<T, K>(this.name, fields);
    selection.where({ [this.deletedAtField]: { $ne: null } } as any);
    return selection;
  }
  
  insert(data: S[T]): QueryClasses.Insertion<S,T, C, Q> {
    // 自动添加时间戳
    if (this.options.timestamps) {
      const now = new Date();
      const createdAtField = this.options.createdAtField ?? DEFAULT_CREATED_AT;
      const updatedAtField = this.options.updatedAtField ?? DEFAULT_UPDATED_AT;
      (data as any)[createdAtField] = now;
      (data as any)[updatedAtField] = now;
    }
    return this.database.insert<T>(this.name, data);
  }
  
  update(update: Partial<S[T]>): QueryClasses.Updation<S,T, C, Q> {
    // 自动更新时间戳
    if (this.options.timestamps) {
      const updatedAtField = this.options.updatedAtField ?? DEFAULT_UPDATED_AT;
      (update as any)[updatedAtField] = new Date();
    }
    const updation = this.database.update<T>(this.name, update);
    // 软删除模式下只更新未删除的记录
    if (this.isSoftDelete) {
      updation.where({ [this.deletedAtField]: null } as any);
    }
    return updation;
  }
  
  /**
   * 删除（软删除模式下执行软删除）
   */
  delete(condition: Condition<S[T]>): QueryClasses.Deletion<S,T, C, Q> | QueryClasses.Updation<S,T, C, Q> {
    if (this.isSoftDelete) {
      // 软删除：UPDATE SET deletedAt = NOW()
      return this.database.update<T>(this.name, { 
        [this.deletedAtField]: new Date() 
      } as any).where(condition);
    }
    return this.database.delete<T>(this.name, condition);
  }
  
  /**
   * 强制删除（忽略软删除，直接物理删除）
   */
  forceDelete(condition: Condition<S[T]>): QueryClasses.Deletion<S,T, C, Q> {
    return this.database.delete<T>(this.name, condition);
  }
  
  /**
   * 恢复软删除的记录
   */
  restore(condition: Condition<S[T]>): QueryClasses.Updation<S,T, C, Q> {
    if (!this.isSoftDelete) {
      throw new Error(`Model ${String(this.name)} does not have soft delete enabled`);
    }
    return this.database.update<T>(this.name, { 
      [this.deletedAtField]: null 
    } as any).where(condition);
  }
  
  /**
   * 批量插入
   */
  insertMany(data: S[T][]): QueryClasses.BatchInsertion<S,T, C, Q> {
    // 自动添加时间戳
    if (this.options.timestamps) {
      const now = new Date();
      const createdAtField = this.options.createdAtField ?? DEFAULT_CREATED_AT;
      const updatedAtField = this.options.updatedAtField ?? DEFAULT_UPDATED_AT;
      data.forEach(item => {
        (item as any)[createdAtField] = now;
        (item as any)[updatedAtField] = now;
      });
    }
    return this.database.insertMany<T>(this.name, data);
  }
  
  /**
   * 聚合查询
   */
  aggregate(): QueryClasses.Aggregation<S,T, C, Q> {
    const agg = this.database.aggregate<T>(this.name);
    // 软删除模式下自动排除已删除记录
    if (this.isSoftDelete) {
      agg.where({ [this.deletedAtField]: null } as any);
    }
    return agg;
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

