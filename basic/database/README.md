# @zhin.js/database

Universal database abstraction layer for Zhin.js framework with support for multiple database backends.

## Installation

```bash
npm install @zhin.js/database
```

Install the database driver you need:

```bash
# For SQLite
npm install sqlite3

# For MySQL
npm install mysql2

# For PostgreSQL
npm install pg

# For MongoDB
npm install mongodb

# For Redis
npm install redis
```

## Quick Start

```typescript
import { Registry } from '@zhin.js/database';

// 创建数据库实例（以 SQLite 为例）
const db = Registry.create('sqlite', {
  filename: './database.sqlite'
}, {
  users: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string', nullable: false },
    email: { type: 'string', unique: true }
  }
});

await db.start();

// 使用模型进行 CRUD 操作
const userModel = db.model('users');
const user = await userModel.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

## Supported Databases

### ✅ Relational Databases (已完整实现)
- **SQLite** - 内置支持，需要安装 `sqlite3`
  - 轻量级、零配置
  - 适合中小型应用
  - 支持 WAL 模式
  
- **MySQL** - 内置支持，需要安装 `mysql2`
  - 完整的关系型数据库特性
  - 高性能、可扩展
  - 广泛使用

- **PostgreSQL** - 内置支持，需要安装 `pg`
  - 强大的企业级数据库
  - 支持高级 SQL 特性
  - JSON 支持

### ✅ NoSQL Databases (已完整实现)
- **MongoDB** - 内置支持，需要安装 `mongodb`
  - 文档型数据库
  - 灵活的 Schema
  - 适合非结构化数据

- **Redis** - 内置支持，需要安装 `redis`
  - 键值存储
  - 高性能缓存
  - 支持多种数据结构

### ✅ In-Memory Database (已完整实现)
- **Memory** - 内置支持，无需额外安装
  - 完全在内存中运行
  - 适合测试和临时数据
  - 零配置

## Usage Examples

### SQLite Example

```typescript
import { Registry } from '@zhin.js/database';

const db = Registry.create('sqlite', {
  filename: './data/bot.db',
  mode: 'wal' // Write-Ahead Logging 模式
}, {
  users: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string', nullable: false },
    createdAt: { type: 'timestamp', default: 'CURRENT_TIMESTAMP' }
  }
});

await db.start();
```

### MySQL Example

```typescript
const db = Registry.create('mysql', {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'myapp'
}, schemas);

await db.start();
```

### PostgreSQL Example

```typescript
const db = Registry.create('pg', {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'myapp'
}, schemas);

await db.start();
```

### MongoDB Example

```typescript
const db = Registry.create('mongodb', {
  url: 'mongodb://localhost:27017',
  dbName: 'myapp'
}, schemas);

await db.start();
```

### Redis Example

```typescript
const db = Registry.create('redis', {
  socket: {
    host: 'localhost',
    port: 6379
  }
}, schemas);

await db.start();
```

### Memory Example (for Testing)

```typescript
const db = Registry.create('memory', {}, schemas);
await db.start();
```

## Database Types

### RelatedDatabase
适用于关系型数据库 (SQLite, MySQL, PostgreSQL)
- 支持 SQL 查询
- 支持事务
- 支持索引和约束

### DocumentDatabase
适用于文档型数据库 (MongoDB)
- 灵活的 Schema
- 支持嵌套文档
- 支持丰富的查询操作

### KeyValueDatabase
适用于键值存储 (Redis)
- 高性能读写
- 支持多种数据结构
- 支持过期时间

## Features

### ✨ 核心特性
- **🎯 类型安全**: 完整的 TypeScript 类型支持
- **🔄 统一 API**: 所有数据库类型使用相同的接口
- **🔍 查询构建器**: 流畅的链式查询 API
- **📋 Schema 管理**: 自动创建表/集合
- **🔌 连接管理**: 自动处理连接和重连
- **💾 事务支持**: 内置事务支持（关系型数据库）
- **🔄 迁移支持**: Schema 演进和版本管理

### 📦 开箱即用
- 无需额外配置即可使用
- 自动检测并安装相应的数据库驱动
- 完整的错误处理和日志记录

### 🚀 高性能
- 连接池管理
- 查询优化
- 批量操作支持

## Model API

```typescript
const model = db.model('users');

// Create
const user = await model.create({ name: 'John', email: 'john@example.com' });

// Read
const users = await model.find({ name: 'John' });
const user = await model.findOne({ email: 'john@example.com' });

// Update
await model.update({ name: 'John' }, { name: 'Jane' });

// Delete
await model.remove({ name: 'Jane' });

// Count
const count = await model.count({ email: { $like: '%@example.com' } });

