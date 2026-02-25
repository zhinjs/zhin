# Zhin.js AI Coding Agent Instructions

Zhin.js 是一个现代化的 TypeScript 机器人框架，采用 AsyncLocalStorage 上下文管理和热重载系统。

## 项目架构

### 核心架构设计
```
setup.ts (应用入口，使用 usePlugin())
  ↓
Plugin 层 (AsyncLocalStorage 上下文管理)
  ↓
  ├─ Context 系统 (provide/useContext/inject)
  ├─ 中间件系统 (addMiddleware)
  ├─ 命令系统 (addCommand)
  ├─ 组件系统 (addComponent)
  └─ Adapter 系统 (管理 Bot 实例)
```

**关键概念**：
- **Plugin** (`packages/core/src/plugin.ts`): 基于 AsyncLocalStorage 的上下文管理，自动创建插件树
- **usePlugin()**: Hooks 风格 API，根据调用文件自动获取或创建插件实例
- **Context**: 依赖注入系统，通过 `provide()` 注册，`inject()` 或 `useContext()` 使用
- **Adapter**: 平台适配器抽象，管理多个 Bot 实例，处理消息接收和发送
- **setup.ts**: 应用入口，移除 App 类，直接使用 usePlugin() 初始化

### Monorepo 结构 (pnpm workspace)
```
basic/          # 基础层 - 底层工具和类型系统
├── logger/     # 结构化日志系统 (chalk 颜色输出)
├── database/   # 数据库抽象层 (SQLite/MySQL)
├── schema/     # Schema 配置系统 (类型安全配置)
└── cli/        # CLI 工具 (zhin 命令行入口)

packages/       # 核心层 - 框架核心
├── core/       # 核心框架 (App, Plugin, Adapter, Bot, Types)
├── client/     # 客户端库 (React Router 7, Redux)
├── create-zhin/# 项目脚手架 (交互式创建项目)
└── zhin/       # 主入口包 (统一导出)

plugins/        # 插件层 - 扩展生态
├── services/   # 功能服务插件 (http, console, mcp)
├── adapters/   # 平台适配器 (icqq, kook, discord, qq, onebot11, process)
├── utils/      # 工具插件 (music, sensitive-filter)
└── games/      # 游戏插件

examples/       # 示例项目
└── test-bot/   # 完整示例机器人 (开发测试用)
```

## 核心开发模式

### 1. Plugin 系统 (AsyncLocalStorage + Hooks)
Plugin 使用 AsyncLocalStorage 管理上下文，通过 `usePlugin()` 获取当前插件实例：

```typescript
import { usePlugin } from 'zhin.js'

// 自动根据调用文件创建插件实例
const plugin = usePlugin()
const { addCommand, addMiddleware, provide, useContext, inject } = plugin

// 插件自动在 start() 时挂载，stop() 时卸载
// 使用 useContext 添加生命周期逻辑
useContext('database', (db) => {
  // database 就绪时执行
  console.log('数据库已连接')
  
  // 返回清理函数
  return () => {
    console.log('清理资源')
  }
})
```

### 2. Context 系统 (依赖注入)
使用 `provide()` 注册 Context，`useContext()` 或 `inject()` 使用：

```typescript
const plugin = usePlugin()

// 注册 Context（异步挂载）
plugin.provide({
  name: 'database',
  description: '数据库服务',
  mounted: async (plugin) => {
    const db = new Database()
    await db.connect()
    return db
  },
  dispose: async (db) => {
    await db.disconnect()
  }
})

// 注册 Context（同步值）
plugin.provide({
  name: 'myService',
  value: new MyService()
})

// 使用 Context（等待多个依赖）
plugin.useContext('database', 'router', (db, router) => {
  router.get('/api/users', async (ctx) => {
    const model = db.models.get('users')
    ctx.body = await model.select()
  })
  
  // 返回清理函数（可选）
  return () => {
    console.log('清理路由')
  }
})

// 直接注入 Context（同步）
const db = plugin.inject('database')
```

