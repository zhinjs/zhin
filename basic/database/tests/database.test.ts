import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Registry } from '../src/registry.js';
import { Sqlite } from '../src/dialects/sqlite.js';

// 注册 SQLite dialect
Registry.register('sqlite', Sqlite);

// 定义测试 Schema
interface TestSchema extends Record<string, object> {
  users: {
    id: number;
    name: string;
    email: string;
    status: string;
    age: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  orders: {
    id: number;
    userId: number;
    amount: number;
    productName: string;
    createdAt: Date;
  };
  products: {
    id: number;
    name: string;
    price: number;
    categoryId: number;
  };
  categories: {
    id: number;
    name: string;
    active: boolean;
  };
}

describe('Database Core Features', () => {
  let db: Sqlite<TestSchema>;

  beforeAll(async () => {
    // 使用 Registry 创建 SQLite 内存数据库
    db = Registry.create<TestSchema, 'sqlite'>('sqlite', { filename: ':memory:' });
    
    db.enableLogging(); // 启用查询日志
    await db.start();
    
    // 创建测试表
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        status TEXT DEFAULT 'active',
        age INTEGER DEFAULT 0,
        deletedAt DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        amount REAL NOT NULL,
        productName TEXT,
        createdAt DATETIME
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        categoryId INTEGER
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER DEFAULT 1
      )
    `);
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    // 清空测试数据
    await db.query('DELETE FROM users');
    await db.query('DELETE FROM orders');
    await db.query('DELETE FROM products');
    await db.query('DELETE FROM categories');
  });

  // ==========================================================================
  // 基础 CRUD 测试
  // ==========================================================================
  
  describe('Basic CRUD', () => {
    it('should insert and select data', async () => {
      // 插入
      await db.insert('users', { 
        id: 1, 
        name: 'John', 
        email: 'john@test.com',
        status: 'active',
        age: 25,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // 查询
      const users = await db.select('users', ['id', 'name', 'email']);
      
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('John');
      expect(users[0].email).toBe('john@test.com');
    });

    it('should update data with where condition', async () => {
      await db.insert('users', { 
        id: 1, name: 'John', email: 'john@test.com', status: 'active', age: 25,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      
      const affected = await db.update('users', { name: 'Jane' })
        .where({ id: 1 });
      
      expect(affected).toBe(1);
      
      const users = await db.select('users', ['name']).where({ id: 1 });
      expect(users[0].name).toBe('Jane');
    });

    it('should delete data', async () => {
      await db.insert('users', { 
        id: 1, name: 'John', email: 'john@test.com', status: 'active', age: 25,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      
      await db.delete('users', { id: 1 });
      
      const users = await db.select('users', ['id']);
      expect(users).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 链式查询测试
  // ==========================================================================
  
  describe('Chainable Query', () => {
    beforeEach(async () => {
      // 插入测试数据
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'alice@test.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'bob@test.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 3, name: 'Charlie', email: 'charlie@test.com', status: 'inactive', age: 35, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 4, name: 'David', email: 'david@test.com', status: 'active', age: 28, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
    });

    it('should support where with comparison operators', async () => {
      const users = await db.select('users', ['name', 'age'])
        .where({ age: { $gt: 28 } });
      
      expect(users).toHaveLength(2);
      expect(users.map(u => u.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should support orderBy', async () => {
      const users = await db.select('users', ['name'])
        .orderBy('name', 'ASC');
      
      expect(users.map(u => u.name)).toEqual(['Alice', 'Bob', 'Charlie', 'David']);
    });

    it('should support limit and offset', async () => {
      const users = await db.select('users', ['name'])
        .orderBy('id', 'ASC')
        .limit(2)
        .offset(1);
      
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Bob');
      expect(users[1].name).toBe('Charlie');
    });

    it('should support $in operator', async () => {
      const users = await db.select('users', ['name'])
        .where({ status: { $in: ['active'] } });
      
      expect(users).toHaveLength(3);
    });

    it('should support $like operator', async () => {
      const users = await db.select('users', ['name'])
        .where({ name: { $like: '%li%' } });
      
      expect(users).toHaveLength(2); // Alice, Charlie
    });

    it('should support logical $or operator', async () => {
      const users = await db.select('users', ['name'])
        .where({ 
          $or: [
            { name: 'Alice' },
            { name: 'Bob' }
          ]
        });
      
      expect(users).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 聚合查询测试
  // ==========================================================================
  
  describe('Aggregation', () => {
    beforeEach(async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'b@t.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 3, name: 'Charlie', email: 'c@t.com', status: 'inactive', age: 35, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
    });

    it('should count records', async () => {
      const result = await db.aggregate('users')
        .count('*', 'total');
      
      expect(result[0].total).toBe(3);
    });

    it('should calculate sum', async () => {
      const result = await db.aggregate('users')
        .sum('age', 'totalAge');
      
      expect(result[0].totalAge).toBe(90);
    });

    it('should calculate avg', async () => {
      const result = await db.aggregate('users')
        .avg('age', 'avgAge');
      
      expect(result[0].avgAge).toBe(30);
    });

    it('should support groupBy', async () => {
      const result = await db.aggregate('users')
        .count('*', 'count')
        .groupBy('status');
      
      expect(result).toHaveLength(2);
      const active = result.find((r: any) => r.status === 'active');
      expect(active?.count).toBe(2);
    });
  });

  // ==========================================================================
  // 批量插入测试
  // ==========================================================================
  
  describe('Batch Insert', () => {
    it('should insert multiple records', async () => {
      const result = await db.insertMany('users', [
        { id: 1, name: 'User1', email: 'u1@t.com', status: 'active', age: 20, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'User2', email: 'u2@t.com', status: 'active', age: 21, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 3, name: 'User3', email: 'u3@t.com', status: 'active', age: 22, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      expect(result.affectedRows).toBe(3);
      
      const users = await db.select('users', ['id']);
      expect(users).toHaveLength(3);
    });
  });

  // ==========================================================================
  // 事务测试
  // ==========================================================================
  
  describe('Transaction', () => {
    it('should commit transaction on success', async () => {
      await db.transaction(async (trx) => {
        await trx.insert('users', { 
          id: 1, name: 'TrxUser', email: 'trx@t.com', status: 'active', age: 25,
          deletedAt: null, createdAt: new Date(), updatedAt: new Date()
        });
        
        await trx.update('users', { age: 30 }).where({ id: 1 });
      });
      
      const users = await db.select('users', ['name', 'age']).where({ id: 1 });
      expect(users).toHaveLength(1);
      expect(users[0].age).toBe(30);
    });

    it('should rollback transaction on error', async () => {
      try {
        await db.transaction(async (trx) => {
          await trx.insert('users', { 
            id: 1, name: 'TrxUser', email: 'trx@t.com', status: 'active', age: 25,
            deletedAt: null, createdAt: new Date(), updatedAt: new Date()
          });
          
          // 故意抛出错误
          throw new Error('Intentional error');
        });
      } catch (e) {
        // 预期会抛出错误
      }
      
      const users = await db.select('users', ['id']);
      expect(users).toHaveLength(0); // 应该回滚
    });

    it('should support chainable queries in transaction', async () => {
      await db.transaction(async (trx) => {
        await trx.insert('users', { 
          id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25,
          deletedAt: null, createdAt: new Date(), updatedAt: new Date()
        });
        
        const users = await trx.select('users', ['name'])
          .where({ status: 'active' });
        
        expect(users).toHaveLength(1);
        expect(users[0].name).toBe('Alice');
      });
    });
  });

  // ==========================================================================
  // 子查询测试
  // ==========================================================================
  
  describe('Subquery', () => {
    beforeEach(async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'b@t.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      await db.insertMany('orders', [
        { id: 1, userId: 1, amount: 100, productName: 'Product A', createdAt: new Date() },
        { id: 2, userId: 1, amount: 200, productName: 'Product B', createdAt: new Date() },
      ]);
    });

    it('should support $in with subquery', async () => {
      // 查询有订单的用户
      const users = await db.select('users', ['id', 'name'])
        .where({
          id: { $in: db.select('orders', ['userId']) }
        });
      
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
    });

    it('should support $nin with subquery', async () => {
      // 查询没有订单的用户
      const users = await db.select('users', ['id', 'name'])
        .where({
          id: { $nin: db.select('orders', ['userId']) }
        });
      
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Bob');
    });
  });

  // ==========================================================================
  // JOIN 测试
  // ==========================================================================
  
  describe('JOIN Query', () => {
    beforeEach(async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'b@t.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      await db.insertMany('orders', [
        { id: 1, userId: 1, amount: 100, productName: 'Product A', createdAt: new Date() },
        { id: 2, userId: 1, amount: 200, productName: 'Product B', createdAt: new Date() },
      ]);
    });

    it('should support INNER JOIN', async () => {
      const result = await db.select('users', ['id', 'name'])
        .join('orders', 'id', 'userId');
      
      // Alice 有 2 个订单，所以返回 2 行
      expect(result).toHaveLength(2);
    });

    it('should support LEFT JOIN', async () => {
      const result = await db.select('users', ['id', 'name'])
        .leftJoin('orders', 'id', 'userId');
      
      // Alice 有 2 订单，Bob 没有订单但也返回
      expect(result).toHaveLength(3);
    });
  });

  // ==========================================================================
  // 软删除测试
  // ==========================================================================
  
  describe('Soft Delete', () => {
    let userModel: ReturnType<typeof db.model<'users'>>;

    beforeAll(() => {
      userModel = db.model('users', { softDelete: true });
    });

    beforeEach(async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'b@t.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
    });

    it('should soft delete (set deletedAt)', async () => {
      await userModel.delete({ id: 1 } as any);
      
      // 检查 deletedAt 被设置
      const allUsers = await userModel.selectWithTrashed('id', 'name', 'deletedAt');
      const alice = allUsers.find(u => u.id === 1);
      
      expect(alice?.deletedAt).not.toBeNull();
    });

    it('should exclude soft deleted in normal select', async () => {
      await userModel.delete({ id: 1 } as any);
      
      const users = await userModel.select('id', 'name');
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Bob');
    });

    it('should include soft deleted with selectWithTrashed', async () => {
      await userModel.delete({ id: 1 } as any);
      
      const users = await userModel.selectWithTrashed('id', 'name');
      expect(users).toHaveLength(2);
    });

    it('should only get soft deleted with selectOnlyTrashed', async () => {
      await userModel.delete({ id: 1 } as any);
      
      const users = await userModel.selectOnlyTrashed('id', 'name');
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
    });

    it('should restore soft deleted record', async () => {
      await userModel.delete({ id: 1 } as any);
      await userModel.restore({ id: 1 } as any);
      
      const users = await userModel.select('id', 'name');
      expect(users).toHaveLength(2);
    });

    it('should force delete (physical delete)', async () => {
      await userModel.forceDelete({ id: 1 } as any);
      
      const allUsers = await userModel.selectWithTrashed('id');
      expect(allUsers).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 边界情况测试
  // ==========================================================================
  
  describe('Edge Cases', () => {
    it('should handle empty result set', async () => {
      const users = await db.select('users', ['id', 'name'])
        .where({ name: 'NonExistent' });
      
      expect(users).toHaveLength(0);
    });

    it('should handle null values correctly', async () => {
      await db.insert('users', { 
        id: 1, name: 'Test', email: null as any, status: 'active', age: 25,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      
      const users = await db.select('users', ['id', 'email'])
        .where({ email: null as any });
      
      expect(users).toHaveLength(1);
      expect(users[0].email).toBeNull();
    });

    it('should handle complex nested conditions', async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'b@t.com', status: 'inactive', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 3, name: 'Charlie', email: 'c@t.com', status: 'active', age: 35, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      // (status = 'active' AND age > 26) OR (status = 'inactive')
      const users = await db.select('users', ['name'])
        .where({
          $or: [
            { status: 'active', age: { $gt: 26 } },
            { status: 'inactive' }
          ]
        });
      
      expect(users.map(u => u.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should handle date comparison', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      await db.insertMany('users', [
        { id: 1, name: 'OldUser', email: 'a@t.com', status: 'active', age: 25, deletedAt: null, createdAt: yesterday, updatedAt: yesterday },
        { id: 2, name: 'NewUser', email: 'b@t.com', status: 'active', age: 30, deletedAt: null, createdAt: now, updatedAt: now },
      ]);
      
      // 比较日期
      const users = await db.select('users', ['name', 'createdAt'])
        .orderBy('id', 'ASC');
      
      expect(users).toHaveLength(2);
    });

    it('should handle special characters in string', async () => {
      await db.insert('users', { 
        id: 1, name: "O'Brien", email: 'test@test.com', status: 'active', age: 25,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      
      const users = await db.select('users', ['name'])
        .where({ name: "O'Brien" });
      
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe("O'Brien");
    });
  });

  // ==========================================================================
  // 查询日志测试
  // ==========================================================================
  
  describe('Query Logging', () => {
    it('should log queries when enabled', async () => {
      const logs: string[] = [];
      
      // 先禁用再启用，确保使用新的 handler
      db.disableLogging();
      db.enableLogging(({ sql }) => {
        logs.push(sql);
      });
      
      await db.select('users', ['id']).where({ status: 'active' });
      
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('SELECT');
      
      // 测试后恢复默认日志
      db.enableLogging();
    });

    it('should not log when disabled', async () => {
      const logs: string[] = [];
      
      db.disableLogging();
      db.enableLogging(({ sql }) => {
        logs.push(sql);
      });
      db.disableLogging();
      
      await db.select('users', ['id']);
      
      expect(logs).toHaveLength(0);
      
      // 测试后恢复默认日志
      db.enableLogging();
    });
  });
});