// Pagination
const result = await model.find({}, { limit: 10, offset: 0 });
```

## 链式查询 API (Fluent Query Builder)

链式查询提供了一种流畅、类型安全的方式来构建数据库查询。所有查询都是 **Thenable** 的，可以直接使用 `await` 或 `.then()` 执行。

### 基本用法

```typescript
// 从数据库实例使用 - select(表名, 字段数组)
const users = await db
  .select('users', ['id', 'name', 'email'])
  .where({ status: 'active' })
  .orderBy('createdAt', 'DESC')
  .limit(10);

// 从模型实例使用 - select(...字段) 展开参数
const model = db.model('users');
const users = await model
  .select('id', 'name', 'email')  // 展开参数，不是数组
  .where({ status: 'active' })
  .orderBy('createdAt', 'DESC')
  .limit(10);

// 选择所有字段
const allUsers = await model.select();
```

### Select 查询

```typescript
// 从数据库实例：select(表名, 字段数组)
const users = await db
  .select('users', ['id', 'name', 'email'])
  .where({ age: { $gte: 18 } })
  .groupBy('department')
  .orderBy('name', 'ASC')
  .limit(20)
  .offset(0);

// 从模型实例：select(...字段) 
const model = db.model('users');
const users = await model
  .select('id', 'name', 'email')  // 展开参数
  .where({ age: { $gte: 18 } })
  .groupBy('department')
  .orderBy('name', 'ASC')
  .limit(20)
  .offset(0);

// 链式方法说明
// .where(condition)    - 添加查询条件
// .groupBy(...fields)  - 分组字段
// .orderBy(field, dir) - 排序（ASC/DESC）
// .limit(count)        - 限制返回数量
// .offset(count)       - 跳过指定数量
```

### Insert 插入

```typescript
// 从数据库实例
const newUser = await db.insert('users', {
  name: 'Alice',
  email: 'alice@example.com',
  age: 25
});

// 从模型实例
const model = db.model('users');
const newUser = await model.insert({
  name: 'Alice',
  email: 'alice@example.com',
  age: 25
});
```

### Update 更新

```typescript
// 从数据库实例：update(表名, 更新数据).where(条件)
const affectedRows = await db
  .update('users', { status: 'inactive' })
  .where({ lastLogin: { $lt: new Date('2024-01-01') } });

// 从模型实例：update(更新数据).where(条件)
const model = db.model('users');
const count = await model
  .update({ verified: true })
  .where({ 
    email: { $like: '%@company.com' },
    status: 'pending'
  });
```

### Delete 删除

```typescript
// 从数据库实例：delete(表名, 初始条件).where(额外条件)
const deletedUsers = await db
  .delete('users', { status: 'deleted' })
  .where({ deletedAt: { $lt: new Date('2023-01-01') } });

// 从模型实例：delete(条件)
const model = db.model('users');
const deleted = await model.delete({ status: 'banned' });
```

### Alter 修改表结构

```typescript
// 从数据库实例
await db.alter('users', {
  avatar: { action: 'add', type: 'string', nullable: true },
  oldField: { action: 'drop' },
  name: { action: 'modify', type: 'string', nullable: false }
});

// 从模型实例
const model = db.model('users');
await model.alter({
  newColumn: { action: 'add', type: 'integer', default: 0 }
});
```

### 模型便捷方法 (RelatedModel)

关系型模型提供了更便捷的高级方法：

```typescript
const model = db.model('users'); // RelatedModel

// create - 创建单条数据
const user = await model.create({ name: 'John', email: 'john@example.com' });

// createMany - 批量创建
const users = await model.createMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
]);

// selectOne - 查找单条数据
const user = await model.selectOne({ email: 'john@example.com' });

// selectById - 根据 ID 查找
const user = await model.selectById(1);

// updateOne - 更新单条数据
const success = await model.updateOne({ id: 1 }, { name: 'Jane' });

// updateById - 根据 ID 更新
const success = await model.updateById(1, { status: 'active' });

// deleteById - 根据 ID 删除
const success = await model.deleteById(1);

// count - 统计数量
const total = await model.count({ status: 'active' });
```

### 文档模型便捷方法 (DocumentModel)

文档型模型（MongoDB）的特有方法：

```typescript
const model = db.model('users'); // DocumentModel

// create - 创建文档（自动生成 _id）
const user = await model.create({ name: 'John', email: 'john@example.com' });
// 返回: { name: 'John', email: '...', _id: 'abc123...' }

// 批量创建
const users = await model.create([
  { name: 'Alice' },
  { name: 'Bob' }
]);

// selectOne - 查找单个文档
const user = await model.selectOne('name', 'email');

// selectById - 根据 _id 查找
const user = await model.selectById('abc123...');

// updateById - 根据 _id 更新
await model.updateById('abc123...', { name: 'Jane' });

// deleteById - 根据 _id 删除
await model.deleteById('abc123...');
```

### 键值模型方法 (KeyValueModel)

键值存储（Redis）的特有方法：

```typescript
const model = db.model('cache'); // KeyValueModel