### 2. 热重载机制
- 模块加载使用防缓存 URL: `import(fileUrl + '?t=' + Date.now())`
- 支持多运行时 (Node.js/Bun): 清除 `require.cache` 和 `import.meta.cache`
- 依赖变更时自动触发 Context 重新注入
- 文件监听支持递归目录，基于扩展名过滤

### 3. 插件开发
插件文件放在 `src/plugins/` 或 `plugin_dirs` 配置的目录：

```typescript
// src/plugins/my-plugin.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, logger } = usePlugin()

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    logger.info(`Hello command from ${result.params.name}`)
    return `Hello, ${result.params.name}!`
  })
)
```

### 4. 适配器开发
**Bot 接口定义**：
```typescript
interface Bot<C extends Bot.Config = Bot.Config, M = any> {
  config: C
  connected: boolean
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $sendMessage(options: SendOptions): Promise<string>
  $recallMessage(messageId: string): Promise<void>
  $formatMessage(raw: M): Message<M>
}
```

**完整实现**：
```typescript
// adapters/my-adapter/src/index.ts
import { Adapter, Bot, Message, SendOptions, segment, usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 1. 定义配置
interface MyConfig {
  name: string
  token: string
  apiUrl: string
}

// 2. 定义原始消息格式
interface RawMessage {
  id: string
  content: string
  author: { id: string; name: string }
  timestamp: number
}

// 3. 实现 Bot 类
class MyBot implements Bot<MyConfig, RawMessage> {
  $connected = false
  $id: string
  
  constructor(
    public adapter: MyAdapter,
    public $config: MyConfig
  ) {
    this.$id = $config.name
  }
  
  get logger() {
    return this.adapter.logger
  }
  
  async $connect(): Promise<void> {
    // 连接逻辑
    this.$connected = true
    this.logger.info(`Bot ${this.$id} connected`)
  }
  
  async $disconnect(): Promise<void> {
    this.$connected = false
  }
  
  async $sendMessage(options: SendOptions): Promise<string> {
    // 发送消息，返回消息 ID
    const response = await fetch(`${this.$config.apiUrl}/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.$config.token}` },
      body: JSON.stringify({ content: options.content })
    })
    const { message_id } = await response.json()
    return message_id
  }
  
  async $recallMessage(messageId: string): Promise<void> {
    await fetch(`${this.$config.apiUrl}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.$config.token}` }
    })
  }
  
  $formatMessage(raw: RawMessage): Message<RawMessage> {
    const base = {
      $id: raw.id,
      $adapter: 'my-platform' as const,
      $bot: this.$config.name,
      $content: [{ type: 'text' as const, data: { text: raw.content } }],
      $sender: { id: raw.author.id, name: raw.author.name },
      $channel: { id: 'default', type: 'private' as const },
      $timestamp: raw.timestamp,
      $raw: raw.content,
      $reply: async (content: any) => {
        return await this.$sendMessage({
          context: 'my-platform',
          bot: this.$config.name,
          content,
          id: base.$channel.id,
          type: base.$channel.type
        })
      },
      $recall: async () => {
        await this.$recallMessage(base.$id)
      }
    }
    return Message.from(raw, base)
  }
}

// 4. 实现 Adapter 类
class MyAdapter extends Adapter<MyBot> {
  constructor(plugin: any, config: MyConfig[]) {
    super(plugin, 'my-platform', config)
  }
  
  createBot(config: MyConfig): MyBot {
    return new MyBot(this, config)
  }
}

// 5. 注册为 Context（新方式）
plugin.provide({
  name: 'my-adapter',
  mounted: async (p) => {
    const config = p.inject('config').getData('zhin.config.yml')
    const adapter = new MyAdapter(p, config.bots?.filter(b => b.context === 'my-platform') || [])
    await adapter.start()
    return adapter
  },
  dispose: async (adapter) => {
    await adapter.stop()
  }
})

// 6. 类型扩展
declare module 'zhin.js' {
  interface RegisteredAdapters {
    'my-platform': MyAdapter
  }
}
```

**关键要点**：
- `$sendMessage` 必须返回消息 ID
- `$formatMessage` 返回的 Message 必须包含 `$recall` 方法
- 正确触发事件：`message.receive`, `message.private.receive`, `message.group.receive`

