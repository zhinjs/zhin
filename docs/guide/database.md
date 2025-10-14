# 数据库

Zhin.js 提供了强大的数据库抽象层，支持多种数据库类型，并提供统一的 API。

## 配置数据库

在 `zhin.config.ts` 中配置数据库：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',           // 数据库类型
      filename: './data/bot.db'    // 数据库文件路径
    },
    
    // ... 其他配置
  }
})
```

### 支持的数据库

- **SQLite** - 轻量级文件数据库（推荐用于开发和小型项目）
- **MySQL** - 流行的关系型数据库
- **PostgreSQL** - 高级关系型数据库
- **MongoDB** - NoSQL 文档数据库
- **Redis** - 键值对数据库

### 各数据库配置

#### SQLite

```typescript
database: {
  dialect: 'sqlite',
  filename: './data/bot.db'
}
```

#### MySQL

```typescript
database: {
  dialect: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'your_password',
  database: 'zhin_bot'
}
```

#### PostgreSQL

```typescript
database: {
  dialect: 'pg',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'your_password',
  database: 'zhin_bot'
}
```

#### MongoDB

```typescript
database: {
  dialect: 'mongodb',
  url: 'mongodb://localhost:27017/zhin_bot'
}
```

#### Redis

```typescript
database: {
  dialect: 'redis',
  host: 'localhost',
  port: 6379,
  password: 'your_password'  // 可选
}
```

## 定义数据模型

使用 `defineModel` 定义数据表结构：

```typescript
import { defineModel } from 'zhin.js'

// 声明模型类型（用于 TypeScript 类型提示）
declare module '@zhin.js/types' {
  interface Models {
    users: {
      id?: number
      username: string
      email: string
      age: number
      created_at?: Date
    }
  }
}

// 定义模型
defineModel('users', {
  id: { type: 'integer', autoIncrement: true, primary: true },
  username: { type: 'text', nullable: false, unique: true },
  email: { type: 'text', nullable: false },
  age: { type: 'integer', default: 0 },
  created_at: { type: 'datetime', default: () => new Date() }
})
```

### 字段类型

- **text** - 文本字符串
- **integer** - 整数
- **float** - 浮点数
- **boolean** - 布尔值
- **datetime** - 日期时间
- **json** - JSON 对象
- **binary** - 二进制数据

### 字段选项

- **nullable** - 是否可为空（默认 true）
- **default** - 默认值
- **unique** - 是否唯一
- **primary** - 是否为主键
- **autoIncrement** - 是否自动递增

## 使用数据库

### 等待数据库就绪

使用 `onDatabaseReady` 确保数据库已初始化：

```typescript
import { onDatabaseReady, defineModel } from 'zhin.js'

// 声明类型
declare module '@zhin.js/types' {
  interface Models {
    test_model: {
      id?: number
      name: string
      age: number
      info: object
    }
  }
}

// 定义模型
defineModel('test_model', {
  id: { type: 'integer', autoIncrement: true, primary: true },
  name: { type: 'text', nullable: false },
  age: { type: 'integer', default: 0 },
  info: { type: 'json' }
})

// 数据库就绪后操作
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 现在可以安全地使用数据库了
  const users = await model.select()
  console.log('用户列表:', users)
})
```

### 创建数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 创建单条数据
  const user = await model.create({
    name: '张三',
    age: 20,
    info: { city: '北京', hobby: '编程' }
  })
  
  console.log('创建成功:', user)
  // 输出: { id: 1, name: '张三', age: 20, info: { city: '北京', hobby: '编程' } }
})
```

### 查询数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 查询所有数据
  const all = await model.select()
  console.log('所有用户:', all)
  
  // 条件查询
  const adults = await model.select({
    age: { $gte: 18 }  // 年龄 >= 18
  })
  
  // 复杂条件
  const result = await model.select({
    $and: [
      { age: { $gte: 18 } },
      { age: { $lte: 60 } }
    ]
  })
  
  // 分页查询
  const page = await model.select(
    {},
    { 
      limit: 10,      // 每页10条
      offset: 0,      // 从第0条开始
      orderBy: 'age', // 按年龄排序
      desc: true      // 降序
    }
  )
})
```

### 条件运算符

- **$eq** - 等于（默认）
- **$ne** - 不等于
- **$gt** - 大于
- **$gte** - 大于等于
- **$lt** - 小于
- **$lte** - 小于等于
- **$in** - 包含在数组中
- **$nin** - 不包含在数组中
- **$like** - 模糊匹配（SQL LIKE）
- **$regex** - 正则匹配

### 逻辑运算符

- **$and** - 与
- **$or** - 或
- **$not** - 非

### 更新数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 更新数据
  await model.update(
    { name: '张三' },  // 条件
    { age: 21 }        // 新值
  )
  
  // 批量更新
  await model.update(
    { age: { $lt: 18 } },  // 所有未成年人
    { info: { type: 'minor' } }
  )
})
```

