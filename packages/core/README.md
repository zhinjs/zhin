# @zhin.js/core

Zhin 机器人框架的核心实现，提供应用管理、插件系统、消息处理、命令系统和数据库集成。

## 特性

- 🚀 **App 应用管理** - 继承自 HMR，支持热重载
- 🔌 **Plugin 插件系统** - 完整的插件生命周期管理
- 📨 **消息处理** - 统一的消息接口和中间件系统
- 🎯 **命令系统** - 基于 segment-matcher 的命令解析
- 🎨 **组件系统** - 函数式组件用于构建消息
- ⏰ **定时任务** - 基于 cron-parser 的 Cron 支持
- 🗄️ **数据库集成** - 内置数据库抽象层
- 🪝 **Hooks API** - React 风格的 API
- 🔧 **适配器系统** - 多平台适配器支持
- 📊 **日志传输** - 数据库日志持久化

## 安装

```bash
pnpm add @zhin.js/core
```

推荐使用主包 `zhin.js`：

```bash
pnpm add zhin.js
```

## 核心类

### App

应用主类，继承自 `HMR`，负责插件管理、适配器注册、数据库集成等。

```typescript
import { App } from '@zhin.js/core'

const app = new App({
  plugin_dirs: ['./plugins'],
  plugins: ['http', 'console'],
  bots: [
    {
      name: 'my-bot',
      context: 'process'
    }
  ],
  database: {
    dialect: 'sqlite',
    filename: './data/bot.db'
  }
})

await app.start()
```

**主要方法：**

- `app.start(mode?: 'dev' | 'prod')` - 启动应用
- `app.stop()` - 停止应用
- `app.use(filePath: string)` - 加载插件
- `app.sendMessage(options: SendOptions)` - 发送消息
- `app.recallMessage(adapter, bot, id)` - 撤回消息
- `app.getContext<T>(name: string)` - 获取上下文
- `app.updateConfig(config)` - 更新配置

**属性：**

- `app.adapters` - 已注册的适配器列表
- `app.database` - 数据库实例
- `app.schemas` - 所有模型的 Schema
- `app.dependencyList` - 所有依赖（插件）

### Plugin

插件类，继承自 `Dependency`，提供命令、中间件、组件、定时任务等功能。

```typescript
import { usePlugin, onMessage, onMounted } from 'zhin.js'

const plugin = usePlugin()

// 添加命令
plugin.addCommand(command)

// 添加中间件
plugin.addMiddleware(async (message, next) => {
  console.log('收到消息:', message.$content)
  await next()
})

// 添加组件
plugin.addComponent(component)

// 定时任务
plugin.cron('0 0 * * *', () => {
  console.log('每天零点执行')
})

// 定义模型
plugin.defineModel('User', schema)
```

**主要方法：**

- `plugin.addCommand(command)` - 添加命令
- `plugin.addMiddleware(middleware)` - 添加中间件
- `plugin.addComponent(component)` - 添加组件
- `plugin.cron(expression, callback)` - 添加定时任务
- `plugin.defineModel(name, schema)` - 定义数据模型
- `plugin.beforeSend(handler)` - 消息发送前处理
- `plugin.sendMessage(options)` - 发送消息
- `plugin.recallMessage(adapter, bot, id)` - 撤回消息
- `plugin.prompt(message)` - 等待用户输入

**属性：**

- `plugin.app` - 所属的 App 实例
- `plugin.logger` - 插件日志器
- `plugin.middlewares` - 中间件列表
- `plugin.commands` - 命令列表
- `plugin.components` - 组件映射
- `plugin.schemas` - 模型 Schema 映射
- `plugin.crons` - 定时任务列表

### MessageCommand

命令类，基于 `segment-matcher` 实现命令解析。

```typescript
import { MessageCommand } from '@zhin.js/core'

const command = new MessageCommand('hello <name> [age:number]')
  .scope('discord', 'telegram')  // 限定适配器
  .action(async (message, result) => {
    const { name, age } = result.params
    return `Hello, ${name}${age ? `, age ${age}` : ''}!`
  })

plugin.addCommand(command)
```

