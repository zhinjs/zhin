# @zhin.js/database

Zhin 机器人框架的数据库抽象层，提供统一的 API 支持多种数据库类型。

## 特性

- 🗄️ **多数据库支持** - SQLite、MySQL、PostgreSQL、MongoDB、Redis、Memory
- 🔄 **统一 API** - 统一的查询构建器接口
- 📊 **三种数据库类型** - Related(关系型)、Document(文档型)、KeyValue(键值型)
- 🎯 **查询构建器** - 链式调用的流式 API
- 🔍 **条件查询** - 丰富的查询操作符
- 📦 **Schema 定义** - 类型安全的模型定义
- 🚀 **类型推导** - 完整的 TypeScript 类型支持
- 🔌 **可扩展** - 支持自定义 Dialect

## 安装

```typescript
pnpm add @zhin.js/database
```

根据使用的数据库，安装对应的驱动：

```bash
# SQLite
pnpm add sqlite3

# MySQL
pnpm add mysql2

# PostgreSQL
pnpm add pg

# MongoDB
pnpm add mongodb

# Redis
pnpm add redis
```

## 核心概念

### Database

数据库基类，所有数据库类型的抽象。

- `RelatedDatabase` - 关系型数据库（SQLite、MySQL、PostgreSQL）
- `DocumentDatabase` - 文档型数据库（MongoDB）
- `KeyValueDatabase` - 键值型数据库（Redis）

### Dialect

方言，定义数据库的具体实现。

- `MemoryDialect` - 内存数据库
- `SQLiteDialect` - SQLite
- `MySQLDialect` - MySQL
- `PostgreSQLDialect` - PostgreSQL
- `MongoDBDialect` - MongoDB
- `RedisDialect` - Redis

### Model

模型，表示数据库中的表或集合。

### Schema

Schema 定义，描述模型的结构。

## 快速开始

### 配置数据库

```typescript
import { Registry } from '@zhin.js/database'

// SQLite
const db = Registry.create('sqlite', {
  storage: './data/bot.db'
})

// MySQL
const db = Registry.create('mysql', {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'bot_db'
})

// PostgreSQL
const db = Registry.create('pg', {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'bot_db'
})

// MongoDB
const db = Registry.create('mongodb', {
  uri: 'mongodb://localhost:27017',
  database: 'bot_db'
})

// Redis
const db = Registry.create('redis', {
  host: 'localhost',
  port: 6379
})

// Memory
const db = Registry.create('memory', {})

await db.start()
```

### 定义 Schema

```typescript
import { Schema } from '@zhin.js/database'

const UserSchema = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  username: { type: 'text', unique: true },
  email: { type: 'text' },
  age: { type: 'integer', nullable: true },
  isActive: { type: 'boolean', default: true },
  metadata: { type: 'json', nullable: true },
  createdAt: { type: 'date' }
} as const
```

**字段类型：**

- `text` - 文本
- `integer` - 整数
- `float` - 浮点数
- `boolean` - 布尔值
- `date` - 日期
- `json` - JSON 对象

**字段选项：**

- `primary` - 主键
- `autoIncrement` - 自动递增
- `unique` - 唯一约束
- `nullable` - 可空
- `default` - 默认值
- `length` - 长度限制

## 查询构建器

### Creation - 创建表

```typescript
// 创建表
await db.create('users', UserSchema).execute()
```

### Insertion - 插入数据

```typescript
// 插入单条
const result = await db.insert('users', {
  username: 'john',
  email: 'john@example.com',
  age: 25,
  createdAt: new Date()
}).execute()

// 链式调用
const userId = await db.insert('users', userData)
  .returning('id')
  .execute()
```

### Selection - 查询数据

```typescript
// 查询所有
const users = await db.select('users', ['id', 'username', 'email'])
  .execute()

// 条件查询
const adults = await db.select('users', ['username', 'age'])
  .where({ age: { $gte: 18 } })
  .execute()

// 排序
const sorted = await db.select('users', ['username'])
  .orderBy({ field: 'username', direction: 'ASC' })
  .execute()

// 分页
const page = await db.select('users', ['id', 'username'])
  .limit(10)
  .offset(20)
  .execute()

// 分组
const grouped = await db.select('users', ['age'])
  .groupBy(['age'])
  .execute()
```

### Updation - 更新数据

```typescript
// 更新数据
await db.update('users', { age: 26 })
  .where({ username: 'john' })
  .execute()

// 批量更新
await db.update('users', { isActive: false })
  .where({ age: { $lt: 18 } })
  .execute()
```

### Deletion - 删除数据

```typescript
// 删除数据
await db.delete('users', { username: 'john' })
  .execute()

// 条件删除
await db.delete('users', { age: { $lt: 0 } })
  .execute()
```

### Alteration - 修改表结构

```typescript
// 添加列
await db.alter('users', {
  nickname: { action: 'add', type: 'text', nullable: true }
}).execute()

// 修改列
await db.alter('users', {
  age: { action: 'modify', type: 'integer', nullable: false }
}).execute()

// 删除列
await db.alter('users', {
  nickname: { action: 'drop' }
}).execute()
```

## Model API

### 获取模型

```typescript
const UserModel = db.models.get('users')
```

### 使用模型查询

```typescript
// 插入
await UserModel.insert(userData).execute()

// 查询
await UserModel.select('id', 'username').execute()

// 更新
await UserModel.update({ age: 26 })
  .where({ username: 'john' })
  .execute()

// 删除
await UserModel.delete({ username: 'john' }).execute()

// 修改表
await UserModel.alter({
  nickname: { action: 'add', type: 'text' }
}).execute()
```

