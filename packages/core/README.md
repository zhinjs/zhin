# @zhin.js/core

Zhin 机器人框架核心包，基于 HMR（热模块替换）系统构建的现代化机器人开发框架。

## 核心特性

- 🔥 **热模块替换**: 基于 @zhin.js/hmr 的热更新系统
- 🔌 **插件化架构**: 完整的插件生命周期管理
- 🤖 **多平台适配**: 支持多种聊天平台适配器
- 🎯 **命令系统**: 基于 segment-matcher 的智能消息匹配
- 🧩 **组件系统**: 支持模板渲染、属性绑定、插槽的组件化开发
- ⚡ **中间件链**: 灵活的消息处理中间件机制
- 🔧 **TypeScript**: 完整的类型支持

## 核心组件

### App 类

应用核心类，继承自 `HMR<Plugin>`：

```typescript
import { createApp } from '@zhin.js/core'

// 创建应用实例
const app = await createApp({
  plugin_dirs: ['./plugins'],
  plugins: ['my-plugin'],
  bots: [{
    context: 'onebot11',
    name: 'my-bot',
    url: 'ws://localhost:8080'
  }],
  debug: true
})

// 启动应用
await app.start()
```

**主要功能**：
- 插件生命周期管理
- 配置文件加载和管理
- 适配器和机器人实例管理
- 消息路由和分发
- 热更新监听

### Plugin 类

插件基类，继承自 `Dependency<Plugin>`：

```typescript
import { usePlugin, addMiddleware, addCommand, addComponent } from '@zhin.js/core'

const plugin = usePlugin()

// 添加中间件
addMiddleware(async (message, next) => {
  console.log(`[${plugin.name}] 收到消息:`, message.raw)
  await next()
})

// 添加命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return '你好！'
  })
)
```

**主要功能**：
- 中间件链管理
- 命令注册和处理
- 组件管理
- 事件监听和分发
- 消息发送前处理 (beforeSend)

### Adapter 类

适配器基类，用于连接不同聊天平台：

```typescript
import { Adapter, Bot, Plugin } from '@zhin.js/core'

class MyBot implements Bot {
  constructor(public plugin: Plugin, public config: BotConfig) {}
  
  async connect() {
    // 连接逻辑
  }
  
  async disconnect() {
    // 断开连接逻辑
  }
  
  async sendMessage(options: SendOptions) {
    // 发送消息逻辑
  }
}

// 注册适配器
const adapter = new Adapter('my-platform', MyBot)
```

### MessageCommand 类

基于 `SegmentMatcher` 的命令处理器：

```typescript
import { MessageCommand } from '@zhin.js/core'

const command = new MessageCommand('echo <content:text>')
  .action(async (message, result) => {
    const content = result.args.content
    return `你说了：${content}`
  })

addCommand(command)
```

### Component 系统

强大的组件渲染系统：

```typescript
import { defineComponent, addComponent } from '@zhin.js/core'

// 定义组件
const MyComponent = defineComponent({
  name: 'my-comp',
  props: {
    title: String,
    count: { type: Number, default: 0 }
  },
  data(this: { title: string, count: number }) {
    return {
      message: `${this.title}: ${this.count}`
    }
  },
  render(props, context) {
    return `<text>${context.message}</text>`
  }
})

// 注册组件
addComponent(MyComponent)

// 在消息中使用
// <my-comp title="计数器" :count="5"/>
```

## Hooks API

### 应用和插件
```typescript
// 获取应用实例
const app = useApp()

// 获取当前插件
const plugin = usePlugin()

// 获取插件日志器
const logger = useLogger()
```

### 事件监听
```typescript
// 监听所有消息
onMessage(async (message) => {
  console.log('收到消息:', message.raw)
})

// 监听群聊消息
onGroupMessage(async (message) => {
  if (message.raw.includes('帮助')) {
    await message.reply('这里是帮助信息')
  }
})

// 监听私聊消息
onPrivateMessage(async (message) => {
  await message.reply('私聊回复')
})

// 自定义事件监听
onEvent('custom.event', (data) => {
  console.log('自定义事件:', data)
})
```

### 生命周期
```typescript
// 插件挂载时
onMounted(async (plugin) => {
  console.log('插件已挂载:', plugin.name)
})

// 插件销毁时
onDispose(() => {
  console.log('插件正在销毁')
})
```

### 上下文管理
```typescript
// 注册上下文
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

// 使用上下文依赖
useContext('database', async (db) => {
  const users = await db.getUsers()
  console.log('用户列表:', users)
})
```

### 适配器注册
```typescript
import { registerAdapter } from '@zhin.js/core'

registerAdapter(new Adapter('my-platform', MyBot))
```

### 消息处理
```typescript
// 发送消息前处理
beforeSend(async (options) => {
  console.log('即将发送消息:', options)
  // 可以修改消息内容
  return options
})

// 发送消息
await sendMessage({
  type: 'group',
  id: '123456',
  context: 'onebot11',
  bot: 'my-bot',
  content: '你好世界！'
})
```

## 类型定义

### 消息相关
```typescript
interface Message {
  id: string
  adapter: string
  bot: string
  content: MessageSegment[]
  sender: MessageSender
  channel: MessageChannel
  timestamp: number
  raw: string
  reply(content: SendContent, quote?: boolean | string): Promise<void>
}

interface MessageSegment {
  type: string
  data: Record<string, any>
}

type SendContent = string | MessageSegment | (string | MessageSegment)[]
```

### 配置相关
```typescript
interface AppConfig {
  bots?: BotConfig[]
  plugin_dirs?: string[]
  plugins?: string[]
  disable_dependencies?: string[]
  debug?: boolean
}

interface BotConfig {
  name: string
  context: string
  [key: string]: any
}
```

### 机器人接口
```typescript
interface Bot<T extends BotConfig = BotConfig> {
  config: T
  connected?: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(options: SendOptions): Promise<void>
}
```

## 中间件系统

```typescript
type MessageMiddleware = (
  message: Message, 
  next: () => Promise<void>
) => Promise<void> | void

// 添加身份验证中间件
addMiddleware(async (message, next) => {
  if (isAdmin(message.sender.id)) {
    await next()
  } else {
    await message.reply('权限不足')
  }
})

// 添加日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  console.log(`处理消息耗时: ${duration}ms`)
})
```

## 配置文件支持

支持多种配置文件格式：
- `zhin.config.ts` - JavaScript 配置
- `zhin.config.ts` - TypeScript 配置  
- `zhin.config.json` - JSON 配置
- `zhin.config.yaml` - YAML 配置
- `zhin.config.toml` - TOML 配置

```typescript
// zhin.config.ts
export default {
  plugin_dirs: ['./plugins', './node_modules'],
  plugins: ['my-plugin'],
  bots: [
    {
      context: 'onebot11',
      name: 'bot1',
      url: 'ws://localhost:8080',
      access_token: 'your-token'
    }
  ],
  debug: process.env.NODE_ENV === 'development'
}
```

## 开发工具

### 类型生成
```bash
# 自动生成环境类型定义
npx zhin dev  # 开发时自动生成
```

### 热更新
```bash
# 开发模式启动，支持热更新
npx zhin dev
```

## 依赖项

- `@zhin.js/hmr` - 热模块替换系统
- `segment-matcher` - 消息片段匹配器
- `yaml` - YAML 配置文件支持
- `toml` - TOML 配置文件支持
- `dotenv` - 环境变量支持

## 许可证

MIT License
MIT License