// set/get - 基本键值操作
await model.set('user:1', { name: 'John', age: 25 });
const user = await model.get('user:1');

// 带过期时间（秒）
await model.set('session:abc', { userId: 1 }, 3600); // 1小时后过期

// has - 检查键是否存在
const exists = await model.has('user:1');

// deleteByKey - 删除键
await model.deleteByKey('user:1');

// keys/values/entries - 遍历
const allKeys = await model.keys();
const allValues = await model.values();
const allEntries = await model.entries();

// 模式匹配查找
const userKeys = await model.keysByPattern('user:*');

// TTL 操作
await model.expire('session:abc', 1800);  // 设置过期时间
const ttl = await model.ttl('session:abc'); // 获取剩余时间
await model.persist('session:abc');         // 移除过期时间

// 原子操作
await model.setIfNotExists('lock:resource', 'locked', 30);
await model.setIfExists('counter', newValue);
const oldValue = await model.getAndSet('key', newValue);
const value = await model.deleteAndGet('key');

// 批量操作
await model.setMany([['key1', 'value1'], ['key2', 'value2']], 3600);

// 清理
await model.clear();     // 清空所有键
await model.cleanup();   // 清理过期键
const size = await model.size(); // 获取键数量
```

### 条件操作符

#### 比较操作符

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `$eq` | 等于 | `{ age: { $eq: 18 } }` |
| `$ne` | 不等于 | `{ status: { $ne: 'deleted' } }` |
| `$gt` | 大于 | `{ age: { $gt: 18 } }` |
| `$gte` | 大于等于 | `{ age: { $gte: 18 } }` |
| `$lt` | 小于 | `{ age: { $lt: 65 } }` |
| `$lte` | 小于等于 | `{ age: { $lte: 65 } }` |
| `$in` | 在列表中 | `{ role: { $in: ['admin', 'mod'] } }` |
| `$nin` | 不在列表中 | `{ status: { $nin: ['banned', 'deleted'] } }` |
| `$like` | 模糊匹配 | `{ email: { $like: '%@gmail.com' } }` |
| `$nlike` | 不匹配 | `{ name: { $nlike: 'test%' } }` |

#### 逻辑操作符

```typescript
// $and - 逻辑与
const users = await model
  .select('id', 'name')
  .where({
    $and: [
      { age: { $gte: 18 } },
      { status: 'active' }
    ]
  });

// $or - 逻辑或
const users = await model
  .select('id', 'name')
  .where({
    $or: [
      { role: 'admin' },
      { role: 'moderator' }
    ]
  });

// $not - 逻辑非
const users = await model
  .select('id', 'name')
  .where({
    $not: { status: 'banned' }
  });

// 组合使用
const users = await model
  .select('id', 'name', 'email')
  .where({
    $and: [
      { age: { $gte: 18, $lte: 65 } },
      {
        $or: [
          { role: 'admin' },
          { verified: true }
        ]
      }
    ]
  });
```

### Thenable 特性

所有查询对象都实现了 `PromiseLike` 接口，支持多种异步调用方式：

```typescript
// 使用 await
const users = await model.select('id', 'name').where({ active: true });

// 使用 .then()
model.select('id', 'name')
  .where({ active: true })
  .then(users => console.log(users));

// 使用 .catch() 处理错误
model.select('id', 'name')
  .where({ active: true })
  .catch(err => console.error(err));

// 使用 .finally()
model.select('id', 'name')
  .where({ active: true })
  .finally(() => console.log('Query completed'));

// 异步迭代器
for await (const user of model.select('id', 'name').where({ active: true })) {
  console.log(user);
}
```

### 完整示例

```typescript
import { Registry } from '@zhin.js/database';

// 创建数据库
const db = Registry.create('sqlite', { filename: './app.db' }, {
  users: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string', nullable: false },
    email: { type: 'string', unique: true },
    age: { type: 'integer' },
    role: { type: 'string', default: 'user' },
    status: { type: 'string', default: 'active' },
    createdAt: { type: 'timestamp', default: 'CURRENT_TIMESTAMP' }
  }
});

await db.start();

// 获取模型
const userModel = db.model('users');

// 使用便捷方法创建数据
const user = await userModel.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 28,
  role: 'admin'
});

// 使用链式查询
const activeAdmins = await userModel
  .select('id', 'name', 'email')
  .where({
    $and: [
      { role: { $in: ['admin', 'moderator'] } },
      { status: 'active' },
      { age: { $gte: 21 } }
    ]
  })
  .orderBy('name', 'ASC')
  .limit(10);

// 使用便捷方法更新
await userModel.updateOne(
  { role: 'guest', createdAt: { $lt: new Date('2024-01-01') } },
  { status: 'inactive' }
);

// 或使用链式更新
await userModel
  .update({ status: 'inactive' })
  .where({ role: 'guest' });

// 使用便捷方法删除
await userModel.deleteById(1);

