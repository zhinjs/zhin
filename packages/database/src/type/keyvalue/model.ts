import { Model, Dialect, Database } from '../../base';
import { KeyValueDatabase } from './database.js';
import { Condition, KeyValueQueryResult } from '../../types.js';

/**
 * 键值模型类
 * 继承自 Model，提供键值数据库特有的操作
 */
export class KeyValueModel<T extends object = object, D=any> extends Model<D, T, KeyValueQueryResult> {
  constructor(
    database: KeyValueDatabase<D>,
    name: string
  ) {
    super(database, name);
  }

  /**
   * 设置键值对
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.dialect.query({
      operation: 'set',
      bucket: this.name,
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
        bucket: this.name,
        key,
      },
      [key]
    );

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    
    // 检查是否过期
    if (row.expires_at && Date.now() > row.expires_at) {
      await this.deleteByKey(key);
      return null;
    }

    return JSON.parse(row.value);
  }

  /**
   * 删除键
   */
  async deleteByKey(key: string): Promise<boolean> {
    const result = await this.dialect.query(
      {
        operation: 'delete',
        bucket: this.name,
        key,
      },
      [key]
    );
    return result.affectedRows > 0;
  }

  /**
   * 检查键是否存在
   */
  async has(key: string): Promise<boolean> {
    const results = await this.dialect.query(
      {
        operation: 'has',
        bucket: this.name,
        key,
      },
      [key, Date.now()]
    );
    return results.length > 0;
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<string[]> {
    const results = await this.dialect.query(
      {
        operation: 'keys',
        bucket: this.name,
      },
      [Date.now()]
    );
    return results.map((row: any) => row.key);
  }

  /**
   * 获取所有值
   */
  async values<V = any>(): Promise<V[]> {
    const results = await this.dialect.query(
      {
        operation: 'values',
        bucket: this.name,
      },
      [Date.now()]
    );
    return results.map((row: any) => JSON.parse(row.value));
  }

  /**
   * 获取所有键值对
   */
  async entries<V = any>(): Promise<Array<[string, V]>> {
    const results = await this.dialect.query(
      {
        operation: 'entries',
        bucket: this.name,
      },
      [Date.now()]
    );
    return results.map((row: any) => [row.key, JSON.parse(row.value)]);
  }

  /**
   * 清空桶
   */
  async clear(): Promise<void> {
    await this.dialect.query({
      operation: 'clear',
      bucket: this.name,
    });
  }

  /**
   * 获取桶大小
   */
  async size(): Promise<number> {
    const results = await this.dialect.query(
      {
        operation: 'size',
        bucket: this.name,
      },
      [Date.now()]
    );
    return results[0]?.count || 0;
  }

  /**
   * 批量设置
   */
  async setMany(entries: Array<[string, any]>, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
    
    for (const [key, value] of entries) {
      await this.dialect.query(
        {
          operation: 'set',
          bucket: this.name,
          key,
          value,
          ttl,
        },
        [key, JSON.stringify(value), expiresAt]
      );
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    const expiresAt = Date.now() + ttl * 1000;
    const result = await this.dialect.query(
      {
        operation: 'expire',
        bucket: this.name,
        key,
        ttl,
      },
      [expiresAt, key]
    );
    return result.affectedRows > 0;
  }

  /**
   * 获取剩余过期时间（秒）
   */
  async ttl(key: string): Promise<number | null> {
    const results = await this.dialect.query(
      {
        operation: 'ttl',
        bucket: this.name,
        key,
      },
      [key]
    );

    if (results.length === 0) {
      return null;
    }

    const expiresAt = results[0].expires_at;
    if (!expiresAt) {
      return -1; // 永不过期
    }

    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 移除过期时间
   */
  async persist(key: string): Promise<boolean> {
    const result = await this.dialect.query(
      {
        operation: 'persist',
        bucket: this.name,
        key,
      },
      [key]
    );
    return result.affectedRows > 0;
  }

  /**
   * 清理过期键
   */
  async cleanup(): Promise<number> {
    const result = await this.dialect.query(
      {
        operation: 'cleanup',
        bucket: this.name,
      },
      [Date.now()]
    );
    return result.affectedRows;
  }

  /**
   * 获取键的模式匹配
   */
  async keysByPattern(pattern: string): Promise<string[]> {
    // 简单的通配符匹配，将 * 转换为 SQL 的 %
    const sqlPattern = pattern.replace(/\*/g, '%');
    const results = await this.dialect.query(
      {
        operation: 'keysByPattern',
        bucket: this.name,
        pattern: sqlPattern,
      },
      [sqlPattern, Date.now()]
    );
    return results.map((row: any) => row.key);
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