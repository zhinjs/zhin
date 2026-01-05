import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Registry } from '../src/registry.js';
import { Sqlite } from '../src/dialects/sqlite.js';
import { MigrationRunner, defineMigration } from '../src/migration.js';

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

  // ==========================================================================
  // Relations 关联关系测试
  // ==========================================================================
  
  describe('Relations', () => {
    beforeEach(async () => {
      // 插入用户数据
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'alice@test.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'bob@test.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      // 插入订单数据
      await db.insertMany('orders', [
        { id: 1, userId: 1, amount: 100, productName: 'Product A', createdAt: new Date() },
        { id: 2, userId: 1, amount: 200, productName: 'Product B', createdAt: new Date() },
        { id: 3, userId: 2, amount: 150, productName: 'Product C', createdAt: new Date() },
      ]);
    });

    it('should define hasMany relation', () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      
      // 新 API：传入模型实例，自动推断关系名
      userModel.hasMany(orderModel, 'userId');
      
      expect(userModel.getRelationNames()).toContain('orders');
      expect(userModel.getRelation('orders')?.type).toBe('hasMany');
    });

    it('should define belongsTo relation', () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      
      // 新 API：传入模型实例
      orderModel.belongsTo(userModel, 'userId');
      
      expect(orderModel.getRelationNames()).toContain('users');
      expect(orderModel.getRelation('users')?.type).toBe('belongsTo');
    });

    it('should load hasMany relation for single record', async () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      userModel.hasMany(orderModel, 'userId');
      
      const alice = await userModel.selectById(1);
      const aliceWithOrders = await userModel.loadRelation(alice!, 'orders');
      
      expect(aliceWithOrders.orders).toHaveLength(2);
      expect((aliceWithOrders.orders as any[])[0].productName).toBe('Product A');
    });

    it('should load belongsTo relation for single record', async () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      orderModel.belongsTo(userModel, 'userId');
      
      const order = await orderModel.selectById(1);
      const orderWithUser = await orderModel.loadRelation(order!, 'users');
      
      expect(orderWithUser.users).not.toBeNull();
      expect((orderWithUser.users as any).name).toBe('Alice');
    });

    it('should batch load relations (solve N+1)', async () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      userModel.hasMany(orderModel, 'userId');
      
      const users = await userModel.select();
      const usersWithOrders = await userModel.loadRelations(users, ['orders']);
      
      expect(usersWithOrders).toHaveLength(2);
      
      const alice = usersWithOrders.find(u => u.name === 'Alice');
      const bob = usersWithOrders.find(u => u.name === 'Bob');
      
      expect(alice?.orders).toHaveLength(2);
      expect(bob?.orders).toHaveLength(1);
    });

    it('should use .with() for eager loading', async () => {
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      userModel.hasMany(orderModel, 'userId');
      
      const usersWithOrders = await userModel.with('orders')
        .where({ status: 'active' })
        .orderBy('id', 'ASC');
      
      expect(usersWithOrders).toHaveLength(2);
      expect(usersWithOrders[0].orders).toHaveLength(2); // Alice's orders
      expect(usersWithOrders[1].orders).toHaveLength(1); // Bob's orders
    });

    it('should handle null belongsTo relation', async () => {
      // 插入一个没有用户的订单
      await db.insert('orders', { id: 99, userId: 999, amount: 50, productName: 'Orphan', createdAt: new Date() });
      
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      orderModel.belongsTo(userModel, 'userId');
      
      const order = await orderModel.selectById(99);
      const orderWithUser = await orderModel.loadRelation(order!, 'users');
      
      expect(orderWithUser.users).toBeNull();
    });

    it('should handle empty hasMany relation', async () => {
      // 插入一个没有订单的用户
      await db.insert('users', { id: 99, name: 'NoOrders', email: 'no@test.com', status: 'active', age: 40, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
      
      const userModel = db.model('users');
      const orderModel = db.model('orders');
      userModel.hasMany(orderModel, 'userId');
      
      const user = await userModel.selectById(99);
      const userWithOrders = await userModel.loadRelation(user!, 'orders');
      
      expect(userWithOrders.orders).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 预定义关系配置测试
  // ==========================================================================
  
  describe('Predefined Relations Config', () => {
    beforeEach(async () => {
      await db.insertMany('users', [
        { id: 1, name: 'Alice', email: 'alice@test.com', status: 'active', age: 25, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, name: 'Bob', email: 'bob@test.com', status: 'active', age: 30, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      await db.insertMany('orders', [
        { id: 1, userId: 1, amount: 100, productName: 'Product A', createdAt: new Date() },
        { id: 2, userId: 1, amount: 200, productName: 'Product B', createdAt: new Date() },
      ]);
    });

    it('should auto-apply relations from defineRelations()', async () => {
      // 预定义关系配置
      db.defineRelations({
        users: {
          hasMany: { orders: 'userId' }
        },
        orders: {
          belongsTo: { users: 'userId' }
        }
      });
      
      // 获取模型时自动应用关系
      const userModel = db.model('users');
      
      // 无需手动调用 hasMany，关系已自动配置
      expect(userModel.getRelationNames()).toContain('orders');
      
      // 直接使用 .with() 加载关联
      const usersWithOrders = await userModel.with('orders');
      
      expect(usersWithOrders).toHaveLength(2);
      expect(usersWithOrders[0].orders).toHaveLength(2);
    });

    it('should support belongsTo from config', async () => {
      db.defineRelations({
        orders: {
          belongsTo: { users: 'userId' }
        }
      });
      
      const orderModel = db.model('orders');
      
      expect(orderModel.getRelationNames()).toContain('users');
      
      const order = await orderModel.selectById(1);
      const orderWithUser = await orderModel.loadRelation(order!, 'users');
      
      expect((orderWithUser.users as any).name).toBe('Alice');
    });

    it('should work with model options and relations', async () => {
      db.defineRelations({
        users: {
          hasMany: { orders: 'userId' }
        }
      });
      
      // 同时使用 options 和预定义关系
      const userModel = db.model('users', { softDelete: true });
      
      // 关系仍然被正确应用
      expect(userModel.getRelationNames()).toContain('orders');
    });
  });
});

// =============================================================================
// Migration Tests (独立的 describe 块，使用独立的数据库实例)
// =============================================================================

describe('Migration Runner', () => {
  let migrationDb: Sqlite<Record<string, object>>;
  let runner: MigrationRunner;

  beforeAll(async () => {
    // 创建一个独立的数据库用于迁移测试
    migrationDb = new Sqlite({ filename: ':memory:' });
    await migrationDb.start();
  });

  afterAll(async () => {
    await migrationDb.stop();
  });

  beforeEach(async () => {
    // 清理迁移表和测试创建的表
    await migrationDb.query("DELETE FROM _migrations").catch(() => {});
    
    // 删除测试创建的表
    const tables = ['test_table', 'another_table', 'table_a', 'table_b', 
                    'column_test', 'index_test', 'first_table', 'second_table',
                    'refresh_table', 'only_once'];
    for (const table of tables) {
      await migrationDb.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
    }
    
    // 每个测试使用新的 runner
    runner = new MigrationRunner(migrationDb as any);
  });

  it('should create migration table automatically', async () => {
    const status = await runner.status();
    expect(status).toHaveLength(0);
    
    // 验证迁移表已创建
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
    );
    expect(tables).toHaveLength(1);
  });

  it('should run migrations and track status', async () => {
    runner.add(defineMigration({
      name: '001_create_test_table',
      up: async (ctx) => {
        await ctx.createTable('test_table', {
          id: { type: 'integer', primary: true, autoIncrement: true },
          name: { type: 'text', nullable: false }
        });
      },
      down: async (ctx) => {
        await ctx.dropTable('test_table');
      }
    }));

    // 检查初始状态
    let status = await runner.status();
    expect(status).toHaveLength(1);
    expect(status[0].status).toBe('pending');

    // 运行迁移
    const migrated = await runner.migrate();
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toBe('001_create_test_table');

    // 检查迁移后状态
    status = await runner.status();
    expect(status[0].status).toBe('executed');
    expect(status[0].batch).toBe(1);

    // 验证表已创建
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
    );
    expect(tables).toHaveLength(1);
  });

  it('should rollback last batch', async () => {
    runner.add(defineMigration({
      name: '002_create_another_table',
      up: async (ctx) => {
        await ctx.createTable('another_table', {
          id: { type: 'integer', primary: true }
        });
      },
      down: async (ctx) => {
        await ctx.dropTable('another_table');
      }
    }));

    // 运行迁移
    await runner.migrate();

    // 回滚
    const rolledBack = await runner.rollback();
    expect(rolledBack).toHaveLength(1);
    expect(rolledBack[0]).toBe('002_create_another_table');

    // 验证表已删除
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='another_table'"
    );
    expect(tables).toHaveLength(0);
  });

  it('should run multiple migrations in batch', async () => {
    runner.addAll([
      defineMigration({
        name: '003_table_a',
        up: async (ctx) => {
          await ctx.createTable('table_a', {
            id: { type: 'integer', primary: true }
          });
        },
        down: async (ctx) => {
          await ctx.dropTable('table_a');
        }
      }),
      defineMigration({
        name: '004_table_b',
        up: async (ctx) => {
          await ctx.createTable('table_b', {
            id: { type: 'integer', primary: true }
          });
        },
        down: async (ctx) => {
          await ctx.dropTable('table_b');
        }
      })
    ]);

    const migrated = await runner.migrate();
    expect(migrated).toHaveLength(2);

    // 验证两个表都创建了
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('table_a', 'table_b')"
    );
    expect(tables).toHaveLength(2);

    // 回滚应该一次性回滚两个（同一批次）
    const rolledBack = await runner.rollback();
    expect(rolledBack).toHaveLength(2);
  });

  it('should support addColumn and dropColumn', async () => {
    runner.add(defineMigration({
      name: '005_add_column',
      up: async (ctx) => {
        await ctx.createTable('column_test', {
          id: { type: 'integer', primary: true }
        });
        await ctx.addColumn('column_test', 'email', { 
          type: 'text', 
          nullable: true 
        });
      },
      down: async (ctx) => {
        await ctx.dropTable('column_test');
      }
    }));

    await runner.migrate();

    // 验证表已创建（通过插入数据测试）
    await migrationDb.query("INSERT INTO column_test (id, email) VALUES (1, 'test@test.com')");
    const rows = await migrationDb.query<any[]>("SELECT * FROM column_test");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('test@test.com');
  });

  it('should support addIndex and dropIndex', async () => {
    runner.add(defineMigration({
      name: '006_add_index',
      up: async (ctx) => {
        await ctx.createTable('index_test', {
          id: { type: 'integer', primary: true },
          email: { type: 'text' }
        });
        await ctx.addIndex('index_test', 'idx_email', ['email'], true);
      },
      down: async (ctx) => {
        await ctx.dropIndex('index_test', 'idx_email');
        await ctx.dropTable('index_test');
      }
    }));

    await runner.migrate();

    // 验证索引已创建
    const indexes = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_email'"
    );
    expect(indexes).toHaveLength(1);
  });

  it('should support reset (rollback all)', async () => {
    // 添加多个迁移
    runner.addAll([
      defineMigration({
        name: '007_first',
        up: async (ctx) => {
          await ctx.createTable('first_table', { id: { type: 'integer', primary: true } });
        },
        down: async (ctx) => {
          await ctx.dropTable('first_table');
        }
      }),
      defineMigration({
        name: '008_second',
        up: async (ctx) => {
          await ctx.createTable('second_table', { id: { type: 'integer', primary: true } });
        },
        down: async (ctx) => {
          await ctx.dropTable('second_table');
        }
      })
    ]);

    await runner.migrate();

    // Reset 应该回滚所有
    const rolledBack = await runner.reset();
    expect(rolledBack).toHaveLength(2);

    // 验证所有表都删除了
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('first_table', 'second_table')"
    );
    expect(tables).toHaveLength(0);
  });

  it('should support refresh (reset + migrate)', async () => {
    runner.add(defineMigration({
      name: '009_refresh_test',
      up: async (ctx) => {
        await ctx.createTable('refresh_table', { id: { type: 'integer', primary: true } });
      },
      down: async (ctx) => {
        await ctx.dropTable('refresh_table');
      }
    }));

    await runner.migrate();

    const result = await runner.refresh();
    expect(result.rolledBack).toHaveLength(1);
    expect(result.migrated).toHaveLength(1);
  });

  it('should skip already executed migrations', async () => {
    runner.add(defineMigration({
      name: '010_only_once',
      up: async (ctx) => {
        await ctx.createTable('only_once', { id: { type: 'integer', primary: true } });
      },
      down: async (ctx) => {
        await ctx.dropTable('only_once');
      }
    }));

    // 第一次运行
    const first = await runner.migrate();
    expect(first).toHaveLength(1);

    // 第二次运行应该跳过
    const second = await runner.migrate();
    expect(second).toHaveLength(0);
  });

  // 自动生成 down 的测试
  it('should auto-generate down for createTable', async () => {
    // 只定义 up，不定义 down
    runner.add(defineMigration({
      name: '011_auto_down_table',
      up: async (ctx) => {
        await ctx.createTable('auto_table', {
          id: { type: 'integer', primary: true },
          name: { type: 'text' }
        });
      }
      // down 自动生成
    }));

    await runner.migrate();

    // 验证表创建成功
    const tables = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='auto_table'"
    );
    expect(tables).toHaveLength(1);

    // 回滚 - 应该自动调用 dropTable
    await runner.rollback();

    // 验证表被删除
    const tablesAfter = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='auto_table'"
    );
    expect(tablesAfter).toHaveLength(0);
  });

  it('should auto-generate down for addColumn and addIndex', async () => {
    // 先创建基础表
    await migrationDb.query(`
      CREATE TABLE base_table (id INTEGER PRIMARY KEY)
    `);

    runner.add(defineMigration({
      name: '012_auto_down_column_index',
      up: async (ctx) => {
        await ctx.addColumn('base_table', 'email', { type: 'text' });
        await ctx.addIndex('base_table', 'idx_email', ['email']);
      }
      // down 自动生成: dropIndex + dropColumn
    }));

    await runner.migrate();

    // 验证列和索引创建成功
    const indexes = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_email'"
    );
    expect(indexes).toHaveLength(1);

    // 回滚
    await runner.rollback();

    // 验证索引被删除
    const indexesAfter = await migrationDb.query<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_email'"
    );
    expect(indexesAfter).toHaveLength(0);
  });

  it('should auto-generate down for renameColumn', async () => {
    // 先创建表
    await migrationDb.query(`
      CREATE TABLE rename_test (id INTEGER PRIMARY KEY, old_name TEXT)
    `);

    runner.add(defineMigration({
      name: '013_auto_down_rename',
      up: async (ctx) => {
        await ctx.renameColumn('rename_test', 'old_name', 'new_name');
      }
      // down 自动生成: renameColumn('new_name', 'old_name')
    }));

    await runner.migrate();

    // 验证列已重命名
    await migrationDb.query("INSERT INTO rename_test (id, new_name) VALUES (1, 'test')");
    const rows = await migrationDb.query<any[]>("SELECT new_name FROM rename_test");
    expect(rows[0].new_name).toBe('test');

    // 回滚
    await runner.rollback();

    // 验证列恢复原名
    await migrationDb.query("UPDATE rename_test SET old_name = 'restored' WHERE id = 1");
    const rowsAfter = await migrationDb.query<any[]>("SELECT old_name FROM rename_test");
    expect(rowsAfter[0].old_name).toBe('restored');
  });

  it('should throw error for non-reversible operations', async () => {
    runner.add(defineMigration({
      name: '014_non_reversible',
      up: async (ctx) => {
        await ctx.dropTable('nonexistent'); // dropTable 无法自动反向
      }
    }));

    // migrate 时应该抛出错误，因为 dropTable 无法自动反向
    await expect(runner.migrate()).rejects.toThrow(/Cannot auto-reverse/);
  });

  it('should use explicit down when provided', async () => {
    let downCalled = false;

    runner.add(defineMigration({
      name: '015_explicit_down',
      up: async (ctx) => {
        await ctx.createTable('explicit_down_table', {
          id: { type: 'integer', primary: true }
        });
      },
      down: async (ctx) => {
        downCalled = true;
        await ctx.dropTable('explicit_down_table');
      }
    }));

    await runner.migrate();
    await runner.rollback();

    // 验证显式 down 被调用
    expect(downCalled).toBe(true);
  });
});