// 或使用链式删除
await userModel.delete({ status: 'banned' });

// 统计
const count = await userModel.count({ status: 'active' });
console.log(`Active users: ${count}`);
```

## 高级功能

### 聚合查询

支持 COUNT, SUM, AVG, MIN, MAX 等聚合函数：

```typescript
// 基本聚合
const result = await db.aggregate('orders')
  .count('*', 'total_orders')
  .sum('amount', 'total_amount')
  .avg('amount', 'avg_amount')
  .max('amount', 'max_amount')
  .min('amount', 'min_amount');

// 带条件和分组
const stats = await model.aggregate()
  .count('*', 'count')
  .sum('amount', 'total')
  .where({ status: 'completed' })
  .groupBy('category')
  .having({ count: { $gt: 10 } });

// 结果示例
// [
//   { category: 'electronics', count: 150, total: 50000 },
//   { category: 'clothing', count: 80, total: 12000 }
// ]
```

### 批量插入

高效的批量插入，生成单条 SQL 语句：

```typescript
// 批量插入多条记录
const result = await db.insertMany('users', [
  { name: 'Alice', email: 'alice@example.com', age: 25 },
  { name: 'Bob', email: 'bob@example.com', age: 30 },
  { name: 'Charlie', email: 'charlie@example.com', age: 35 }
]);

// 从 Model 调用
await model.insertMany([
  { name: 'User1', status: 'active' },
  { name: 'User2', status: 'active' },
  { name: 'User3', status: 'pending' }
]);
// 返回: { affectedRows: 3, insertIds: [...] }
```

### 事务支持

支持 SQLite, MySQL, PostgreSQL 的事务操作，**支持链式调用**：

```typescript
await db.transaction(async (trx) => {
  // 插入
  await trx.insert('orders', { userId, amount: 100 });
  
  // 更新（支持链式 where）
  await trx.update('accounts', { balance: newBalance })
    .where({ userId });
  
  // 查询（支持链式 where/orderBy/limit/offset）
  const user = await trx.select('users', ['id', 'name'])
    .where({ id: userId })
    .orderBy('createdAt', 'DESC')
    .limit(10);
  
  // 删除（支持链式 where）
  await trx.delete('temp_data')
    .where({ expired: true });
  
  // 批量插入
  await trx.insertMany('logs', [
    { message: 'Order created', userId },
    { message: 'Balance updated', userId }
  ]);
  
  // 也支持原生 SQL
  await trx.query('UPDATE stats SET count = count + 1 WHERE type = ?', ['orders']);
  
  // 如果所有操作成功，自动 commit
  // 如果任何操作失败，自动 rollback
}, {
  isolationLevel: 'REPEATABLE_READ'  // 可选: READ_UNCOMMITTED, READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
});
```

**事务中支持的链式方法：**

| 方法 | 说明 | 链式方法 |
|------|------|----------|
| `trx.insert(table, data)` | 插入单条 | - |
| `trx.insertMany(table, data[])` | 批量插入 | - |
| `trx.select(table, fields)` | 查询 | `.where()`, `.orderBy()`, `.limit()`, `.offset()` |
| `trx.update(table, data)` | 更新 | `.where()` |
| `trx.delete(table)` | 删除 | `.where()` |
| `trx.query(sql, params)` | 原生 SQL | - |

### JOIN 关联查询

支持 `INNER JOIN`、`LEFT JOIN`、`RIGHT JOIN`，**返回类型自动推断**：

```typescript
interface Schema {
  users: { id: number; name: string; status: string };
  orders: { id: number; userId: number; amount: number };
}

// INNER JOIN - 返回类型自动扩展
const result = await db.select('users', ['id', 'name'])
  .join('orders', 'id', 'userId')
  .where({ status: 'active' });

// ✅ 类型推断正确！
// result 类型: { users: { id: number; name: string }, orders: { id: number; userId: number; amount: number } }[]
result[0].users.id;      // number ✅
result[0].users.name;    // string ✅
result[0].orders.amount; // number ✅

// LEFT JOIN - 右表可能为 null
const leftResult = await db.select('users', ['id', 'name'])
  .leftJoin('orders', 'id', 'userId');
// leftResult 类型: { users: {...}, orders: {...} | null }[]
leftResult[0].orders?.amount;  // number | undefined ✅

// RIGHT JOIN - 左表可能为 null  
const rightResult = await db.select('users', ['id', 'name'])
  .rightJoin('orders', 'id', 'userId');
// rightResult 类型: { users: Partial<...>, orders: {...} }[]

// 多表 JOIN - 链式调用
const multiJoin = await db.select('orders', ['id', 'amount'])
  .join('users', 'userId', 'id')
  .leftJoin('products', 'productId', 'id')
  .where({ amount: { $gt: 100 } });
