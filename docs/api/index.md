# 📚 API 参考

Zhin Bot Framework 的完整 API 文档，基于实际项目代码和 test-bot 使用方式编写。

## 🎯 核心 API

### createApp - 创建应用

创建 Zhin 应用实例的主要入口点：

```typescript
import { createApp } from 'zhin.js'

// 🚀 使用默认配置（自动加载 zhin.config.ts）
const app = await createApp()
await app.start()  // 重要：需要调用 start() 启动应用

// ⚙️ 使用自定义配置
const app = await createApp({
  bots: [
    {
      name: 'my-bot',
      context: 'process'
    }
  ],
  plugin_dirs: ['./src/plugins', 'node_modules', 'node_modules/@zhin.js'],
  plugins: ['adapter-process', 'http', 'test-plugin'],
  debug: true
})
await app.start()
```

### App - 应用实例

应用实例基于 HMR 系统，提供完整的机器人管理功能：

```typescript
// 📋 应用生命周期管理
await app.start()     // 启动应用和所有机器人
await app.stop()      // 停止应用和所有机器人

// 💬 消息发送
await app.sendMessage({
  context: 'process',
  bot: `${process.pid}`,
  id: `${process.pid}`,
  type: 'private',
  content: '你好，世界！'
})

// 📊 获取配置
const config = app.getConfig()
console.log('当前配置:', config)
```

## 🧩 插件开发 API

### 核心钩子函数

```typescript
import {
  usePlugin,      // 获取当前插件实例
  useLogger,      // 获取日志记录器
  onDispose,      // 插件销毁时回调
  onMounted       // 插件挂载完成回调（需要从HMR导入）
} from 'zhin.js'

// 🔧 获取插件实例
const plugin = usePlugin()
console.log('插件名称:', plugin.name)
console.log('插件文件:', plugin.filename)

// 📝 获取日志记录器
const logger = useLogger()
logger.info('插件已启动')
logger.warn('警告信息')
logger.error('错误信息')
logger.debug('调试信息') // 仅在 debug: true 时显示

// 🎯 生命周期钩子
onDispose(() => {
  logger.info('插件即将销毁，清理资源')
})
```

### 消息处理 API

实际的消息接口与我之前文档不同：

```typescript
import { onMessage } from 'zhin.js'

// 💬 消息监听 - 实际消息接口
onMessage((message) => {
  // 实际的 Message 接口：
  console.log('消息ID:', message.id)
  console.log('适配器:', message.adapter)  
  console.log('机器人:', message.bot)
  console.log('原始消息:', message.$raw)
  console.log('消息段:', message.$content) // MessageSegment[]
  console.log('发送者:', message.$sender)  // { id, name? }
  console.log('频道:', message.$channel)   // { id, type: 'private' | 'group' | 'channel' }
  console.log('时间戳:', message.timestamp)
  
  // 回复消息 - 实际签名
  if (message.$raw === '你好') {
    message.$reply('你好呀！', false) // reply(content: SendContent, quote?: boolean|string)
  }
})
```

### 命令系统 API

基于实际的 MessageCommand 实现：

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

// 🎯 简单命令
addCommand(new MessageCommand('hello')
  .action(async (message, result) => {
    return '你好！欢迎使用 Zhin 框架！'
  })
)

// 🔢 带参数的命令
addCommand(new MessageCommand('echo <content:text>')
  .action(async (message, result) => {
    // result 是 MatchResult 类型
    return `回声: ${result.args.content}`
  })
)

// 📊 状态命令（来自 test-bot）
addCommand(new MessageCommand('status')
  .action(() => {
    const formatMemoSize = (size: number) => `${(size/1024/1024).toFixed(2)}MB`
    
    return [
      '-------状态-------',
      `运行时间：${Time.formatTime(process.uptime() * 1000)}`,
      `内存使用：${formatMemoSize(process.memoryUsage.rss())}`,
    ].join('\n')
  })
)

// 🎲 发送命令（来自 test-bot）
addCommand(new MessageCommand('send')
  .action((_, result) => result.remaining) // remaining 是剩余的文本
)
```

### 上下文系统 API

基于实际的 register 和 useContext 实现，现已支持上下文描述信息：

```typescript
import { register, useContext } from 'zhin.js'

// 🔧 注册上下文服务
register({
  name: 'database',
  description: '数据库服务，提供数据查询和存储功能', // 📝 新增：上下文描述
  async mounted(plugin) {
    // 创建数据库连接
    const db = await createConnection()
    
    plugin.logger.info('数据库已连接')
    
    return {
      query: async (sql: string, params?: any[]) => {
        return await db.query(sql, params)
      }
    }
  },
  
  async dispose(db) {
    // 清理资源
    await db.close()
  }
})

// 🎯 使用上下文依赖 - 实际签名
useContext('database', (db) => {
  // 数据库就绪后执行
  addCommand(new MessageCommand('users')
    .action(async () => {
      const users = await db.query('SELECT * FROM users')
      return `用户数量: ${users.length}`
    })
  )
})