// ============================================================================
// Lifecycle Hooks Tests
// ============================================================================
describe('Lifecycle Hooks', () => {
  let db: Sqlite<TestSchema>;
  let userModel: ReturnType<typeof db.model<'users'>>;

  beforeEach(async () => {
    db = new Sqlite<TestSchema>({ filename: ':memory:' });
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
    
    userModel = db.model('users', { timestamps: true });
  });

  afterEach(async () => {
    userModel.clearHooks();
    await db.stop();
  });

  it('should call beforeCreate and afterCreate hooks', async () => {
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeCreate', (ctx) => {
        hookCalls.push('beforeCreate');
        expect(ctx.data).toBeDefined();
        expect(ctx.data?.name).toBe('TestUser');
      })
      .addHook('afterCreate', (ctx) => {
        hookCalls.push('afterCreate');
        expect(ctx.result).toBeDefined();
      });
    
    const user = await userModel.create({ name: 'TestUser', email: 'test@test.com' });
    
    expect(hookCalls).toEqual(['beforeCreate', 'afterCreate']);
    expect(user).toBeDefined();
    expect(user?.name).toBe('TestUser');
  });

  it('should allow beforeCreate hook to cancel operation', async () => {
    userModel.addHook('beforeCreate', () => {
      return false; // 取消操作
    });
    
    const result = await userModel.create({ name: 'Cancelled', email: 'cancel@test.com' });
    
    expect(result).toBeNull();
    
    // 验证数据没有被插入
    const count = await userModel.count();
    expect(count).toBe(0);
  });

  it('should allow beforeCreate hook to modify data', async () => {
    userModel.addHook('beforeCreate', (ctx) => {
      if (ctx.data) {
        ctx.data.status = 'pending'; // 修改数据
        ctx.data.name = ctx.data.name?.toUpperCase();
      }
    });
    
    const user = await userModel.create({ name: 'lowercase', email: 'test@test.com' });
    
    expect(user?.name).toBe('LOWERCASE');
    expect(user?.status).toBe('pending');
  });

  it('should call beforeFind and afterFind hooks', async () => {
    // 先创建数据
    await userModel.insert({ id: 1, name: 'FindMe', email: 'find@test.com' } as any);
    
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeFind', (ctx) => {
        hookCalls.push('beforeFind');
        expect(ctx.where).toBeDefined();
      })
      .addHook('afterFind', (ctx) => {
        hookCalls.push('afterFind');
        expect(ctx.result).toBeDefined();
      });
    
    const user = await userModel.findOne({ id: 1 });
    
    expect(hookCalls).toEqual(['beforeFind', 'afterFind']);
    expect(user?.name).toBe('FindMe');
  });

  it('should allow afterFind hook to transform result', async () => {
    await userModel.insert({ id: 1, name: 'Transform', email: 'transform@test.com' } as any);
    
    userModel.addHook('afterFind', (ctx) => {
      if (ctx.result && !Array.isArray(ctx.result)) {
        (ctx.result as any).transformed = true;
      }
    });
    
    const user = await userModel.findOne({ id: 1 });
    
    expect((user as any)?.transformed).toBe(true);
  });

  it('should call beforeUpdate and afterUpdate hooks', async () => {
    await userModel.insert({ id: 1, name: 'Original', email: 'update@test.com' } as any);
    
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeUpdate', (ctx) => {
        hookCalls.push('beforeUpdate');
        expect(ctx.where).toBeDefined();
        expect(ctx.data).toBeDefined();
      })
      .addHook('afterUpdate', (ctx) => {
        hookCalls.push('afterUpdate');
        expect(ctx.result).toBeDefined();
      });
    
    await userModel.updateById(1, { name: 'Updated' });
    
    expect(hookCalls).toEqual(['beforeUpdate', 'afterUpdate']);
    
    const user = await userModel.findById(1);
    expect(user?.name).toBe('Updated');
  });

  it('should allow beforeUpdate hook to cancel operation', async () => {
    await userModel.insert({ id: 1, name: 'Protected', email: 'protect@test.com' } as any);
    
    userModel.addHook('beforeUpdate', () => {
      return false; // 取消更新
    });
    
    const result = await userModel.updateById(1, { name: 'Changed' });
    
    expect(result).toBe(false);
    
    // 验证数据没有被更新
    const user = await userModel.findById(1);
    expect(user?.name).toBe('Protected');
  });

  it('should call beforeDelete and afterDelete hooks', async () => {
    await userModel.insert({ id: 1, name: 'ToDelete', email: 'delete@test.com' } as any);
    
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeDelete', (ctx) => {
        hookCalls.push('beforeDelete');
        expect(ctx.where).toBeDefined();
      })
      .addHook('afterDelete', (ctx) => {
        hookCalls.push('afterDelete');
        expect(ctx.result).toBeDefined();
      });
    
    await userModel.deleteById(1);
    
    expect(hookCalls).toEqual(['beforeDelete', 'afterDelete']);
  });

  it('should allow beforeDelete hook to cancel operation', async () => {
    await userModel.insert({ id: 1, name: 'Protected', email: 'nodelete@test.com' } as any);
    
    userModel.addHook('beforeDelete', () => {
      return false; // 取消删除
    });
    
    const result = await userModel.deleteById(1);
    
    expect(result).toBe(false);
    
    // 验证数据没有被删除
    const user = await userModel.findById(1);
    expect(user).toBeDefined();
  });

  it('should support multiple hooks for same event', async () => {
    const order: number[] = [];
    
    userModel
      .addHook('beforeCreate', () => { order.push(1); })
      .addHook('beforeCreate', () => { order.push(2); })
      .addHook('beforeCreate', () => { order.push(3); });
    
    await userModel.create({ name: 'Multi', email: 'multi@test.com' });
    
    expect(order).toEqual([1, 2, 3]);
  });

  it('should support registerHooks for batch registration', async () => {
    const hookCalls: string[] = [];
    
    userModel.registerHooks({
      beforeCreate: (ctx) => { hookCalls.push('beforeCreate'); },
      afterCreate: [
        () => { hookCalls.push('afterCreate1'); },
        () => { hookCalls.push('afterCreate2'); }
      ]
    });
    
    await userModel.create({ name: 'Batch', email: 'batch@test.com' });
    
    expect(hookCalls).toEqual(['beforeCreate', 'afterCreate1', 'afterCreate2']);
  });

  it('should support removeHook', async () => {
    const hookCalls: string[] = [];
    const hook1 = () => { hookCalls.push('hook1'); };
    const hook2 = () => { hookCalls.push('hook2'); };
    
    userModel
      .addHook('beforeCreate', hook1)
      .addHook('beforeCreate', hook2)
      .removeHook('beforeCreate', hook1);
    
    await userModel.create({ name: 'Remove', email: 'remove@test.com' });
    
    expect(hookCalls).toEqual(['hook2']);
  });

  it('should support clearHooks', async () => {
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeCreate', () => { hookCalls.push('hook'); })
      .clearHooks();
    
    await userModel.create({ name: 'Clear', email: 'clear@test.com' });
    
    expect(hookCalls).toEqual([]);
  });

  it('should support async hooks', async () => {
    const hookCalls: string[] = [];
    
    userModel.addHook('beforeCreate', async (ctx) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      hookCalls.push('asyncHook');
    });
    
    await userModel.create({ name: 'Async', email: 'async@test.com' });
    
    expect(hookCalls).toEqual(['asyncHook']);
  });

  it('should work with findAll hook', async () => {
    await userModel.insertMany([
      { id: 1, name: 'User1', email: 'u1@test.com' },
      { id: 2, name: 'User2', email: 'u2@test.com' }
    ] as any);
    
    const hookCalls: string[] = [];
    
    userModel
      .addHook('beforeFind', () => { hookCalls.push('beforeFind'); })
      .addHook('afterFind', (ctx) => {
        hookCalls.push('afterFind');
        expect(Array.isArray(ctx.result)).toBe(true);
        expect((ctx.result as any[]).length).toBe(2);
      });
    
    const users = await userModel.findAll();
    
    expect(hookCalls).toEqual(['beforeFind', 'afterFind']);
    expect(users.length).toBe(2);
  });
});

