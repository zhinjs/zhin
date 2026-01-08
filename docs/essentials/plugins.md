# 插件系统

## 创建插件

在 `src/plugins/` 目录创建文件：

```typescript
// src/plugins/my-plugin.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, logger } = usePlugin()

logger.info('插件已加载')

addCommand(
  new MessageCommand('test')
    .desc('测试命令')
    .action(() => '测试成功')
)
```

在 `zhin.config.yml` 中启用：

```yaml
plugins:
  - my-plugin
```

## usePlugin API

```typescript
const {
  addCommand,      // 添加命令
  addMiddleware,   // 添加中间件
  addComponent,    // 添加组件
  useContext,      // 使用上下文
  provide,         // 提供服务
  inject,          // 注入服务
  onMounted,       // 挂载钩子
  onDispose,       // 卸载钩子
  logger,          // 日志对象
  root,            // 根目录
} = usePlugin()
```

## 使用数据库

```typescript
import { usePlugin } from 'zhin.js'

// 声明类型
declare module 'zhin.js' {
  interface Models {
    users: {
      id: number
      name: string
    }
  }
}

const { defineModel, useContext } = usePlugin()

// 定义模型（数据库启动前）
defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'string' }
})

// 使用模型（数据库启动后）
useContext('database', async (db) => {
  const users = db.models.get('users')
  const result = await users.select()
  console.log(result)
})
```

## 生命周期

```typescript
const { onMounted, onDispose } = usePlugin()

onMounted(() => {
  console.log('插件启动')
})

onDispose(() => {
  console.log('插件卸载')
})
```

## 提供服务

```typescript
const { provide } = usePlugin()

provide({
  name: 'myService',
  description: '我的服务',
  value: {
    doSomething() {
      return 'done'
    }
  },
  dispose: (service) => {
    // 清理资源
  }
})
```

## 注入服务

```typescript
const { inject } = usePlugin()

const myService = inject('myService')
if (myService) {
  myService.doSomething()
}
```

## 完整示例

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 声明类型
declare module 'zhin.js' {
  interface Models {
    todos: {
      id: number
      text: string
      done: boolean
    }
  }
}

const {
  defineModel,
  addCommand,
  useContext,
  onMounted,
  onDispose,
  logger
} = usePlugin()

// 挂载时执行
onMounted(() => {
  logger.info('插件已启动')
})

// 定义模型（数据库启动前）
defineModel('todos', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
  done: { type: 'boolean', default: false }
})

// 使用数据库（数据库启动后）
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
      .desc('查看待办')
      .action(async () => {
        const list = await todos.select()
        return list.map(t => `${t.id}. ${t.text}`).join('\n')
      })
  )
})

// 卸载时清理
onDispose(() => {
  logger.info('插件已卸载')
})
```