// 🌐 Web上下文使用（来自 test-bot）
useContext('web', (web) => {
  web.addEntry(path.resolve(path.resolve(import.meta.dirname, '../../client/index.ts')))
})

// 🐧 ICQQ上下文使用（来自 test-bot）
useContext('icqq', (p) => {
  const likeCommand = new MessageCommand('赞[space][...atUsers:at]', { at: 'qq' })
    .action(async (m, { params }) => {
      if (!params.atUsers?.length) params.atUsers = [+m.sender.id]
      const likeResult: string[] = []
      
      for (const user_id of params.atUsers) {
        const userResult = await p.bots.get(m.bot)?.sendLike(user_id, 10)
        likeResult.push(`为用户(${user_id})赞${userResult ? '成功' : '失败'}`)
      }
      return likeResult.join('\n')
    })
  
  addCommand(likeCommand)
})
```

#### 上下文描述信息

从框架最新版本开始，支持为上下文添加描述信息，用于更好的系统管理和文档化：

```typescript
// 📝 带描述的上下文注册
register({
  name: 'redis-cache',
  description: 'Redis 缓存服务，提供高性能数据缓存功能',
  async mounted(plugin) {
    const redis = await createRedisConnection()
    return {
      set: (key: string, value: any, ttl?: number) => redis.set(key, value, ttl),
      get: (key: string) => redis.get(key)
    }
  }
})

// 🌐 HTTP API - 获取所有上下文及其描述
// GET /api/adapters
{
  "success": true,
  "data": [
    {
      "name": "redis-cache",
      "desc": "Redis 缓存服务，提供高性能数据缓存功能"
    },
    {
      "name": "icqq-adapter", 
      "desc": "ICQQ适配器，用于连接QQ平台"
    },
    {
      "name": "web-console",
      "desc": "Web控制台服务，提供管理界面"
    }
  ]
}
```

**描述字段的用途：**
- 📋 在Web管理界面中显示上下文的详细说明
- 🔍 帮助开发者理解各个上下文的作用和功能
- 📊 为系统监控和调试提供更多信息
- 📚 自动生成系统文档时的描述信息

### 函数式组件系统 API

基于新的函数式组件架构：

```typescript
import { defineComponent, segment } from 'zhin.js'

// 🧩 定义函数式组件
const TestComponent = defineComponent(async function TestComponent(props: { id: string }, context) {
  return `这是父组件 ${props.id}${context.children || ''}`;
}, 'test');

// 🎨 更复杂的组件示例
const FaceComponent = defineComponent(async function FaceComponent(props: { face?: number }, context) {
  const faceId = props.face || 1;
  return [
    segment.escape(`这是子组件<face id='${faceId}/>`),
    {
      type: 'face',
      data: { id: faceId }
    }
  ];
}, 'foo');

// 🎯 使用内置组件
const CardComponent = defineComponent(async function CardComponent(props: { 
  title: string; 
  children?: string 
}, context) {
  return `┌─ ${props.title} ─┐\n│ ${props.children || 'No content'}\n└─────────────┘`;
}, 'card');

// 📡 使用 Fetch 组件
const DataComponent = defineComponent(async function DataComponent(props: { 
  url: string 
}, context) {
  // 使用内置的 Fetch 组件
  return await context.render(`<Fetch url="${props.url}" />`, context);
}, 'data');
```

## 🏷️ 类型定义

### 消息相关类型（实际接口）

```typescript
// 实际的消息接口
interface Message {
  id: string                    // 消息 ID
  adapter: string               // 适配器名称
  bot: string                   // 机器人名称
  content: MessageSegment[]     // 消息段数组
  sender: MessageSender         // 发送者信息
  channel: MessageChannel       // 频道信息
  timestamp: number             // 时间戳
  raw: string                   // 原始消息内容
  reply(content: SendContent, quote?: boolean|string): Promise<void>  // 回复方法
}

// 消息段
interface MessageSegment {
  type: string    // 段类型：text, image, at, face 等
  data: Record<string, any>       // 段数据
}

// 发送者信息
interface MessageSender {
  id: string      // 用户 ID
  name?: string   // 用户名（可选）
}

// 频道信息
interface MessageChannel {
  id: string      // 频道 ID
  type: 'private' | 'group' | 'channel'  // 频道类型
}

// 发送内容类型
type SendContent = MaybeArray<string | MessageSegment>
type MaybeArray<T> = T | T[]
```

### 配置相关类型

```typescript
// 应用配置
interface AppConfig {
  bots?: BotConfig[]           // 机器人配置列表
  plugin_dirs?: string[]      // 插件目录列表
  plugins?: string[]          // 启用的插件列表
  disable_dependencies?: string[]  // 禁用的依赖列表
  debug?: boolean            // 调试模式
}

// 插件目录说明：
// - './src/plugins': 项目自定义插件目录
// - 'node_modules': 第三方 npm 插件目录
// - 'node_modules/@zhin.js': Zhin 官方插件目录（推荐）

