# Zhin.js AI Coding Agent Instructions

Zhin.js 是一个现代化的 TypeScript 机器人框架，采用创新的热重载系统和函数式依赖注入架构。

## 项目架构

### 四层抽象设计
```
App 层 (应用入口)
  ↓
HMR 层 (热重载引擎)
  ↓
Dependency 层 (依赖注入基类)
  ↓
Plugin 层 (业务逻辑)
```

- **App** (`packages/core/src/app.ts`): 继承自 HMR，管理适配器、机器人实例、消息路由
- **HMR** (`packages/hmr/src/hmr.ts`): 组合 FileWatcher、ModuleLoader、PerformanceMonitor、ReloadManager 四大模块
- **Dependency** (`packages/hmr/src/dependency.ts`): 提供生命周期管理、Context 系统、事件广播机制
- **Plugin** (`packages/core/src/plugin.ts`): 继承 Dependency，处理中间件、命令、组件

### Monorepo 结构 (pnpm workspace)
```
adapters/       # 平台适配器 (icqq, kook, discord, onebot11, process)
packages/       # 核心包 (core, hmr, cli, database, logger, types)
plugins/        # 内置插件 (http, console, client)
test-bot/       # 示例机器人
```

## 核心开发模式

### 1. 函数式依赖注入
使用声明式 API 注入依赖，框架自动管理生命周期和初始化顺序：

```typescript
// 注册 Context
register({
  name: 'database',
  async mounted(plugin) {
    const db = new Database()
    await db.connect()
    return db
  },
  async dispose(db) {
    await db.disconnect()
  }
})

// 使用 Context (自动等待依赖就绪)
useContext('database', 'http', (db, http) => {
  http.router.get('/api/users', async (ctx) => {
    ctx.body = await db.model('users').select()
  })
})
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
import { addCommand, MessageCommand, useLogger } from 'zhin.js'

const logger = useLogger()

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    logger.info(`Hello command from ${result.args.name}`)
    return `Hello, ${result.args.name}!`
  })
)
```

### 4. 适配器开发
实现 `Bot` 接口和注册适配器：

```typescript
// adapters/my-adapter/src/index.ts
import { Adapter, Bot, registerAdapter } from 'zhin.js'

class MyBot implements Bot<MyConfig> {
  async $connect() { /* 连接逻辑 */ }
  async $disconnect() { /* 断开连接 */ }
  async $sendMessage(options: SendOptions) { /* 发送消息 */ }
  $formatMessage(raw) { return Message.from(...) }
}

registerAdapter(new Adapter('my-platform', MyBot))
```

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

const MyComp = defineComponent({
  name: 'my-comp',
  props: { title: String, count: Number },
  render(props) {
    return <text>{props.title}: {props.count}</text>
  }
})
```

## 关键约定

### 1. 导入路径
- 使用 `.js` 扩展名导入 TS 文件: `import { foo } from './bar.js'`
- TypeScript 配置使用 `moduleResolution: "bundler"`
- 核心包别名: `@zhin.js/core`, `@zhin.js/hmr`, `@zhin.js/types`

### 2. 类型扩展
通过模块声明扩展全局类型：

```typescript
declare module '@zhin.js/types' {
  interface GlobalContext {
    myService: MyService
  }
  interface RegisteredAdapters {
    myAdapter: Adapter<MyBot>
  }
  interface Models {
    my_model: { id: number; name: string }
  }
}
```

### 3. 生命周期钩子
- `onMounted()`: 插件挂载完成
- `onDispose()`: 插件销毁前清理
- `onMessage()`: 监听所有消息
- `onGroupMessage()` / `onPrivateMessage()`: 分类消息监听
- `onDatabaseReady()`: 数据库就绪

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
const MyComp = defineComponent({
  name: 'my-comp',
  props: { title: String, count: Number },
  data() {
    return { message: `${this.title}: ${this.count}` }
  },
  render(props, context) {
    return `<text>${context.message}</text>`
  }
})
```

## 开发工作流

### 构建流程
```bash
pnpm build              # 构建所有包
pnpm build --filter @zhin.js/core  # 构建单个包
```

**重要**: logger 和 cli 必须先构建（CI 中有体现）

### 测试
```bash
pnpm test               # 运行 Vitest 测试
pnpm test:coverage      # 生成覆盖率报告
```

### 开发模式
```bash
pnpm dev                # 启动 test-bot，支持热重载
cd test-bot && pnpm dev # 直接在 test-bot 运行
```

### 发布流程
使用 Changesets 管理版本：
```bash
pnpm release            # 创建 changeset
pnpm bump               # 更新版本号
pnpm pub                # 发布到 npm
```

## 常见模式

### 1. 事件系统
- `dispatch(event, ...args)`: 向上冒泡（到父依赖或广播）
- `broadcast(event, ...args)`: 向下广播（到所有子依赖）
- `emit(event, ...args)`: 仅触发自身监听器

### 2. 中间件
洋葱模型，按注册顺序执行：

```typescript
addMiddleware(async (message, next) => {
  console.log('before')
  await next()
  console.log('after')
})
```

### 3. 数据库模型
使用 `defineModel` 定义表结构：

```typescript
defineModel('users', {
  name: { type: 'text', nullable: false },
  age: { type: 'integer', default: 0 },
  info: { type: 'json' }
})

onDatabaseReady(async (db) => {
  const users = db.model('users')
  await users.create({ name: 'Alice', age: 25 })
})
```

### 4. HTTP 路由
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
