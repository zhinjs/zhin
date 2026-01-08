# 数据库

使用数据库存储数据。

## 配置数据库

```yaml
# zhin.config.yml
database:
  dialect: sqlite
  filename: ./data/database.db
```

## 定义模型

推荐使用 `defineModel` 在数据库启动前定义模型：

```typescript
import { usePlugin } from 'zhin.js'

// 1. 声明模型类型
declare module 'zhin.js' {
  interface Models {
    users: {
      id: number
      name: string
      email: string
    }
  }
}

// 2. 定义模型（在数据库启动前）
const { defineModel } = usePlugin()

defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'string' },
  email: { type: 'string' }
})
```

也可以在数据库启动后定义（不推荐）：

```typescript
const { useContext } = usePlugin()

useContext('database', (db) => {
  db.define('users', {
    id: { type: 'integer', primary: true },
    name: { type: 'string' },
    email: { type: 'string' }
  })
})
```

## 使用模型

```typescript
useContext('database', async (db) => {
  const users = db.models.get('users')
  
  // 插入
  await users.insert({ name: 'Alice', email: 'alice@example.com' })
  
  // 查询
  const allUsers = await users.select()
  
  // 条件查询
  const alice = await users.select({ name: 'Alice' })
  
  // 更新
  await users.update({ email: 'newemail@example.com' }, { name: 'Alice' })
  
  // 删除
  await users.delete({ name: 'Alice' })
})
```

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

// 2. 定义模型（数据库启动前）
defineModel('todos', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
  done: { type: 'boolean', default: false }
})

// 3. 使用模型（数据库启动后）
useContext('database', (db) => {
  const todos = db.models.get('todos')
  
  // 添加待办
  addCommand(
    new MessageCommand('todo <text:string>')
      .desc('添加待办')
      .action(async (_, result) => {
        await todos.insert({ text: result.params.text })
        return '✅ 已添加'
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
          `${t.id}. ${t.done ? '✅' : '⬜'} ${t.text}`
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
        return '✅ 已完成'
      })
  )
  
  // 删除待办
  addCommand(
    new MessageCommand('del <id:number>')
      .desc('删除待办')
      .action(async (_, result) => {
        await todos.delete({ id: result.params.id })
        return '🗑️ 已删除'
      })
  )
})
```