```

**JOIN 方法：**

| 方法 | SQL | 返回类型 |
|------|-----|----------|
| `.join(table, left, right)` | `INNER JOIN` | `{ 主表: {...}, 关联表: {...} }` |
| `.leftJoin(table, left, right)` | `LEFT JOIN` | `{ 主表: {...}, 关联表: {...} \| null }` |
| `.rightJoin(table, left, right)` | `RIGHT JOIN` | `{ 主表: Partial<...>, 关联表: {...} }` |

### 软删除

启用软删除后，`delete()` 不会物理删除数据，而是设置 `deletedAt` 字段：

```typescript
import { RelatedModel } from '@zhin.js/database';

// 创建带软删除的模型
const userModel = new RelatedModel(db, 'users', { 
  softDelete: true,
  deletedAtField: 'deletedAt'  // 可选，默认 'deletedAt'
});

// 删除 → 实际执行: UPDATE users SET deletedAt = NOW() WHERE id = 1
await userModel.delete({ id: 1 });

// 普通查询 → 自动排除已删除: SELECT * FROM users WHERE deletedAt IS NULL
const activeUsers = await userModel.select('id', 'name');

// 查询包含已删除的记录
const allUsers = await userModel.selectWithTrashed('id', 'name');

// 仅查询已删除的记录
const deletedUsers = await userModel.selectOnlyTrashed('id', 'name');

// 恢复已删除的记录 → UPDATE users SET deletedAt = NULL WHERE id = 1
await userModel.restore({ id: 1 });

// 强制物理删除（忽略软删除设置）
await userModel.forceDelete({ id: 1 });
```

**软删除方法：**

| 方法 | 说明 |
|------|------|
| `model.delete(condition)` | 软删除（设置 deletedAt） |
| `model.select(...)` | 自动排除已删除 |
| `model.selectWithTrashed(...)` | 包含已删除 |
| `model.selectOnlyTrashed(...)` | 仅已删除 |
| `model.restore(condition)` | 恢复软删除 |
| `model.forceDelete(condition)` | 物理删除 |

### 自动时间戳

启用后自动管理 `createdAt` 和 `updatedAt` 字段：

```typescript
const userModel = new RelatedModel(db, 'users', { 
  timestamps: true,
  createdAtField: 'createdAt',  // 可选
  updatedAtField: 'updatedAt'   // 可选
});

// 插入时自动设置 createdAt 和 updatedAt
await userModel.insert({ name: 'John' });
// INSERT INTO users (name, createdAt, updatedAt) VALUES ('John', NOW(), NOW())

// 更新时自动更新 updatedAt
await userModel.update({ name: 'Jane' }).where({ id: 1 });
// UPDATE users SET name = 'Jane', updatedAt = NOW() WHERE id = 1
```

### 子查询

支持在 `$in` 和 `$nin` 操作符中使用子查询，**带完整类型推断**：

```typescript
interface Schema {
  users: { id: number; name: string; status: string };
  orders: { id: number; userId: number; amount: number };
}

// 查询购买过高价商品的用户
const users = await db.select('users', ['id', 'name'])
  .where({
    id: {
      $in: db.select('orders', ['userId']).where({ amount: { $gt: 1000 } })
    }
  });
// SQL: SELECT id, name FROM users WHERE id IN (SELECT userId FROM orders WHERE amount > 1000)

// 查询没有下过订单的用户
const inactiveUsers = await db.select('users', ['id', 'name'])
  .where({
    id: {
      $nin: db.select('orders', ['userId'])
    }
  });
// SQL: SELECT id, name FROM users WHERE id NOT IN (SELECT userId FROM orders)

// ✅ 类型安全：子查询返回类型必须与字段类型匹配
db.select('users', ['id']).where({
  id: { $in: db.select('orders', ['userId']) }  // ✅ number 匹配 number
});

db.select('users', ['id']).where({
  id: { $in: db.select('users', ['name']) }     // ❌ 类型错误！string 不能匹配 number
});
```

### 查询日志

启用查询日志，方便调试和性能分析：

```typescript
// 启用默认日志（输出到控制台）
db.enableLogging();

// 执行查询时自动输出日志
await db.select('users', ['id', 'name']).where({ status: 'active' });
// [SQL] SELECT id, name FROM users WHERE status = ? ["active"] → ✅ 3ms

await db.insert('logs', { message: 'test' });
// [SQL] INSERT INTO logs (message) VALUES (?) ["test"] → ✅ 1ms

// 错误时也会记录
await db.query('SELECT * FROM not_exist');
// [SQL] SELECT * FROM not_exist → ❌ ERROR: no such table: not_exist

// 自定义日志处理器
db.enableLogging(({ sql, params, duration, error }) => {
  if (error) {
    logger.error(`Query failed: ${sql}`, { params, error });
  } else if (duration > 100) {
    logger.warn(`Slow query: ${sql}`, { params, duration });
  } else {
    logger.debug(`Query: ${sql}`, { params, duration });
  }
});