**主要方法：**

- `command.scope(...adapters)` - 限定适配器范围
- `command.action(callback)` - 注册命令处理函数
- `command.handle(message)` - 处理消息（自动调用）

### Message

消息接口，包含消息的完整信息。

```typescript
interface MessageBase {
  $id: string                    // 消息ID
  $adapter: string               // 适配器名称
  $bot: string                   // 机器人名称
  $content: MessageElement[]     // 消息内容（元素数组）
  $sender: MessageSender         // 发送者信息
  $channel: MessageChannel       // 频道信息
  $timestamp: number             // 时间戳
  $raw: string                   // 原始消息
  
  // 回复消息
  $reply(content: SendContent, quote?: boolean | string): Promise<string>
}

type Message<T = {}> = MessageBase & T
```

**使用示例：**

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('消息ID:', message.$id)
  console.log('内容:', message.$content)
  console.log('发送者:', message.$sender)
  
  // 回复消息
  await message.$reply('收到消息')
  
  // 引用回复
  await message.$reply('引用回复', true)
})
```

### Component

函数式组件，用于构建消息内容。

```typescript
import { Component, defineComponent } from '@zhin.js/core'

// 定义组件
const Card: Component<{ title: string; content: string }> = defineComponent(
  async ({ title, content }, context) => {
    return `【${title}】\n${content}`
  },
  'Card'
)

// 使用组件
addComponent(Card)

// 在消息中使用
await message.$reply('<Card title="标题" content="内容"/>')
```

### Cron

定时任务类，基于 `cron-parser` 实现。

```typescript
import { Cron } from '@zhin.js/core'

const cron = new Cron('0 0 * * *', async () => {
  console.log('每天零点执行')
})

// 启动定时任务
cron.run()

// 停止定时任务
cron.stop()

// 获取下次执行时间
const nextTime = cron.getNextExecutionTime()

// 检查运行状态
console.log('是否运行:', cron.running)

// 销毁任务
cron.dispose()
```

**Cron 表达式格式：**

```
秒 分 时 日 月 周
*  *  *  *  *  *
```

**常用示例：**

- `0 0 * * *` - 每天零点
- `0 */15 * * *` - 每15分钟
- `0 0 12 * * *` - 每天中午12点
- `0 0 0 1 * *` - 每月1号零点
- `0 0 0 * * 0` - 每周日零点

## Hooks API

### 应用 Hooks

```typescript
import { useApp, usePlugin, useLogger, useDatabase } from 'zhin.js'

// 获取 App 实例
const app = useApp()

// 获取当前插件实例
const plugin = usePlugin()

// 获取日志器
const logger = useLogger()

// 获取数据库实例
const database = useDatabase()
```

### 上下文 Hooks

```typescript
import { register, registerAdapter, useContext } from 'zhin.js'

// 注册上下文
register({
  name: 'myService',
  async mounted(plugin) {
    return new MyService()
  },
  dispose() {
    // 清理
  }
})

// 注册适配器
registerAdapter(myAdapter)

// 使用上下文
useContext(['http', 'database'], (http, database) => {
  // 使用服务
  return (context) => {
    // 清理函数
  }
})
```

### 消息 Hooks

```typescript
import { 
  onMessage, 
  onGroupMessage, 
  onPrivateMessage,
  beforeSend 
} from 'zhin.js'

// 监听所有消息
onMessage(async (message) => {
  console.log('收到消息')
})

// 监听群组消息
onGroupMessage(async (message) => {
  console.log('群组消息')
})

// 监听私聊消息
onPrivateMessage(async (message) => {
  console.log('私聊消息')
})

// 消息发送前处理
beforeSend((options) => {
  console.log('准备发送消息')
  return options
})
```

### 命令和组件 Hooks

```typescript
import { addCommand, addComponent, addMiddleware } from 'zhin.js'

// 添加命令
addCommand(command)

// 添加组件
addComponent(component)

