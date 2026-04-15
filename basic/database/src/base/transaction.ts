import { 
  Transaction, 
  TransactionContext, 
  TransactionSelection, 
  TransactionUpdation, 
  TransactionDeletion,
  Condition,
  BuildQueryResult
} from '../types.js';
import type { Database } from './database.js';

/**
 * 事务查询选择器实现
 */
class TrxSelection<S extends Record<string, object>, T extends keyof S> implements TransactionSelection<S, T> {
  private conditions: Condition<S[T]> = {};
  private orderings: { field: keyof S[T]; direction: 'ASC' | 'DESC' }[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  
  constructor(
    private readonly db: Database<any, S, string>,
    private readonly trx: Transaction,
    private readonly tableName: T,
    private readonly fields?: (keyof S[T])[]
  ) {}
  
  where(condition: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...condition };
    return this;
  }
  
  orderBy(field: keyof S[T], direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderings.push({ field, direction });
    return this;
  }
  
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }
  
  then<R>(onfulfilled?: (value: S[T][]) => R | PromiseLike<R>): Promise<R> {
    const { query, params } = this.db.buildQuery({
      type: 'select',
      tableName: this.tableName,
      fields: this.fields,
      conditions: this.conditions,
      orderings: this.orderings,
      limitCount: this.limitCount,
      offsetCount: this.offsetCount
    });
    
    return this.trx.query<S[T][]>(query, params).then(onfulfilled!);
  }
}

/**
 * 事务更新器实现
 */
class TrxUpdation<S extends Record<string, object>, T extends keyof S> implements TransactionUpdation<S, T> {
  private conditions: Condition<S[T]> = {};
  
  constructor(
    private readonly db: Database<any, S, string>,
    private readonly trx: Transaction,
    private readonly tableName: T,
    private readonly data: Partial<S[T]>
  ) {}
  
  where(condition: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...condition };
    return this;
  }
  
  then<R>(onfulfilled?: (value: number) => R | PromiseLike<R>): Promise<R> {
    const { query, params } = this.db.buildQuery({
      type: 'update',
      tableName: this.tableName,
      update: this.data,
      conditions: this.conditions
    });
    
    return this.trx.query<{ affectedRows?: number; changes?: number }>(query, params)
      .then(result => {
        const affected = result.affectedRows ?? result.changes ?? 0;
        return onfulfilled ? onfulfilled(affected) : affected as any;
      });
  }
}

/**
 * 事务删除器实现
 */
class TrxDeletion<S extends Record<string, object>, T extends keyof S> implements TransactionDeletion<S, T> {
  private conditions: Condition<S[T]> = {};
  
  constructor(
    private readonly db: Database<any, S, string>,
    private readonly trx: Transaction,
    private readonly tableName: T
  ) {}
  
  where(condition: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...condition };
    return this;
  }
  
  then<R>(onfulfilled?: (value: number) => R | PromiseLike<R>): Promise<R> {
    const { query, params } = this.db.buildQuery({
      type: 'delete',
      tableName: this.tableName,
      conditions: this.conditions
    });
    
    return this.trx.query<{ affectedRows?: number; changes?: number }>(query, params)
      .then(result => {
        const affected = result.affectedRows ?? result.changes ?? 0;
        return onfulfilled ? onfulfilled(affected) : affected as any;
      });
  }
}

/**
 * 增强的事务上下文实现
 * 支持链式调用的事务操作
 */
export class TransactionContextImpl<S extends Record<string, object>> implements TransactionContext<S> {
  constructor(
    private readonly db: Database<any, S, string>,
    private readonly trx: Transaction
  ) {}
  
  /**
   * 提交事务
   */
  async commit(): Promise<void> {
    return this.trx.commit();
  }
  
  /**
   * 回滚事务
   */
  async rollback(): Promise<void> {
    return this.trx.rollback();
  }
  
  /**
   * 执行原生 SQL
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T> {
    return this.trx.query<T>(sql, params);
  }
  
  /**
   * 插入单条数据
   */
  async insert<T extends keyof S>(tableName: T, data: S[T]): Promise<S[T]> {
    const { query, params } = this.db.buildQuery({
      type: 'insert',
      tableName,
      data
    });
    
    await this.trx.query(query, params);
    return data;
  }
  
  /**
   * 批量插入数据
   */
  async insertMany<T extends keyof S>(tableName: T, data: S[T][]): Promise<{ affectedRows: number }> {
    if (!data.length) {
      return { affectedRows: 0 };
    }
    
    const { query, params } = this.db.buildQuery({
      type: 'insert_many',
      tableName,
      data
    });
    
    const result = await this.trx.query<{ affectedRows?: number; changes?: number }>(query, params);
    return { affectedRows: result.affectedRows ?? result.changes ?? data.length };
  }
  
  /**
   * 查询数据 - 返回链式选择器
   */
  select<T extends keyof S>(tableName: T, fields?: (keyof S[T])[]): TransactionSelection<S, T> {
    return new TrxSelection(this.db, this.trx, tableName, fields);
  }
  
  /**
   * 更新数据 - 返回链式更新器
   */
  update<T extends keyof S>(tableName: T, data: Partial<S[T]>): TransactionUpdation<S, T> {
    return new TrxUpdation(this.db, this.trx, tableName, data);
  }
  
  /**
   * 删除数据 - 返回链式删除器
   */
  delete<T extends keyof S>(tableName: T): TransactionDeletion<S, T> {
    return new TrxDeletion(this.db, this.trx, tableName);
  }
}