### 5. JSX 支持
使用 JSX 构建消息组件（非 HTML）：

```typescript
// 配置 tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js"
  }
}

// 使用 JSX
import { defineComponent } from 'zhin.js'

const MyComp = defineComponent(async function MyComp(
  props: { title: string; count: number }
) {
  return `${props.title}: ${props.count}`
})
```

## 关键约定

### 1. 导入路径
- 使用 `.js` 扩展名导入 TS 文件: `import { foo } from './bar.js'`
- TypeScript 配置使用 `moduleResolution: "bundler"`
- 核心包别名: `@zhin.js/core`, `@zhin.js/logger`, `@zhin.js/database`
- **类型定义**: 所有类型现在统一在 `@zhin.js/core` 中 (`packages/core/src/types.ts`)
- **注意**: `console` 插件使用 `moduleResolution: "nodenext"` (Vite 兼容性)
### 2. 类型扩展
通过模块声明扩展全局类型 (在 `@zhin.js/core` 中定义)：

```typescript
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyService
    }
  }
  interface RegisteredAdapters {
    myAdapter: Adapter<MyBot>
  }
  interface Models {
    my_model: { id: number; name: string }
  }
}
```
```

### 3. 生命周期管理
通过 `useContext` 和返回清理函数管理生命周期：

```typescript
const plugin = usePlugin()

// 插件自动在 start() 时挂载
plugin.useContext('database', (db) => {
  console.log('数据库就绪，执行初始化')
  
  const timer = setInterval(() => {
    // 定时任务
  }, 1000)
  
  // 返回清理函数，stop() 时执行
  return () => {
    clearInterval(timer)
    console.log('清理资源')
  }
})

// 监听所有消息
plugin.addMiddleware(async (message, next) => {
  console.log('收到消息:', message.$raw)
  await next()
})

// 监听特定类型消息
plugin.on('message.private.receive', (message) => {
  console.log('私聊消息:', message.$raw)
})

plugin.on('message.group.receive', (message) => {
  console.log('群聊消息:', message.$raw)
})
```

### 4. 命令系统
使用 `segment-matcher` 解析命令模板：
- `<name:text>`: 必需参数
- `[name:text]`: 可选参数
- `[...items:at]`: 可变参数
- 内置类型: `text`, `number`, `at`, `image`, `face` 等

### 5. 组件系统
使用 `defineComponent` 或函数定义消息组件：

```typescript
// 函数组件
addComponent(async function myComp(props: { title: string }, context: ComponentContext) {
  return `标题: ${props.title}`
})

// 定义组件
const MyComp = defineComponent(async function MyComp(
  props: { title: string; count: number }
) {
  const message = `${props.title}: ${props.count}`
  return message
})
```

## 开发工作流

### 关键构建顺序
**重要**: 由于依赖关系，必须先构建 `logger` 和 `cli`，然后再构建其他包。

```bash
# 完整构建流程 (按依赖顺序)
pnpm build  # 自动按正确顺序构建：basic/* -> packages/* -> plugins/*

# 单独构建某个包
pnpm --filter @zhin.js/logger build
pnpm --filter @zhin.js/core build

# 构建流程（CI 中的实际顺序）
# 1. basic/** (logger, schema, cli, database)
# 2. packages/** (core, client, zhin, create-zhin)  
# 3. plugins/services/** (http, console, mcp)
# 4. plugins/adapters/** (icqq, kook, discord, qq, onebot11, process)
# 5. plugins/utils/** (music, sensitive-filter 等工具插件)
```

### 测试
```bash
pnpm test               # 运行 Vitest 测试 (globals: true, node 环境)
pnpm test:watch         # 监听模式
pnpm test:coverage      # 生成覆盖率报告
```

测试配置 (`vitest.config.ts`):
- 环境: Node.js
- 全局 API: `describe`, `it`, `expect` 等自动注入
- 隔离: `isolate: false` (共享状态以提高性能)
- 超时: 10s (测试和钩子)

### 开发模式
```bash
# 启动 test-bot 进行开发（支持热重载）
pnpm dev                # 在根目录执行，实际运行 test-bot
cd examples/test-bot && pnpm dev  # 或直接在 test-bot 运行

