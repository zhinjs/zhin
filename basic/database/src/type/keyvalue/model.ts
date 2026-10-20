import { Model, } from '../../base/index.js';
import { KeyValueDatabase } from './database.js';
import { KeyValueQueryResult } from '../../types.js';

/**
 * 键值模型类
 * 继承自 Model，提供键值数据库特有的操作
 */
export class KeyValueModel<D=any, S extends Record<string, object> = Record<string, object>, T extends keyof S = keyof S> extends Model<D, S, KeyValueQueryResult, T> {
  constructor(
    database: KeyValueDatabase<D, S>,
    name: T
  ) {
    super(database, name);
  }

  /**
   * 设置键值对
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.dialect.query({
      operation: 'set',
      bucket: this.name as string,
      key,
      value,
      ttl,
    });
  }

  /**
   * 获取值
   */
  async get<V = any>(key: string): Promise<V | null> {
    const results = await this.dialect.query(
      {
        operation: 'get',
        bucket: this.name as string,
        key,
      },
      [key]
    );

    if (results.length === 0) {
      return null;
    }

    return results[0] as V;
  }

  /**
   * 删除键
   */
  async deleteByKey(key: string): Promise<boolean> {
    const result = await this.dialect.query(
      {
        operation: 'delete',
        bucket: this.name as string,
        key,
      },
      [key]
    );
    return result[0]?.deleted === true;
  }

  /**
   * 检查键是否存在
   */
  async has(key: string): Promise<boolean> {
    const results = await this.dialect.query(
      {
        operation: 'has',
        bucket: this.name as string,
        key,
      },
      [key, Date.now()]
    );
    return results[0] === true;
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<string[]> {
    const results = await this.dialect.query(
      {
        operation: 'keys',
        bucket: this.name as string,
      },
      [Date.now()]
    );
    return results as string[];
  }

  /**
   * 获取所有值
   */
  async values<V = any>(): Promise<V[]> {
    const results = await this.dialect.query(
      {
        operation: 'values',
        bucket: this.name as string,
      },
      [Date.now()]
    );
    return results as V[];
  }

  /**
   * 获取所有键值对
   */
  async entries<V = any>(): Promise<Array<[string, V]>> {
    const results = await this.dialect.query(
      {
        operation: 'entries',
        bucket: this.name as string,
      },
      [Date.now()]
    );
    return results as Array<[string, V]>;
  }

  /**
   * 清空桶
   */
  async clear(): Promise<void> {
    await this.dialect.query({
      operation: 'clear',
      bucket: this.name as string,
    });
  }

  /**
   * 获取桶大小
   */
  async size(): Promise<number> {
    const results = await this.dialect.query(
      {
        operation: 'size',
        bucket: this.name as string,
      },
      [Date.now()]
    );
    return results[0] ?? 0;
  }

  /**
   * 批量设置
   */
  async setMany(entries: Array<[string, any]>, ttl?: number): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, ttl);
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    const result = await this.dialect.query(
      {
        operation: 'expire',
        bucket: this.name as string,
        key,
        ttl,
      },
      []
    );
    return Boolean(result[0]?.result);
  }

  /**
   * 获取剩余过期时间（秒）
   */
  async ttl(key: string): Promise<number | null> {
    const results = await this.dialect.query(
      {
        operation: 'ttl',
        bucket: this.name as string,
        key,
      },
      [key]
    );

    if (results.length === 0) {
      return null;
    }

    return results[0] as number;
  }

  /**
   * 移除过期时间
   */
  async persist(key: string): Promise<boolean> {
    const result = await this.dialect.query(
      {
        operation: 'persist',
        bucket: this.name as string,
        key,
      },
      [key]
    );
    return Boolean(result[0]?.result);
  }

  /**
   * 清理过期键
   */
  async cleanup(): Promise<number> {
    const result = await this.dialect.query(
      {
        operation: 'cleanup',
        bucket: this.name as string,
      },
      [Date.now()]
    );
    return result[0]?.cleaned ?? 0;
  }

  /**
   * 获取键的模式匹配
   */
  async keysByPattern(pattern: string): Promise<string[]> {
    const results = await this.dialect.query(
      {
        operation: 'keysByPattern',
        bucket: this.name as string,
        pattern,
      },
      []
    );
    return results as string[];
  }

  /**
   * 原子操作：如果不存在则设置
   */
  async setIfNotExists(key: string, value: any, ttl?: number): Promise<boolean> {
    const exists = await this.has(key);
    if (exists) {
      return false;
    }
    
    await this.set(key, value, ttl);
    return true;
  }

  /**
   * 原子操作：如果存在则设置
   */
  async setIfExists(key: string, value: any, ttl?: number): Promise<boolean> {
    const exists = await this.has(key);
    if (!exists) {
      return false;
    }
    
    await this.set(key, value, ttl);
    return true;
  }

  /**
   * 原子操作：获取并设置
   */
  async getAndSet<V = any>(key: string, value: any, ttl?: number): Promise<V | null> {
    const oldValue = await this.get<V>(key);
    await this.set(key, value, ttl);
    return oldValue;
  }

  /**
   * 原子操作：删除并获取
   */
  async deleteAndGet<V = any>(key: string): Promise<V | null> {
    const value = await this.get<V>(key);
    if (value !== null) {
      await this.deleteByKey(key);
    }
    return value;
  }

  // 实现 Model 的抽象方法

  /**
   * 创建数据（键值数据库的创建就是设置）
   */
  async create(data: T): Promise<T> {
    // 键值数据库的创建需要特殊处理
    throw new Error('KeyValue model does not support generic create. Use set() method instead.');
  }

  /**
   * 查找单个数据
   */
  async selectOne(query: { key: string }): Promise<any> {
    return this.get(query.key);
  }

  /**
   * 统计数量
   */
  async count(): Promise<number> {
    return this.size();
  }

  /**
   * 检查是否存在
   */
  async exists(query: { key: string }): Promise<boolean> {
    return this.has(query.key);
  }
}