## 查询条件

### 比较操作符

```typescript
// 等于
{ age: 25 }
{ age: { $eq: 25 } }

// 不等于
{ age: { $ne: 25 } }

// 大于
{ age: { $gt: 18 } }

// 大于等于
{ age: { $gte: 18 } }

// 小于
{ age: { $lt: 60 } }

// 小于等于
{ age: { $lte: 60 } }

// 在数组中
{ status: { $in: ['active', 'pending'] } }

// 不在数组中
{ status: { $nin: ['deleted', 'banned'] } }

// 模糊匹配
{ username: { $like: '%john%' } }

// 非模糊匹配
{ username: { $nlike: '%admin%' } }
```

### 逻辑操作符

```typescript
// AND（默认）
{
  age: { $gt: 18 },
  isActive: true
}

// OR
{
  $or: [
    { age: { $lt: 18 } },
    { age: { $gt: 60 } }
  ]
}

// NOT
{
  $not: {
    age: { $eq: 25 }
  }
}

// 复杂组合
{
  $and: [
    { age: { $gte: 18 } },
    {
      $or: [
        { username: { $like: '%admin%' } },
        { isActive: true }
      ]
    }
  ]
}
```

## 数据库配置

### SQLite

```typescript
{
  dialect: 'sqlite',
  storage: './data/bot.db'
}
```

### MySQL

```typescript
{
  dialect: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'bot_db',
  charset: 'utf8mb4'
}
```

### PostgreSQL

```typescript
{
  dialect: 'pg',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'bot_db'
}
```

### MongoDB

```typescript
{
  dialect: 'mongodb',
  uri: 'mongodb://localhost:27017',
  database: 'bot_db'
}
```

### Redis

```typescript
{
  dialect: 'redis',
  host: 'localhost',
  port: 6379,
  password: 'password',
  db: 0
}
```

### Memory

```typescript
{
  dialect: 'memory'
}
```

## 完整示例

### 基础 CRUD

```typescript
import { Registry } from '@zhin.js/database'

// 创建数据库
const db = Registry.create('sqlite', {
  storage: './data/bot.db'
}, {
  users: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    username: { type: 'text', unique: true },
    email: { type: 'text' },
    age: { type: 'integer' }
  }
})

await db.start()

const UserModel = db.models.get('users')

// 插入
await UserModel.insert({
  username: 'john',
  email: 'john@example.com',
  age: 25
}).execute()

// 查询
const users = await UserModel.select('id', 'username', 'email')
  .where({ age: { $gte: 18 } })
  .orderBy({ field: 'username', direction: 'ASC' })
  .limit(10)
  .execute()

// 更新
await UserModel.update({ age: 26 })
  .where({ username: 'john' })
  .execute()

// 删除
await UserModel.delete({ username: 'john' }).execute()
```

### 在 Zhin 中使用

```typescript
import { defineModel, Schema, onDatabaseReady } from 'zhin.js'

interface User {
  id: number
  username: string
  email: string
  age?: number
}

onDatabaseReady((db) => {
  const UserModel = defineModel<User>('User', new Schema({
    id: { type: 'integer', primary: true, autoIncrement: true },
    username: { type: 'text', unique: true },
    email: { type: 'text' },
    age: { type: 'integer', nullable: true }
  }))
  
  // 使用模型
  onMessage(async (message) => {
    // 创建用户
    await UserModel.insert({
      username: message.$sender.username,
      email: 'user@example.com'
    }).execute()
    
    // 查询用户
    const user = await UserModel.select('id', 'username')
      .where({ username: message.$sender.username })
      .execute()
  })
})
```

## Registry 注册系统

### 注册自定义 Dialect

```typescript
import { Registry } from '@zhin.js/database'

// 注册自定义数据库
Registry.register('mydb', (config, schemas) => {
  return new MyDatabase(config, schemas)
})

// 使用
const db = Registry.create('mydb', {
  // 配置
})
```

## Database API

### 基础方法

- `db.start()` - 启动数据库
- `db.stop()` - 停止数据库
- `db.healthCheck()` - 健康检查
- `db.query(sql, params)` - 执行原生查询
- `db.dispose()` - 销毁数据库

### 属性

- `db.isStarted` - 是否已启动
- `db.dialectName` - 方言名称
- `db.models` - 模型映射
- `db.config` - 数据库配置

### 查询构建器

- `db.create(name, schema)` - 创建表
- `db.alter(name, alterations)` - 修改表
- `db.select(name, fields)` - 查询数据
- `db.insert(name, data)` - 插入数据
- `db.update(name, update)` - 更新数据
- `db.delete(name, condition)` - 删除数据

## 类型定义

### Schema 类型

```typescript
type Schema<T> = {
  [P in keyof T]: Column<T[P]>
}

interface Column<T = any> {
  type: ColumnType
  nullable?: boolean
  default?: T
  autoIncrement?: boolean
  primary?: boolean
  unique?: boolean
  length?: number
}

type ColumnType = 
  | 'text'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'json'
```

### 条件类型

```typescript
interface ComparisonOperators<T> {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
  $in?: T[]
  $nin?: T[]
  $like?: string
  $nlike?: string
}

interface LogicOperators<T = any> {
  $and?: Condition<T>[]
  $or?: Condition<T>[]
  $not?: Condition<T>
}

type Condition<T = object> = {
  [P in keyof T]?: T[P] | ComparisonOperators<T[P]> | LogicOperators<T[P]>
} | LogicOperators<T>
```

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [数据库配置](https://docs.zhin.dev/guide/database)
- [API 参考](https://docs.zhin.dev/api/database)

## 许可证

MIT License