### 删除数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 删除指定数据
  await model.delete({ name: '张三' })
  
  // 批量删除
  await model.delete({ age: { $lt: 0 } })
  
  // 删除所有数据
  await model.delete({})
})
```

### 统计数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  
  // 计数
  const count = await model.count()
  console.log('总用户数:', count)
  
  // 条件计数
  const adultCount = await model.count({ age: { $gte: 18 } })
  console.log('成年人数:', adultCount)
})
```

## 实战示例

### 用户签到系统

```typescript
import { defineModel, onDatabaseReady, addCommand, MessageCommand } from 'zhin.js'

// 声明类型
declare module '@zhin.js/types' {
  interface Models {
    checkins: {
      id?: number
      user_id: string
      username: string
      date: string
      consecutive_days: number
      total_days: number
      created_at?: Date
    }
  }
}

// 定义签到表
defineModel('checkins', {
  id: { type: 'integer', autoIncrement: true, primary: true },
  user_id: { type: 'text', nullable: false },
  username: { type: 'text', nullable: false },
  date: { type: 'text', nullable: false },  // 格式：YYYY-MM-DD
  consecutive_days: { type: 'integer', default: 1 },
  total_days: { type: 'integer', default: 1 },
  created_at: { type: 'datetime', default: () => new Date() }
})

onDatabaseReady(async (db) => {
  const checkins = db.model('checkins')
  
  // 签到命令
  addCommand(new MessageCommand('签到')
    .action(async (message) => {
      const userId = message.$sender.id
      const username = message.$sender.name
      const today = new Date().toISOString().split('T')[0]
      
      // 检查今天是否已签到
      const todayCheckin = await checkins.select({
        user_id: userId,
        date: today
      })
      
      if (todayCheckin.length > 0) {
        return '你今天已经签到过了！'
      }
      
      // 获取昨天的签到记录
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      
      const yesterdayCheckin = await checkins.select({
        user_id: userId,
        date: yesterdayStr
      })
      
      // 获取总签到次数
      const allCheckins = await checkins.count({ user_id: userId })
      
      // 计算连续天数
      let consecutiveDays = 1
      if (yesterdayCheckin.length > 0) {
        consecutiveDays = yesterdayCheckin[0].consecutive_days + 1
      }
      
      // 创建签到记录
      await checkins.create({
        user_id: userId,
        username,
        date: today,
        consecutive_days: consecutiveDays,
        total_days: allCheckins + 1
      })
      
      return [
        '✅ 签到成功！',
        `连续签到: ${consecutiveDays} 天`,
        `累计签到: ${allCheckins + 1} 天`
      ].join('\n')
    })
  )
  
  // 查询签到记录
  addCommand(new MessageCommand('签到记录')
    .action(async (message) => {
      const userId = message.$sender.id
      
      // 获取最近的签到记录
      const recentCheckins = await checkins.select(
        { user_id: userId },
        { limit: 7, orderBy: 'date', desc: true }
      )
      
      if (recentCheckins.length === 0) {
        return '你还没有签到记录'
      }
      
      const latest = recentCheckins[0]
      
      return [
        '📊 签到统计',
        `连续签到: ${latest.consecutive_days} 天`,
        `累计签到: ${latest.total_days} 天`,
        '',
        '📅 最近7天:',
        ...recentCheckins.map(c => `  ${c.date} ✓`)
      ].join('\n')
    })
  )
})
```

### 用户积分系统