// 添加中间件
addMiddleware(async (message, next) => {
  // 处理消息
  await next()
})
```

### 生命周期 Hooks

```typescript
import { onMounted, onDispose, onAppReady, onDatabaseReady } from 'zhin.js'

// 插件挂载
onMounted(() => {
  console.log('插件已挂载')
})

// 插件销毁
onDispose(() => {
  console.log('插件销毁')
})

// 应用就绪
onAppReady(() => {
  console.log('应用已就绪')
})

// 数据库就绪
onDatabaseReady((database) => {
  console.log('数据库已就绪')
})
```

### 数据库 Hooks

```typescript
import { defineModel, useDatabase } from 'zhin.js'

// 定义模型
const UserModel = defineModel('User', schema)

// 使用数据库
const db = useDatabase()
```

### 其他 Hooks

```typescript
import { onEvent, usePrompt } from 'zhin.js'

// 监听自定义事件
onEvent('custom-event', (data) => {
  console.log('自定义事件:', data)
})

// 等待用户输入
const prompt = usePrompt(message)
const response = await prompt.text('请输入内容:')
```

## 错误处理

框架内置错误处理系统。

```typescript
import { PluginError, MessageError, errorManager } from '@zhin.js/core'

// 插件错误
throw new PluginError('错误信息', pluginName, context)

// 消息错误
throw new MessageError('错误信息', messageId, channelId, context)

// 自定义错误处理
errorManager.addHandler((error) => {
  console.error('捕获错误:', error)
})
```

## 数据库集成

```typescript
import { defineModel, Schema, onDatabaseReady } from 'zhin.js'

interface User {
  id: number
  username: string
  email: string
}

onDatabaseReady((db) => {
  // 定义模型
  const UserModel = defineModel<User>('User', new Schema({
    id: { type: 'integer', primary: true },
    username: { type: 'text' },
    email: { type: 'text' }
  }))
  
  // 使用模型
  onMessage(async (message) => {
    // 插入数据
    await UserModel.insert({
      username: 'john',
      email: 'john@example.com'
    }).execute()
    
    // 查询数据
    const users = await UserModel.select('username', 'email')
      .where({ username: 'john' })
      .execute()
  })
})
```

## 配置管理

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  // 插件目录
  plugin_dirs: [
    './plugins',
    'node_modules/@zhin.js'
  ],
  
  // 启用的插件
  plugins: [
    'http',
    'console',
    'adapter-process'
  ],
  
  // 机器人配置
  bots: [
    {
      name: 'my-bot',
      context: 'process'
    }
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

## 完整示例

### 基础机器人

```typescript
import { createApp, onMessage, addCommand, MessageCommand } from 'zhin.js'

const app = await createApp()

// 添加命令
addCommand(new MessageCommand('hello <name>')
  .action(async (message, { params }) => {
    return `Hello, ${params.name}!`
  }))

// 监听消息
onMessage(async (message) => {
  if (message.$content === 'ping') {
    await message.$reply('pong!')
  }
})
```

### 使用中间件

```typescript
import { addMiddleware } from 'zhin.js'

addMiddleware(async (message, next) => {
  console.log('收到消息:', message.$content)
  
  // 权限检查
  if (!hasPermission(message.$sender)) {
    await message.$reply('权限不足')
    return
  }
  
  await next()
})
```

### 定时任务

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

plugin.cron('0 0 * * *', async () => {
  console.log('每天零点执行清理任务')
  // 执行任务
})
```

### 组件系统

```typescript
import { defineComponent, addComponent } from 'zhin.js'

const Button = defineComponent(async ({ text, url }, context) => {
  return `[${text}](${url})`
}, 'Button')

addComponent(Button)

// 使用
await message.$reply('<Button text="点击" url="https://example.com"/>')
```

## API 参考

完整的 API 文档请访问：[https://docs.zhin.dev/api/core](https://docs.zhin.dev/api/core)

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [快速开始](https://docs.zhin.dev/guide/getting-started)
- [插件开发](https://docs.zhin.dev/plugin/getting-started)
- [API 参考](https://docs.zhin.dev/api/core)

## 许可证

MIT License

