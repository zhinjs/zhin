# 数据库

Zhin.js 通过 `DatabaseFeature` 提供数据库 ORM 能力。插件使用 `defineModel` 定义模型，使用 `useContext('database')` 操作数据。

## 配置数据库

```yaml
# zhin.config.yml
database:
  dialect: sqlite
  filename: ./data/database.db
```

支持的数据库：
- **SQLite**（推荐，无需额外配置）
- **MySQL**（需安装 mysql2 驱动）
- **PostgreSQL**（需安装 pg 驱动）

## 定义模型

使用 `defineModel`（DatabaseFeature 的插件扩展方法）在数据库启动前定义模型：

```typescript
import { usePlugin } from 'zhin.js'

// 1. 声明模型类型（TypeScript 类型安全）
declare module 'zhin.js' {
  interface Models {
    users: {
      id: number
      name: string
      email: string
    }
  }
}

// 2. 定义模型
const { defineModel } = usePlugin()

defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'string' },
  email: { type: 'string' }
})
```

::: tip
`defineModel` 可以在数据库就绪之前调用。框架会在数据库连接后自动创建/同步表结构。
:::

## 使用模型

```typescript
const { useContext } = usePlugin()

useContext('database', async (db) => {
  const users = db.models.get('users')
  
  // 插入
  await users.insert({ name: 'Alice', email: 'alice@example.com' })
  
  // 查询所有
  const allUsers = await users.select()
  
  // 条件查询
  const alice = await users.select({ name: 'Alice' })
  
  // 更新
  await users.update({ email: 'new@example.com' }, { name: 'Alice' })
  
  // 删除
  await users.delete({ name: 'Alice' })
})
```

## 字段类型

| 类型 | 说明 |
|------|------|
| `integer` | 整数 |
| `string` | 字符串 |
| `boolean` | 布尔值 |
| `float` | 浮点数 |
| `text` | 长文本 |
| `json` | JSON 对象 |
| `date` | 日期 |

## 字段选项

```typescript
defineModel('example', {
  id: { type: 'integer', primary: true },      // 主键
  name: { type: 'string', nullable: false },    // 非空
  status: { type: 'string', default: 'active' }, // 默认值
  data: { type: 'json' },                       // JSON 字段
})
```

## AI 相关模型

当 AI 模块启用并配置 `sessions.useDatabase: true` 时，框架会自动注册以下模型：

| 模型名 | 说明 |
|--------|------|
| `ai_sessions` | AI 会话记录（按场景隔离） |
| `ai_context_summaries` | 对话摘要（长对话压缩） |
| `ai_user_profiles` | 用户画像（AI 对用户的理解） |
| `ai_follow_ups` | 定时跟进提醒（AI 设置的回访） |

这些模型由 AI 模块自动管理，无需手动操作。

## 完整示例

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 1. 声明类型
declare module 'zhin.js' {
  interface Models {
    todos: {
      id: number
      text: string
      done: boolean
    }
  }
}

const { defineModel, useContext, addCommand } = usePlugin()

// 2. 定义模型
defineModel('todos', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
  done: { type: 'boolean', default: false }
})

// 3. 使用模型
useContext('database', (db) => {
  const todos = db.models.get('todos')
  
  // 添加待办
  addCommand(
    new MessageCommand('todo <text:string>')
      .desc('添加待办')
      .action(async (_, result) => {
        await todos.insert({ text: result.params.text })
        return '已添加'
      })
  )
  
  // 查看待办
  addCommand(
    new MessageCommand('todos')
      .desc('查看所有待办')
      .action(async () => {
        const list = await todos.select()
        if (list.length === 0) return '暂无待办'
        
        return list.map(t => 
          `${t.id}. ${t.done ? '[x]' : '[ ]'} ${t.text}`
        ).join('\n')
      })
  )
  
  // 完成待办
  addCommand(
    new MessageCommand('done <id:number>')
      .desc('完成待办')
      .action(async (_, result) => {
        await todos.update(
          { done: true },
          { id: result.params.id }
        )
        return '已完成'
      })
  )
  
  // 删除待办
  addCommand(
    new MessageCommand('del <id:number>')
      .desc('删除待办')
      .action(async (_, result) => {
        await todos.delete({ id: result.params.id })
        return '已删除'
      })
  )
})
```