```typescript
import { defineModel, onDatabaseReady, addCommand, MessageCommand } from 'zhin.js'

declare module '@zhin.js/types' {
  interface Models {
    points: {
      id?: number
      user_id: string
      username: string
      points: number
      level: number
      updated_at?: Date
    }
  }
}

defineModel('points', {
  id: { type: 'integer', autoIncrement: true, primary: true },
  user_id: { type: 'text', nullable: false, unique: true },
  username: { type: 'text', nullable: false },
  points: { type: 'integer', default: 0 },
  level: { type: 'integer', default: 1 },
  updated_at: { type: 'datetime', default: () => new Date() }
})

onDatabaseReady(async (db) => {
  const points = db.model('points')
  
  // 获取或创建用户积分
  async function getUserPoints(userId: string, username: string) {
    let user = await points.select({ user_id: userId })
    if (user.length === 0) {
      await points.create({ user_id: userId, username, points: 0, level: 1 })
      user = await points.select({ user_id: userId })
    }
    return user[0]
  }
  
  // 增加积分
  async function addPoints(userId: string, amount: number) {
    const user = await points.select({ user_id: userId })
    if (user.length > 0) {
      const newPoints = user[0].points + amount
      const newLevel = Math.floor(newPoints / 100) + 1
      
      await points.update(
        { user_id: userId },
        { 
          points: newPoints,
          level: newLevel,
          updated_at: new Date()
        }
      )
    }
  }
  
  // 查询积分
  addCommand(new MessageCommand('积分')
    .action(async (message) => {
      const user = await getUserPoints(message.$sender.id, message.$sender.name)
      
      return [
        '💰 积分信息',
        `等级: Lv.${user.level}`,
        `积分: ${user.points}`,
        `距离下一级: ${(user.level * 100) - user.points} 积分`
      ].join('\n')
    })
  )
  
  // 积分排行榜
  addCommand(new MessageCommand('排行榜')
    .action(async () => {
      const topUsers = await points.select(
        {},
        { limit: 10, orderBy: 'points', desc: true }
      )
      
      if (topUsers.length === 0) {
        return '还没有人上榜哦'
      }
      
      const ranking = topUsers.map((user, index) => 
        `${index + 1}. ${user.username} - Lv.${user.level} (${user.points}分)`
      )
      
      return ['🏆 积分排行榜', '', ...ranking].join('\n')
    })
  )
  
  // 发放积分（每次发言+1积分）
  onMessage(async (message) => {
    await addPoints(message.$sender.id, 1)
  })
})
```

## 迁移和备份

### 导出数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  const all = await model.select()
  
  // 保存为 JSON
  const fs = await import('node:fs/promises')
  await fs.writeFile(
    './backup.json',
    JSON.stringify(all, null, 2)
  )
})
```

### 导入数据

```typescript
onDatabaseReady(async (db) => {
  const model = db.model('test_model')
  const fs = await import('node:fs/promises')
  
  const data = JSON.parse(
    await fs.readFile('./backup.json', 'utf-8')
  )
  
  for (const item of data) {
    await model.create(item)
  }
})
```

## 最佳实践

### 1. 使用类型声明

```typescript
// ✅ 好的做法
declare module '@zhin.js/types' {
  interface Models {
    users: {
      id?: number
      name: string
    }
  }
}

const model = db.model('users')
const user = await model.select()
// user 有完整的类型提示
```

### 2. 避免在循环中查询

```typescript
// ❌ 不好的做法
for (const userId of userIds) {
  const user = await model.select({ user_id: userId })
}

// ✅ 好的做法
const users = await model.select({
  user_id: { $in: userIds }
})
```

### 3. 使用事务（如支持）

```typescript
// 对于支持事务的数据库
await db.transaction(async (tx) => {
  await tx.model('accounts').update(
    { id: 1 },
    { balance: 100 }
  )
  await tx.model('accounts').update(
    { id: 2 },
    { balance: 200 }
  )
})
```

### 4. 定期备份

```typescript
import { addCron } from 'zhin.js'

onDatabaseReady(async (db) => {
  // 每天凌晨2点备份
  addCron('0 2 * * *', async () => {
    // 备份逻辑
  })
})
```

## 下一步

- 🔔 [定时任务](/guide/cron) - 定期执行数据库维护任务
- 🎯 [最佳实践](/guide/best-practices) - 数据库性能优化
- 💡 [实战示例](/examples/database) - 更多数据库应用场景

