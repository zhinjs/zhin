# zhin.js

Zhin 机器人框架的主包，重新导出 `@zhin.js/core` 和 `@zhin.js/logger` 的所有功能，提供开箱即用的机器人开发体验。

## 特性

- 📦 **开箱即用** - 一个包含所有核心功能
- 🔌 **插件系统** - 强大的插件化架构
- 🔥 **热重载** - 开发时自动重载代码
- 🌐 **多平台支持** - 统一API支持多个聊天平台
- 🗄️ **数据库集成** - 内置数据库抽象层
- 📝 **类型安全** - 完整的 TypeScript 支持
- 📊 **日志系统** - 结构化日志记录

## 安装

```bash
pnpm add zhin.js
```

## 快速开始

### 创建应用

```typescript
import { createApp } from 'zhin.js'

const app = await createApp({
  bots: [
    {
      name: 'console',
      context: 'process'
    }
  ]
})
```

### 使用 Hooks API

```typescript
import { 
  usePlugin,
  onMessage, 
  addCommand,
  onMounted 
} from 'zhin.js'

// 监听消息
onMessage(async (message) => {
  if (message.$raw === 'ping') {
    await message.$reply('pong!')
  }
})

// 添加命令
addCommand(new MessageCommand('hello <name>')
  .action(async (message, result) => {
    return `Hello, ${result.params.name}!`
  }))

// 生命周期钩子
onMounted(() => {
  console.log('插件已挂载')
})
```

## 导出内容

### 从 @zhin.js/core

```typescript
// 核心类
export {
  App,
  Plugin,
  Adapter,
  Bot,
  Message,
  MessageCommand,
  Component
} from '@zhin.js/core'

// Hooks API
export {
  useApp,
  usePlugin,
  useLogger,
  useDatabase,
  defineModel,
  register,
  registerAdapter,
  useContext,
  addMiddleware,
  addCommand,
  addComponent,
  onEvent,
  onMessage,
  onGroupMessage,
  onPrivateMessage,
  onMounted,
  onDispose,
  onAppReady,
  onDatabaseReady,
  sendMessage,
  beforeSend,
  usePrompt
} from '@zhin.js/core'

// 工具
export {
  createApp
} from '@zhin.js/core'

// 配置
export {
  defineConfig
} from '@zhin.js/core'

// 错误处理
export {
  PluginError,
  MessageError,
  errorManager
} from '@zhin.js/core'

// Cron
export {
  Cron
} from '@zhin.js/core'
```

### 从 @zhin.js/logger

```typescript
export {
  Logger,
  LogLevel,
  ConsoleTransport,
  FileTransport,
  StreamTransport,
  getLogger,
  setLogger,
  setLevel,
  setName,
  addTransport,
  removeTransport
} from '@zhin.js/logger'

// 默认logger
export {
  default as logger,
  debug,
  info,
  success,
  warn,
  error,
  time,
  timeEnd
} from '@zhin.js/logger'
```

### 从 @zhin.js/database

```typescript
export {
  RelatedDatabase,
  DocumentDatabase,
  KeyValueDatabase,
  Schema,
  Registry,
  Model
} from '@zhin.js/database'
```

### 从 @zhin.js/hmr

```typescript
export {
  Dependency
} from '@zhin.js/hmr'
```

### JSX 支持

```typescript
export {
  h,
  Fragment
} from '@zhin.js/core/jsx'

export {
  jsx,
  jsxDEV,
  jsxs
} from '@zhin.js/core/jsx-runtime'
```

## 示例

### 完整的机器人

```typescript
import { createApp, onMessage, addCommand, MessageCommand } from 'zhin.js'

// 创建应用
const app = await createApp({
  bots: [
    {
      name: 'my-bot',
      context: 'process'
    }
  ],
  plugins: [
    'http',
    'console',
    'adapter-process'
  ]
})

// 添加命令
addCommand(new MessageCommand('echo <text...>')
  .action(async (message, { text }) => {
    return text.join(' ')
  }))

// 监听所有消息
onMessage(async (message) => {
  console.log('收到消息:', message.$content)
})
```

### 使用数据库

```typescript
import { 
  createApp, 
  defineModel, 
  Schema,
  onDatabaseReady 
} from 'zhin.js'

// 定义模型
interface User {
  id: number
  username: string
  email: string
}

onDatabaseReady((db) => {
  // 定义模型
  const UserModel = defineModel<User>('User', new Schema({
    id: Schema.number().primary(),
    username: Schema.string().required(),
    email: Schema.string().required()
  }))
  
  // 使用模型
  onMessage(async (message) => {
    if (message.$content.startsWith('/register ')) {
      const [, username, email] = message.$content.split(' ')
      
      const user = await UserModel.insert({
        username,
        email
      }).execute()
      
      await message.$reply(`用户 ${username} 注册成功！`)
    }
  })
})
```

### 使用 JSX

```typescript
/** @jsx h */
import { h, onMessage } from 'zhin.js'

onMessage(async (message) => {
  if (message.$content === '/card') {
    const card = (
      <message>
        <text>这是一张卡片</text>
        <image url="https://example.com/image.jpg" />
        <at id={message.$user.id} />
      </message>
    )
    
    await message.$reply(card)
  }
})
```

配置 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

### 创建插件

```typescript
// plugins/greeting.ts
import { onMessage, onMounted, onDispose } from 'zhin.js'

let messageCount = 0

onMessage(async (message) => {
  messageCount++
  console.log('消息计数:', messageCount)
})

onMounted(() => {
  console.log('问候插件已加载')
})

onDispose(() => {
  console.log('问候插件已卸载，总消息数:', messageCount)
})
```

在配置中使用：

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: [
    './plugins/greeting'
  ]
})
```

## 配置

### zhin.config.ts

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  // 机器人配置
  bots: [
    {
      name: 'my-bot',
      context: 'process'
    }
  ],
  
  // 插件列表
  plugins: [
    'http',
    'console',
    'adapter-process'
  ],
  
  // 插件目录
  plugin_dirs: [
    './plugins',
    'node_modules/@zhin.js'
  ],
  
  // 数据库配置
  database: {
    dialect: 'sqlite',
    storage: './data/bot.db'
  },
  
  // 调试模式
  debug: false
})
```

## 类型支持

Zhin.js 提供完整的 TypeScript 类型支持：

```typescript
import type { 
  App,
  Plugin,
  Message,
  MessageCommand,
  SendOptions
} from 'zhin.js'

// 所有API都有完整的类型提示
```

## 生态系统

### 官方插件

- `@zhin.js/http` - HTTP 服务器
- `@zhin.js/console` - Web 控制台
- `@zhin.js/client` - 前端框架

### 官方适配器

- `@zhin.js/adapter-process` - 控制台适配器
- `@zhin.js/adapter-discord` - Discord 适配器
- `@zhin.js/adapter-telegram` - Telegram 适配器
- `@zhin.js/adapter-qq` - QQ 适配器
- `@zhin.js/adapter-icqq` - ICQQ 适配器
- `@zhin.js/adapter-kook` - KOOK 适配器
- `@zhin.js/adapter-onebot11` - OneBot v11 适配器
- `@zhin.js/adapter-lark` - 飞书适配器
- `@zhin.js/adapter-wechat-mp` - 微信公众号适配器
- `@zhin.js/adapter-email` - 邮件适配器

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [快速开始](https://docs.zhin.dev/guide/getting-started)
- [API 参考](https://docs.zhin.dev/api/core)
- [插件开发](https://docs.zhin.dev/plugin/getting-started)
- [GitHub 仓库](https://github.com/zhinjs/zhin)

## 许可证

MIT License