# 其他开发命令
pnpm start              # 生产模式启动
pnpm daemon             # 后台守护进程模式
pnpm stop               # 停止守护进程
```

### 发布流程
使用 Changesets 管理版本（自动化 CI/CD）：
```bash
pnpm release            # 创建 changeset (本地开发)
pnpm bump               # 更新版本号 (CI 自动执行)
pnpm pub                # 发布到 npm (CI 自动执行，需要 NPM_TOKEN)
```

CI 自动发布流程 (`.github/workflows/ci.yml`):
1. 推送到 `main` 分支触发
2. 自动测试 (`pnpm test`)
3. 构建所有包 (`pnpm build`)
4. Changesets Action 检测版本变化
5. 自动发布到 npm (如有 changeset)

## 常见模式

### 1. 事件系统
Plugin 继承 EventEmitter，支持三种事件传播方式：

```typescript
const plugin = usePlugin()

// emit: 仅触发自身监听器
plugin.emit('custom.event', data)

// dispatch: 向上冒泡（到父插件）和广播（到所有子插件）
plugin.dispatch('message.receive', message)

// broadcast: 只向下广播（到所有子插件）
plugin.broadcast('config.update', newConfig)

// 监听事件
plugin.on('message.receive', (message) => {
  console.log('收到消息:', message.$raw)
})

// 内置事件
// - message.receive: 消息接收
// - message.private.receive: 私聊消息
// - message.group.receive: 群聊消息
// - message.channel.receive: 频道消息
// - context.mounted: Context 挂载
// - context.disposed: Context 销毁
```

### 2. 中间件系统
**类型定义**：
```typescript
type MessageMiddleware<P extends RegisteredAdapter=RegisteredAdapter> = 
  (message: Message<AdapterMessage<P>>, next: () => Promise<void>) => MaybePromise<void>
```

**洋葱模型**，按注册顺序执行：
```typescript
// 基础中间件
addMiddleware(async (message, next) => {
  console.log('before')
  await next()
  console.log('after')
})

// 日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now()
  console.log(`[收到] ${message.$raw}`)
  await next()
  console.log(`[完成] 耗时 ${Date.now() - start}ms`)
})

// 过滤中间件（拦截消息）
addMiddleware(async (message, next) => {
  if (message.$raw.includes('广告')) {
    await message.$recall() // 撤回消息
    return // 不调用 next()，中断后续处理
  }
  await next()
})

// 平台特定中间件（类型安全）
addMiddleware<'icqq'>(async (message: Message<AdapterMessage<'icqq'>>, next) => {
  console.log(`QQ群: ${message.group_id}`)
  await next()
})
```

### 3. 组件系统
**类型定义**：
```typescript
type Component<P = any> = {
  (props: P, context: ComponentContext): Promise<SendContent>
  name: string
}
```

**定义和使用组件**：
```typescript
// 函数式组件
addComponent(async function UserCard(
  props: { userId: string; name: string },
  context: ComponentContext
) {
  return `👤 ${props.name} (ID: ${props.userId})`
})

// 使用 defineComponent
const Avatar = defineComponent(async function Avatar(
  props: { url: string; size?: number }
) {
  return `[image,file=${props.url}]`
}, 'Avatar')

addComponent(Avatar)

// 在命令中使用
addCommand(new MessageCommand('profile <userId:text>')
  .action(async (message, result) => {
    return `<UserCard userId="${result.params.userId}" name="张三" />`
  })
)

// 组件属性支持多种类型
<MyComp 
  text="string" 
  count={42} 
  enabled={true} 
  items={[1,2,3]}
  config={{key:"value"}}
/>
```

### 4. 定时任务（Cron）
**类型定义**：
```typescript
class Cron {
  constructor(cronExpression: string, callback: () => void | Promise<void>)
  run(): void
  stop(): void
  dispose(): void
}
```

**Cron 表达式格式**: `"分 时 日 月 周"` (5 字段，标准 cron 格式)

> croner 也支持 6 字段格式 `"秒 分 时 日 月 周"`，但推荐使用 5 字段格式。

**常用示例**：
```typescript
import { usePlugin, Cron } from 'zhin.js'