// 禁用日志
db.disableLogging();

// 检查日志状态
if (db.isLogging) {
  console.log('Query logging is enabled');
}
```

### 连接池

MySQL 和 PostgreSQL 支持连接池，提高高并发场景下的性能：

```typescript
// MySQL 连接池配置
const db = Registry.create('mysql', {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'myapp',
  pool: {
    min: 2,                    // 最小连接数
    max: 10,                   // 最大连接数
    idleTimeoutMillis: 30000,  // 空闲连接超时（毫秒）
    acquireTimeoutMillis: 10000 // 获取连接超时（毫秒）
  }
}, schemas);

// PostgreSQL 连接池配置
const db = Registry.create('pg', {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'myapp',
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 10000
  }
}, schemas);

await db.start();

// 连接池模式下的事务会自动获取专用连接
await db.transaction(async (trx) => {
  // 这个事务使用连接池中的一个专用连接
  await trx.query('...');
});
// 事务结束后连接自动归还到池中
```

**连接池 vs 单连接:**

| 特性 | 单连接 | 连接池 |
|------|--------|--------|
| 适用场景 | 低并发、简单应用 | 高并发、生产环境 |
| 连接数 | 1 | 可配置 (min-max) |
| 事务隔离 | 自然隔离 | 自动获取专用连接 |
| 资源利用 | 简单 | 高效复用 |

## 关联关系 (Relations)

支持定义和查询模型之间的关联关系，解决 N+1 查询问题。

### 方式一：预定义关系配置（推荐）

类似 Sequelize，在数据库层面一次性定义所有关系：

```typescript
const db = Registry.create<MySchema, 'sqlite'>('sqlite', { filename: ':memory:' });

// 预定义关系配置
db.defineRelations({
  users: {
    hasMany: { orders: 'userId', posts: 'authorId' },
    hasOne: { profile: 'userId' }
  },
  orders: {
    belongsTo: { users: 'userId' }
  },
  posts: {
    belongsTo: { users: 'authorId' }
  }
});

// 获取模型时自动应用关系，无需手动调用 hasMany/belongsTo
const userModel = db.model('users');
const usersWithOrders = await userModel.with('orders', 'profile');
```

### 方式二：模型实例定义关系

```typescript
const userModel = db.model('users');
const orderModel = db.model('orders');
const profileModel = db.model('profiles');

// 一对多: User hasMany Orders (orders.userId -> users.id)
userModel.hasMany(orderModel, 'userId');

// 多对一: Order belongsTo User (orders.userId -> users.id)
orderModel.belongsTo(userModel, 'userId');

// 一对一: User hasOne Profile (profiles.userId -> users.id)
userModel.hasOne(profileModel, 'userId');
```

**类型安全**：传入模型实例而不是字符串，确保外键字段名正确：
```typescript
// ✅ 类型检查通过
orderModel.belongsTo(userModel, 'userId');

// ❌ 类型错误：'wrongKey' 不存在于 orders 表
orderModel.belongsTo(userModel, 'wrongKey');
```

### 加载单条记录的关联

```typescript
const user = await userModel.selectById(1);
const userWithOrders = await userModel.loadRelation(user, 'orders');

console.log(userWithOrders.orders); 
// [{ id: 1, productName: 'A' }, { id: 2, productName: 'B' }]
```

### 批量预加载（解决 N+1）

```typescript
const users = await userModel.select();
const usersWithOrders = await userModel.loadRelations(users, ['orders']);

// 只执行 2 次查询：
// 1. SELECT * FROM users
// 2. SELECT * FROM orders WHERE userId IN (1, 2, 3...)
```

### 链式调用 `.with()`

```typescript
const usersWithOrders = await userModel.with('orders')
  .where({ status: 'active' })
  .orderBy('id', 'ASC')
  .limit(10);

// 每个 user 都自动带有 orders 数组
usersWithOrders.forEach(user => {
  console.log(`${user.name} has ${user.orders.length} orders`);
});
```

### 关系类型

| 方法 | 描述 | 返回值 |
|------|------|--------|
| `hasMany(targetModel, foreignKey)` | 一对多 | `T[]` |
| `belongsTo(targetModel, foreignKey)` | 多对一 | `T \| null` |
| `hasOne(targetModel, foreignKey)` | 一对一 | `T \| null` |
| `belongsToMany(targetModel, pivot, fk, rk)` | 多对多 | `T[]` |

### 多对多关系 (belongsToMany)

多对多关系需要一个中间表（pivot table）来存储两个表之间的关联。

#### 基本用法

```typescript
const userModel = db.model('users');
const roleModel = db.model('roles');

// User belongsToMany Roles (通过 user_roles 中间表)
// user_roles 表结构: { user_id, role_id }
userModel.belongsToMany(
  roleModel,           // 目标模型
  'user_roles',        // 中间表名
  'user_id',           // 中间表中指向本表的外键
  'role_id'            // 中间表中指向目标表的外键
);

