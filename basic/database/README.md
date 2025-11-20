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
import { Database } from '@zhin.js/database';

// 创建数据库实例（以 SQLite 为例）
const db = Database.create('sqlite', {
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
import { Database } from '@zhin.js/database';

const db = Database.create('sqlite', {
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
const db = Database.create('mysql', {
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
const db = Database.create('pg', {
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
const db = Database.create('mongodb', {
  url: 'mongodb://localhost:27017',
  dbName: 'myapp'
}, schemas);

await db.start();
```

### Redis Example

```typescript
const db = Database.create('redis', {
  socket: {
    host: 'localhost',
    port: 6379
  }
}, schemas);

await db.start();
```

### Memory Example (for Testing)

```typescript
const db = Database.create('memory', {}, schemas);
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

## License

MIT