// ============================================================================
// Many-to-Many (belongsToMany) Tests
// ============================================================================
describe('Many-to-Many Relations (belongsToMany)', () => {
  let db: Sqlite<TestSchema & {
    roles: { id: number; name: string };
    user_roles: { user_id: number; role_id: number; assigned_at: string };
    tags: { id: number; name: string };
    post_tags: { post_id: number; tag_id: number; sort_order: number };
    posts: { id: number; title: string; userId: number };
  }>;

  beforeAll(async () => {
    db = new Sqlite({ filename: ':memory:' });
    await db.start();

    // 创建用户表
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT
      )
    `);

    // 创建角色表
    await db.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);

    // 创建用户-角色中间表
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, role_id)
      )
    `);

    // 创建文章表
    await db.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        userId INTEGER
      )
    `);

    // 创建标签表
    await db.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);

    // 创建文章-标签中间表
    await db.query(`
      CREATE TABLE IF NOT EXISTS post_tags (
        post_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY (post_id, tag_id)
      )
    `);
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    // 清空数据
    await db.query('DELETE FROM user_roles');
    await db.query('DELETE FROM post_tags');
    await db.query('DELETE FROM users');
    await db.query('DELETE FROM roles');
    await db.query('DELETE FROM posts');
    await db.query('DELETE FROM tags');
  });

  it('should define belongsToMany relation', async () => {
    const userModel = db.model('users');
    const roleModel = db.model('roles');

    // 定义多对多关系
    userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');

    // 验证关系已定义
    const relation = userModel.getRelation('roles');
    expect(relation).toBeDefined();
    expect(relation?.type).toBe('belongsToMany');
    expect(relation?.pivot?.table).toBe('user_roles');
  });

  it('should load many-to-many relation for single record', async () => {
    // 插入测试数据
    await db.query("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    await db.query("INSERT INTO roles (id, name) VALUES (1, 'admin'), (2, 'editor')");
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (1, 1), (1, 2)");

    const userModel = db.model('users');
    const roleModel = db.model('roles');
    userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');

    // 获取用户并加载角色
    const user = await userModel.findById(1);
    expect(user).toBeDefined();

    const userWithRoles = await userModel.loadRelation(user!, 'roles');
    
    expect(userWithRoles.roles).toBeDefined();
    const roles = userWithRoles.roles as any[];
    expect(roles).toHaveLength(2);
    expect(roles.map(r => r.name)).toContain('admin');
    expect(roles.map(r => r.name)).toContain('editor');
  });

  it('should load many-to-many relation with pivot data', async () => {
    // 插入测试数据
    await db.query("INSERT INTO posts (id, title) VALUES (1, 'Post 1')");
    await db.query("INSERT INTO tags (id, name) VALUES (1, 'TypeScript'), (2, 'JavaScript')");
    await db.query("INSERT INTO post_tags (post_id, tag_id, sort_order) VALUES (1, 1, 10), (1, 2, 20)");

    const postModel = db.model('posts');
    const tagModel = db.model('tags');
    
    // 定义关系，包含 pivot 字段
    postModel.belongsToMany(tagModel, 'post_tags', 'post_id', 'tag_id', 'id', 'id', ['sort_order']);

    const post = await postModel.findById(1);
    const postWithTags = await postModel.loadRelation(post!, 'tags');

    const tags = postWithTags.tags as any[];
    expect(tags).toHaveLength(2);
    // 验证 pivot 数据
    const tsTag = tags.find(t => t.name === 'TypeScript');
    expect(tsTag?.pivot?.sort_order).toBe(10);
  });

  it('should batch load many-to-many relations (with())', async () => {
    // 插入测试数据
    await db.query("INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob')");
    await db.query("INSERT INTO roles (id, name) VALUES (1, 'admin'), (2, 'editor'), (3, 'viewer')");
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (1, 1), (1, 2), (2, 2), (2, 3)");

    const userModel = db.model('users');
    const roleModel = db.model('roles');
    userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');

    // 使用 with() 批量加载
    const usersWithRoles = await userModel.with('roles');

    expect(usersWithRoles).toHaveLength(2);
    
    const alice = usersWithRoles.find((u: any) => u.name === 'Alice');
    const bob = usersWithRoles.find((u: any) => u.name === 'Bob');

    expect(alice?.roles).toHaveLength(2);
    expect(bob?.roles).toHaveLength(2);
  });

  it('should support bidirectional many-to-many', async () => {
    // 插入测试数据
    await db.query("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    await db.query("INSERT INTO roles (id, name) VALUES (1, 'admin')");
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (1, 1)");

    const userModel = db.model('users');
    const roleModel = db.model('roles');

    // 双向关系定义
    userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');
    roleModel.belongsToMany(userModel, 'user_roles', 'role_id', 'user_id');

    // 从用户侧查询
    const user = await userModel.findById(1);
    const userWithRoles = await userModel.loadRelation(user!, 'roles');
    const roles = userWithRoles.roles as any[];
    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('admin');

    // 从角色侧查询
    const role = await roleModel.findById(1);
    const roleWithUsers = await roleModel.loadRelation(role!, 'users');
    const users = roleWithUsers.users as any[];
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Alice');
  });

  it('should return empty array for records without relations', async () => {
    await db.query("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    // 不插入 user_roles

    const userModel = db.model('users');
    const roleModel = db.model('roles');
    userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');

    const user = await userModel.findById(1);
    const userWithRoles = await userModel.loadRelation(user!, 'roles');

    expect(userWithRoles.roles).toEqual([]);
  });

  it('should support schema-based belongsToMany definition', async () => {
    // 创建新的数据库实例
    const db2 = new Sqlite({ filename: ':memory:' });
    await db2.start();
    
    // 创建表
    await db2.query(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    await db2.query(`CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT)`);
    await db2.query(`CREATE TABLE user_roles (user_id INTEGER, role_id INTEGER)`);
    
    // 插入数据
    await db2.query("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    await db2.query("INSERT INTO roles (id, name) VALUES (1, 'admin')");
    await db2.query("INSERT INTO user_roles (user_id, role_id) VALUES (1, 1)");

    // 使用 schema 定义关系
    db2.defineRelations({
      users: {
        belongsToMany: {
          roles: {
            pivot: 'user_roles',
            foreignKey: 'user_id',
            relatedKey: 'role_id'
          }
        }
      }
    } as any);

    const userModel = db2.model('users');
    const usersWithRoles = await userModel.with('roles');

    expect(usersWithRoles).toHaveLength(1);
    expect(usersWithRoles[0].roles).toHaveLength(1);

    await db2.stop();
  });
});