const { addCron, useContext } = usePlugin()

// 每天午夜执行
addCron(new Cron('0 0 * * *', async () => {
  console.log('每日任务')
}))

// 每15分钟
addCron(new Cron('*/15 * * * *', async () => {
  console.log('定时检查')
}))

// 工作日早上9点
addCron(new Cron('0 9 * * 1-5', async () => {
  console.log('工作日提醒')
}))

// 带数据库操作
useContext('database', (db) => {
  addCron(new Cron('0 2 * * *', async () => {
    // 凌晨2点清理数据
    const logs = db.model('logs')
    await logs.delete({ 
      timestamp: { $lt: Date.now() - 3*24*60*60*1000 } 
    })
  }))
})

// 常用表达式
'0 0 * * *'        // 每天午夜
'0 */2 * * *'      // 每2小时
'*/30 * * * *'     // 每30分钟
'0 12 * * *'       // 每天中午12点
'0 0 * * 0'        // 每周日
'0 0 1 * *'        // 每月1号
```

### 5. 数据库模型
在 setup.ts 中定义模型，在插件中使用：

```typescript
// setup.ts 中注册数据库
const db = Registry.create('sqlite', config.database, {
  users: {
    id: { type: 'integer', primary: true },
    name: { type: 'text', nullable: false },
    age: { type: 'integer', default: 0 },
    info: { type: 'json' }
  },
  logs: {
    id: { type: 'integer', primary: true },
    message: { type: 'text' },
    timestamp: { type: 'integer' }
  }
})

plugin.provide({ name: 'database', value: db })

// 插件中使用
plugin.useContext('database', async (db) => {
  // 获取模型
  const users = db.models.get('users')
  
  // CRUD 操作
  await users.create({ name: 'Alice', age: 25 })
  const allUsers = await users.select()
  await users.update({ age: 26 }, { name: 'Alice' })
  await users.delete({ name: 'Alice' })
})
```

### 6. HTTP 路由
依赖 `http` 插件和 `router` Context：

```typescript
useContext('router', (router) => {
  router.get('/api/health', (ctx) => {
    ctx.body = { status: 'ok' }
  })
  
  // WebSocket 路由
  const ws = router.ws('/api/realtime')
  ws.on('connection', (socket) => {
    socket.send('连接成功')
  })
})
```

### 5. Web 控制台集成
`console` 插件提供 Vite 开发服务器和 WebSocket 支持，插件可注册前端入口：

```typescript
useContext('web', (web) => {
  // 添加客户端入口文件（自动热重载）
  const dispose = web.addEntry(
    path.resolve(import.meta.dirname, './client/index.tsx')
  )
  return dispose // 返回清理函数
})
```

### 6. 客户端页面开发
使用 `@zhin.js/client` 动态添加前端页面（React Router 7）：

```tsx
// client/index.tsx
import { addPage } from '@zhin.js/client'
import { Settings } from 'lucide-react'