// 双向关系
roleModel.belongsToMany(userModel, 'user_roles', 'role_id', 'user_id');
```

#### 加载关联数据

```typescript
// 单条记录加载
const user = await userModel.findById(1);
const userWithRoles = await userModel.loadRelation(user, 'roles');
console.log(userWithRoles.roles); // [{ id: 1, name: 'admin' }, { id: 2, name: 'editor' }]

// 批量加载（with）
const usersWithRoles = await userModel.with('roles');
usersWithRoles.forEach(user => {
  console.log(`${user.name} has roles: ${user.roles.map(r => r.name).join(', ')}`);
});
```

#### 访问中间表数据

如果中间表有额外字段（如 `created_at`、`sort_order` 等），可以通过 `pivotFields` 参数获取：

```typescript
// 中间表: post_tags { post_id, tag_id, sort_order }
postModel.belongsToMany(
  tagModel,
  'post_tags',
  'post_id',
  'tag_id',
  'id',              // 本表主键
  'id',              // 目标表主键
  ['sort_order']     // 需要获取的中间表字段
);

const postWithTags = await postModel.loadRelation(post, 'tags');
postWithTags.tags.forEach(tag => {
  console.log(`${tag.name} - sort: ${tag.pivot.sort_order}`);
});
```

#### Schema 预定义多对多关系

```typescript
db.defineRelations({
  users: {
    belongsToMany: {
      roles: {
        pivot: 'user_roles',
        foreignKey: 'user_id',
        relatedKey: 'role_id',
        pivotFields: ['assigned_at']  // 可选
      }
    }
  },
  roles: {
    belongsToMany: {
      users: {
        pivot: 'user_roles',
        foreignKey: 'role_id',
        relatedKey: 'user_id'
      }
    }
  }
});
```

## 生命周期钩子 (Lifecycle Hooks)

在 CRUD 操作的关键节点执行自定义逻辑。

### 支持的钩子

| 钩子名称 | 触发时机 | 可取消操作 |
|---------|---------|-----------|
| `beforeCreate` | 创建前 | ✅ 返回 `false` |
| `afterCreate` | 创建后 | - |
| `beforeFind` | 查询前 | ✅ 返回 `false` |
| `afterFind` | 查询后 | - |
| `beforeUpdate` | 更新前 | ✅ 返回 `false` |
| `afterUpdate` | 更新后 | - |
| `beforeDelete` | 删除前 | ✅ 返回 `false` |
| `afterDelete` | 删除后 | - |

### 注册钩子

```typescript
const userModel = db.model('users');

// 方式一：addHook（链式调用）
userModel
  .addHook('beforeCreate', (ctx) => {
    // 自动生成 slug
    ctx.data.slug = slugify(ctx.data.name);
  })
  .addHook('afterCreate', async (ctx) => {
    // 记录日志
    await logService.log('User created', ctx.result);
  });

// 方式二：on（别名）
userModel.on('beforeDelete', (ctx) => {
  console.log('About to delete:', ctx.where);
});

// 方式三：批量注册
userModel.registerHooks({
  beforeCreate: (ctx) => { /* ... */ },
  afterUpdate: [
    (ctx) => { /* hook 1 */ },
    (ctx) => { /* hook 2 */ }
  ]
});
```

### 钩子上下文

```typescript
interface HookContext<T> {
  modelName: string;      // 模型名称
  data?: Partial<T>;      // 创建/更新的数据
  where?: Condition<T>;   // 查询/更新/删除条件
  result?: T | T[] | number; // 操作结果（after 钩子）
}
```

### 取消操作

`before` 钩子返回 `false` 可以取消操作：

```typescript
userModel.addHook('beforeDelete', async (ctx) => {
  // 禁止删除管理员
  const user = await userModel.findOne(ctx.where);
  if (user?.role === 'admin') {
    return false; // 取消删除
  }
});

await userModel.deleteById(1); // 如果是管理员，返回 false
```

### 修改数据

`beforeCreate` 和 `beforeUpdate` 可以修改数据：

```typescript
userModel.addHook('beforeCreate', (ctx) => {
  // 统一处理
  ctx.data.status = 'pending';
  ctx.data.name = ctx.data.name?.trim().toLowerCase();
});

userModel.addHook('beforeUpdate', (ctx) => {
  // 自动更新时间
  ctx.data.updatedAt = new Date();
});
```

### 转换结果

`afterFind` 可以转换查询结果：

```typescript
userModel.addHook('afterFind', (ctx) => {
  if (ctx.result && !Array.isArray(ctx.result)) {
    // 添加计算属性
    ctx.result.fullName = `${ctx.result.firstName} ${ctx.result.lastName}`;
  }
});
```

### 移除钩子

```typescript
const myHook = (ctx) => { /* ... */ };
userModel.addHook('beforeCreate', myHook);

