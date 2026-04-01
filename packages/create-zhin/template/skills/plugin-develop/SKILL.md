
**参数语法：** `<必需:类型>`、`[可选:类型=默认值]`、`[...可变:类型]`

### 2. 中间件

```typescript
const { addMiddleware } = usePlugin()

// 洋葱模型：before → next → after
addMiddleware(async (message, next) => {
  const start = Date.now()
  // 前置逻辑
  await next()
  // 后置逻辑
  console.log(`耗时 ${Date.now() - start}ms`)
})

// 拦截消息（不调 next）
addMiddleware(async (message, next) => {
  if (message.$raw.includes('广告')) {
    await message.$recall()
    return // 中断后续处理
  }
  await next()
})
```

### 3. 事件监听

```typescript
const plugin = usePlugin()

// 消息事件
plugin.on('message.receive', (message) => { /* ... */ })
plugin.on('message.private.receive', (message) => { /* ... */ })
plugin.on('message.group.receive', (message) => { /* ... */ })

// 发送前钩子（可修改发送内容）
plugin.root.on('before.sendMessage', (options) => {
  // 统一在消息尾部加签名
  options.content += '\n-- bot'
})

// 通知事件
plugin.on('notice.receive', (notice) => { /* ... */ })
plugin.on('request.receive', (request) => { /* ... */ })
```

### 4. 定时任务

```typescript
import { usePlugin, Cron } from 'zhin.js'
const { addCron } = usePlugin()

// Cron 表达式：分 时 日 月 周
addCron(new Cron('0 9 * * 1-5', async () => {
  // 工作日早上 9 点
}))

addCron(new Cron('*/30 * * * *', async () => {
  // 每 30 分钟
}))
```

### 5. AI 工具（ZhinTool）

```typescript
import { usePlugin, ZhinTool } from 'zhin.js'
const { addTool } = usePlugin()

addTool(new ZhinTool('my_tool')
  .desc('工具描述（供 AI 理解）')
  .keyword('关键词1', '关键词2')  // 帮助 AI 匹配
  .tag('分类')
  .param('arg1', { type: 'string', description: '参数描述' }, true)  // 必需
  .param('arg2', { type: 'number', description: '可选参数' })          // 可选
  .execute(async (args) => {
    // AI 调用时执行
    return { result: 'ok' }
  })
  .action(async (message, result) => {
    // 用户命令调用时执行（可选）
    return '执行结果'
  })
)
```

### 6. 组件

```typescript
import { usePlugin, defineComponent } from 'zhin.js'
const { addComponent } = usePlugin()

addComponent(defineComponent(async function UserCard(
  props: { userId: string; name: string }
) {
  return `👤 ${props.name} (ID: ${props.userId})`
}))
```

### 7. 数据库

```typescript
const { useContext } = usePlugin()

useContext('database', (db) => {
  const users = db.models.get('users')

  // CRUD
  // await users.create({ name: 'Alice', age: 25 })
  // const all = await users.select()
  // await users.update({ age: 26 }, { name: 'Alice' })
  // await users.delete({ name: 'Alice' })

  return () => {
    // 清理资源
  }
})
```

### 8. HTTP 路由

```typescript
const { useContext } = usePlugin()

useContext('router', (router) => {
  router.get('/pub/my-api/status', (ctx) => {
    ctx.body = { status: 'ok' }
  })

  router.post('/api/my-api/action', (ctx) => {
    // /api/ 路径需要 Token 认证
    ctx.body = { success: true }
  })
})
```

### 9. Web 控制台页面

**服务端注册入口：**
```typescript
import path from 'node:path'
const { useContext } = usePlugin()

useContext('web', (web) => {
  const entry = path.resolve(import.meta.dirname, '../client/index.tsx')
  const dispose = web.addEntry(entry)
  return dispose
})
```

**客户端 client/index.tsx：**
```tsx
import { addPage } from '@zhin.js/client'

addPage({
  key: 'my-plugin',
  path: '/plugins/my-plugin',
  title: '我的插件',
  icon: <span>📦</span>,
  element: <MyPage />
})
```

### 10. Context 注册（服务型插件）

```typescript
const plugin = usePlugin()

// 注册异步 Context
plugin.provide({
  name: 'myService',
  description: '我的服务',
  mounted: async (p) => {
    const service = await createService()
    return service
  },
  dispose: async (service) => {
    await service.cleanup()
  }
})

// 类型声明
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyServiceType
    }
  }
}
```

## 编码规范

1. **导入路径**：TS 文件间使用 `.js` 扩展名 → `import { foo } from './bar.js'`
2. **框架 API**：统一从 `zhin.js` 导入
3. **usePlugin()**：只在模块顶层调用，不在 async 函数内
4. **清理资源**：`useContext()` 回调返回清理函数
5. **参数读取**：从 `result.params` 读取，不自行解析 `message.$raw`
6. **类型扩展**：通过 `declare module 'zhin.js'` 扩展 `Plugin.Contexts`

## 检查清单

- [ ] 功能代码放在正确的子目录（commands/、middlewares/ 等）
- [ ] 入口文件只负责装配，不堆业务逻辑
- [ ] 所有注册的资源有对应的清理路径
- [ ] useContext 回调正确返回清理函数
- [ ] 新增命令有参数类型声明和描述
- [ ] 新增功能有对应测试用例