// 机器人配置
interface BotConfig {
  name: string               // 机器人名称
  context: string           // 适配器上下文名
  [key: string]: any        // 其他适配器特定配置
}

// 发送选项
interface SendOptions extends MessageChannel {
  context: string           // 适配器上下文
  bot: string              // 机器人名称
  content: SendContent      // 消息内容
}
```

## 🎯 Segment 工具 API

基于实际的 segment 实现：

```typescript
import { segment } from 'zhin.js'

// 🎨 基础 segment 函数
segment('text', { text: '文本内容' })
segment('image', { url: 'https://example.com/image.jpg' })
segment('at', { id: '123456789' })

// 🛠️ 工具函数
segment.escape('<这不是标签>')  // 转义HTML标签

// 📝 在组件中使用（来自 test-bot）
segment.escape(`这是子组件<face id='${face}/>`)

// 💬 在消息中直接使用
const message = [
  segment('text', { text: '你好 ' }),
  segment('at', { id: '123456789' }),
  segment('text', { text: ' 今天天气不错' })
]
```

## 🔧 工具函数 API

基于实际的工具函数：

```typescript
import { Time, useLogger } from 'zhin.js'

// 📝 日志记录器
const logger = useLogger()
logger.debug('调试信息')    // 仅在 debug: true 时显示
logger.info('普通信息')
logger.warn('警告信息')  
logger.error('错误信息')

// ⏰ 时间工具
Time.formatTime(process.uptime() * 1000)    // "1天10小时17分36秒"
Time.formatTimeShort(3661000)               // "1h1m1s"  
Time.parseTime('1h30m')                     // 5400000 (毫秒)

// 时区相关
Time.setTimezoneOffset(480)                 // 设置时区偏移（分钟）
Time.getTimezoneOffset()                    // 获取当前时区偏移

// 💾 内存格式化（test-bot 示例 - 自定义函数）
function formatMemoSize(size: number) {
  return `${(size/1024/1024).toFixed(2)}MB`
}

const memoryUsage = formatMemoSize(process.memoryUsage.rss())
```

## 📦 插件注册 API

```typescript
import { registerAdapter, beforeSend } from 'zhin.js'

// 🔌 注册适配器
registerAdapter(new MyAdapter())

// 📤 发送前处理
beforeSend((options) => {
  // 为所有消息添加时间戳
  if (typeof options.content === 'string') {
    options.content = `[${new Date().toLocaleTimeString()}] ${options.content}`
  }
  return options
})
```

## 📚 实际使用示例

基于 test-bot 的真实代码：

```typescript
// test-bot/src/plugins/test-plugin.ts 的实际内容
import {
  useContext,
  addCommand,
  Time,
  addComponent,
  defineComponent,
  segment,
  onDispose,
  MessageCommand,
  sendMessage,
} from 'zhin.js'
import path from "node:path"

function formatMemoSize(size: number) {
  return `${(size/1024/1024).toFixed(2)}MB`
}

// 实际的命令定义
addCommand(new MessageCommand('send')
  .action((_, result) => result.remaining))

addCommand(new MessageCommand('status')
  .action(() => {
    return [
      '-------状态-------',
      `运行时间：${Time.formatTime(process.uptime()*1000)}`,
      `内存使用：${formatMemoSize(process.memoryUsage.rss())}`,
    ].join('\n')
  }))

// 实际的组件定义
const testComponent = defineComponent({
  name: 'test',
  props: {
    id: String
  },
  async render({ id }, context) {
    return '这是父组件' + id + context.children || ''
  }
})

// 实际的上下文使用
useContext('web', (web) => {
  web.addEntry(path.resolve(path.resolve(import.meta.dirname, '../../client/index.ts')))
})
```


---

## 🌍 生态系统与扩展

### 📦 开箱即用
- 控制台适配器（@zhin.js/adapter-process，默认内置）
- HTTP 服务（@zhin.js/http）
- Web 控制台（@zhin.js/console）
- SQLite 数据库（默认）

### 🔌 可选扩展（需手动安装）
- Telegram（@zhin.js/adapter-telegram）
- Discord（@zhin.js/adapter-discord）
- QQ（@zhin.js/adapter-qq）
- KOOK（@zhin.js/adapter-kook）
- OneBot v11（@zhin.js/adapter-onebot11）
- MySQL（@zhin.js/database-mysql）
- PostgreSQL（@zhin.js/database-pg）

## 📚 更多资源

- 🎯 [test-bot 实例](https://github.com/zhinjs/zhin/tree/main/test-bot) - 完整的实际使用示例
- 🧩 [插件开发指南](../plugin/index) - 深入学习插件开发
- 🔌 [适配器开发指南](../adapter/index) - 创建自定义适配器  
- 💡 [示例代码集合](../examples/index) - 实用示例和最佳实践
- 🚀 [最佳实践指南](../guide/best-practices) - 生产环境优化建议

---

💡 **提示**: 所有 API 都支持完整的 TypeScript 类型提示，建议参考 test-bot 项目中的实际使用方式来学习。