// 移除特定钩子
userModel.removeHook('beforeCreate', myHook);

// 移除某类型的所有钩子
userModel.removeHook('beforeCreate');

// 清除所有钩子
userModel.clearHooks();
```

### 使用钩子的 CRUD 方法

| 方法 | 触发的钩子 |
|------|-----------|
| `create(data)` | beforeCreate → afterCreate |
| `findOne(where)` / `findById(id)` | beforeFind → afterFind |
| `findAll(where)` | beforeFind → afterFind |
| `updateWhere(where, data)` / `updateById(id, data)` | beforeUpdate → afterUpdate |
| `deleteWhere(where)` / `deleteById(id)` | beforeDelete → afterDelete |

> 注意：直接使用 `insert()`, `select()`, `update()`, `delete()` 链式查询 **不会** 触发钩子，需要使用上述便捷方法。

## 数据迁移 (Migration)

版本化的数据库结构变更管理，支持升级和回滚。**`down` 操作可自动生成，无需手动编写。**

### 基本用法

```typescript
import { MigrationRunner, defineMigration } from '@zhin.js/database';

const runner = new MigrationRunner(db);

// 定义迁移 - 只需写 up，down 会自动生成！
runner.add(defineMigration({
  name: '001_create_users',
  up: async (ctx) => {
    await ctx.createTable('users', {
      id: { type: 'integer', primary: true, autoIncrement: true },
      name: { type: 'text', nullable: false },
      email: { type: 'text', unique: true },
      createdAt: { type: 'date' }
    });
  }
  // down 自动生成: ctx.dropTable('users')
}));

runner.add(defineMigration({
  name: '002_add_user_status',
  up: async (ctx) => {
    await ctx.addColumn('users', 'status', { type: 'text', default: 'active' });
    await ctx.addIndex('users', 'idx_status', ['status']);
  }
  // down 自动生成: 
  //   ctx.dropIndex('users', 'idx_status')
  //   ctx.dropColumn('users', 'status')
}));

// 运行所有待执行的迁移
await runner.migrate();
```

### 自动生成 Down 的规则

系统会记录 `up` 中执行的操作，并自动生成反向操作：

| up 操作 | 自动生成的 down 操作 |
|---------|---------------------|
| `createTable(name, columns)` | `dropTable(name)` |
| `addColumn(table, col, def)` | `dropColumn(table, col)` |
| `addIndex(table, idx, cols)` | `dropIndex(table, idx)` |
| `renameColumn(table, old, new)` | `renameColumn(table, new, old)` |

以下操作**无法自动生成** down（需要手动提供）：
- `dropTable` - 需要原始表结构才能恢复
- `dropColumn` - 需要原始列定义才能恢复
- `dropIndex` - 需要原始索引定义才能恢复
- `query` - 原生 SQL 无法自动反向

### 手动提供 down

对于复杂场景或无法自动反向的操作，可以显式提供 `down`：

```typescript
runner.add(defineMigration({
  name: '003_seed_settings',
  up: async (ctx) => {
    // 原生 SQL 无法自动反向
    await ctx.query(`INSERT INTO settings VALUES (?, ?)`, ['theme', 'dark']);
  },
  down: async (ctx) => {
    await ctx.query(`DELETE FROM settings WHERE key = ?`, ['theme']);
  }
}));
```

### 迁移操作

```typescript
// 运行所有待执行的迁移
const migrated = await runner.migrate();
console.log('已迁移:', migrated);

// 回滚最后一批迁移
const rolledBack = await runner.rollback();
console.log('已回滚:', rolledBack);

// 回滚所有迁移
await runner.reset();

// 重新运行所有迁移 (reset + migrate)
const { rolledBack, migrated } = await runner.refresh();

// 查看迁移状态
const status = await runner.status();
// [
//   { name: '001_create_users', status: 'executed', batch: 1 },
//   { name: '002_add_status', status: 'pending' }
// ]
```

### 迁移上下文 API

| 方法 | 描述 |
|------|------|
| `createTable(name, columns)` | 创建表 |
| `dropTable(name)` | 删除表 |
| `addColumn(table, column, definition)` | 添加列 |
| `dropColumn(table, column)` | 删除列 |
| `renameColumn(table, oldName, newName)` | 重命名列 |
| `addIndex(table, indexName, columns, unique?)` | 添加索引 |
| `dropIndex(table, indexName)` | 删除索引 |
| `query(sql, params?)` | 执行原生 SQL |

### 批量添加迁移

```typescript
runner.addAll([
  defineMigration({ name: '001_users', up: async (ctx) => { /* ... */ } }),
  defineMigration({ name: '002_orders', up: async (ctx) => { /* ... */ } }),
  defineMigration({ name: '003_products', up: async (ctx) => { /* ... */ } }),
]);

// 同一批次的迁移会一起执行/回滚
await runner.migrate();
```

## License

MIT