addPage({
  key: 'my-plugin-settings',
  path: '/plugins/my-plugin',
  title: '插件设置',
  icon: <Settings className="w-5 h-5" />,
  element: <SettingsPage />
})
```

**路由特性**：
- 自动父路由查找：`/admin/users` 会查找 `/admin` 并嵌套
- 支持多层嵌套：`/admin/users/detail` 自动嵌套到 `/admin/users`
- 热重载支持：修改客户端代码立即生效
- Redux 状态管理：自动持久化

## 性能注意事项

- **避免监听大目录**: 不要监听 `node_modules` 或根目录
- **精确配置扩展名**: 只监听必需的文件类型
- **调整防抖时间**: 开发环境 100-200ms，生产环境 300-500ms
- **及时清理监听器**: 在 `dispose` 中移除事件监听
- **使用 WeakMap/WeakRef**: 避免内存泄漏

## 错误处理

- 使用框架提供的 `ZhinError` 基类
- 中间件中的错误会被捕获并触发 `error` 事件
- 插件加载失败不会导致整个应用崩溃
- 热重载失败会自动回滚到上一个可用版本

## 常见陷阱

### 1. 循环依赖
避免在 Context 注册中创建循环依赖：
```typescript
// ❌ 错误：循环依赖
register({ name: 'serviceA', mounted: () => this.#use('serviceB') })
register({ name: 'serviceB', mounted: () => this.#use('serviceA') })

// ✅ 正确：在 useContext 中使用
register({ name: 'serviceA', mounted: () => new ServiceA() })
useContext('serviceA', (serviceA) => {
  // 在这里使用依赖
})
```

### 2. 导入路径
必须使用 `.js` 扩展名导入 TypeScript 文件：
```typescript
// ❌ 错误
import { foo } from './bar'
import { baz } from './qux.ts'

// ✅ 正确
import { foo } from './bar.js'
import { baz } from './qux.js'
```

### 3. 清理资源
在 `dispose` 或返回的清理函数中释放资源：
```typescript
useContext('database', (db) => {
  const timer = setInterval(() => {
    // 定时任务
  }, 1000)
  
  // 返回清理函数
  return () => {
    clearInterval(timer)
  }
})
```

### 4. 插件加载顺序
确保依赖的插件先加载：
```typescript
// ✅ 正确的顺序
plugins: [
  'http',              // 先加载 HTTP
  'adapter-process',   // 然后加载适配器
  'console',           // 然后加载控制台
  'my-plugin'          // 最后加载依赖上述插件的插件
]
```

### 5. AsyncLocalStorage 上下文
Plugin 使用 AsyncLocalStorage 管理上下文，确保在正确的作用域调用 `usePlugin()`：
```typescript
// ✅ 正确：在模块顶层调用
const plugin = usePlugin()

// ❌ 错误：在异步函数中调用可能导致上下文丢失
async function setup() {
  const plugin = usePlugin() // 可能无法获取正确的上下文
}
```

## 插件重构指南

### 重构优先级
**按以下顺序进行重构**（从高到低）：
1. **packages/** - 核心框架层，所有插件的基础
   - core, client, create-zhin, zhin
2. **plugins/services/** - 基础服务插件，其他插件的依赖
   - http, console, mcp
3. **plugins/adapters/** - 平台适配器
   - process (已内置到 core), icqq, kook, discord, qq, onebot11, telegram, slack 等
4. **plugins/utils/** - 工具插件
   - music, sensitive-filter 等

### 旧 API → 新 API 映射

**核心导入**：
```typescript
// ❌ 旧版
import { register, defineSchema, Schema, useApp, useDatabase } from "@zhin.js/core"

// ✅ 新版
import { usePlugin, defineSchema, Schema } from "zhin.js"
```

**获取实例**：
```typescript
// ❌ 旧版
const app = useApp()
const db = useDatabase()

// ✅ 新版
const plugin = usePlugin()
const root = plugin.root  // 根插件
const db = plugin.inject('database')  // 注入 Context
```

**配置Schema**：
```typescript
// ❌ 旧版
const schema = defineSchema(Schema.object({ ... }))
const config = schema(plugin.config, 'pluginName')

// ✅ 新版（推荐）- Schema 自动注册到全局，用于 Web 控制台表单渲染
const getConfig = plugin.defineSchema(Schema.object({
  port: Schema.number().default(8080).description('服务端口'),
  enabled: Schema.boolean().default(true).description('是否启用'),
}))
const config = getConfig()

// ✅ 或使用便捷函数
const getConfig = defineSchema(Schema.object({ ... }))
const config = getConfig()

// ✅ 手动获取配置（不需要 Schema 验证时）
const configService = plugin.inject('config')
const appConfig = configService.get('zhin.config.yml')
const config = appConfig.pluginName || {}
```

**Context 注册**：
```typescript
// ❌ 旧版
register({ name: 'myContext', value: myValue })

// ✅ 新版（同步值）
plugin.provide({
  name: 'myContext',
  value: myValue
})

// ✅ 新版（异步挂载）
plugin.provide({
  name: 'myContext',
  mounted: async (plugin) => {
    const value = await createMyService()
    return value
  },
  dispose: async (value) => {
    await value.cleanup()
  }
})
```

**数据库操作**：
```typescript
// 两种方式均可使用
const model = db.model('tableName')       // 高层封装，支持 options 参数
const model = db.models.get('tableName')  // 直接 Map 访问
```

**类型扩展**：
```typescript
// ❌ 旧版
declare module '@zhin.js/types' {
  interface GlobalContext {
    myContext: MyType
  }
}

// ✅ 新版
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myContext: MyType
    }
  }
}
```

### Plugin API 变化

**属性访问**：
- `app.dependencyList` → `plugin.children` (所有子插件)
- `app.contextList` → `plugin.contexts` (Map<string, any>)
- `app.getContext(name)` → `plugin.inject(name)`
- `app.getConfig()` → `plugin.inject('config').getData('zhin.config.yml')`
- `plugin.findPluginByName(name)` → 遍历 `plugin.children` 或使用文件路径判断
- `plugin.schema` → 已移除，直接使用 `@zhin.js/schema`

**方法调用**：
- `plugin.commands` → `plugin.commands` (仍然存在，Map<string, MessageCommand>)
- `plugin.components` → `plugin.components` (仍然存在，Map<string, Component>)
- `plugin.addMiddleware()` → `plugin.addMiddleware()` (仍然存在)
- `plugin.addCommand()` → `plugin.addCommand()` (仍然存在)
- `plugin.definitions` → 已移除，使用 `database.models.get('tableName')`

**新增方法**：
- `plugin.provide()` - 注册 Context
- `plugin.useContext()` - 使用多个 Context
- `plugin.inject()` - 直接注入单个 Context
- `plugin.import()` - 动态导入插件
- `plugin.start()` - 启动插件
- `plugin.stop()` - 停止插件
- `plugin.reload()` - 重载插件

## 插件系统

### HTTP 插件 (`@zhin.js/http`)
- 基于 Koa.js 的 HTTP 服务器
- 提供 `koa`、`router`、`server` 三个 Context
- 默认端口 8086，支持 Basic Auth (admin/123456)
- 内置 API: `/api/adapters`, `/api/system/status`, `/api/plugins`

### Console 插件 (`@zhin.js/console`)
- Vite 开发服务器，访问 `http://localhost:8086/vite/`
- 提供 `web` Context，支持 `addEntry(entry: string)` 方法
- 自动处理客户端入口文件的热重载
- WebSocket 同步动态入口脚本

### Client 插件 (`@zhin.js/client`)
- React Router 7 + Redux 状态管理
- 页面管理 API: `addPage()`, `removePage()`, `updatePage()`
- 支持动态路由、自动嵌套、事件监听
- 内置 WebSocket hooks: `useWebSocket()`

## 配置文件模式

支持多种配置格式，推荐使用 `zhin.config.ts`：

```typescript
import { defineConfig } from 'zhin.js'
import path from 'node:path'

export default defineConfig(async (env) => {
  return {
    log_level: LogLevel.INFO,
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    bots: [
      { name: 'console-bot', context: 'process' }
    ],
    plugin_dirs: [
      './src/plugins',
      'node_modules',
      path.join('node_modules', '@zhin.js')
    ],
    plugins: [
      'http',              // 先加载 HTTP 服务
      'adapter-process',   // 然后加载适配器
      'console',           // 最后加载控制台
      'my-plugin'
    ],
    debug: env.DEBUG === 'true'
  }
})
```

**插件加载顺序**：
1. `http` - 注册 HTTP 服务和基础 API
2. 适配器插件 - 注册平台相关 API (如 `/api/icqq/*`)
3. `console` - 提供 Vite 开发服务器和静态文件处理
4. 业务插件 - 依赖上述 Context

## 环境要求

- Node.js 20.19.0+ 或 22.12.0+
- pnpm 9.0+
- TypeScript 5.3+

## 参考文档

- 架构设计: `docs/guide/architecture.md`
- 核心创新: `docs/guide/innovations.md`
- 插件开发: `docs/plugin/development.md`
- 适配器开发: `docs/adapter/development.md`
- 最佳实践: `docs/guide/best-practices.md`
