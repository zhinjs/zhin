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

## License

MIT
