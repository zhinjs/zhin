# @zhin.js/adapter-process

Zhin 机器人框架的进程适配器，支持控制台交互和 Web 沙盒测试。

## 特性

- 💻 **控制台模式** - 通过命令行与机器人交互
- 🌐 **沙盒模式** - 通过 WebSocket 提供 Web 沙盒测试环境
- 🔌 **Web 集成** - 自动注册 Web 控制台客户端
- 📨 **标准消息** - 支持完整的消息收发接口
- 🎯 **开发友好** - 无需外部平台，快速开发和测试

## 安装

```bash
pnpm add @zhin.js/adapter-process
```

## 使用

### 配置 Process 适配器

在 `zhin.config.ts` 中配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'console-bot',
      context: 'process'  // 使用 process 适配器
    }
  ],
  plugins: [
    'adapter-process',
    'http',        // 需要 HTTP 插件支持 Web 功能
    'console'      // 可选：Web 控制台
  ]
})
```

### 基础使用

```typescript
import { createApp, onMessage } from 'zhin.js'

const app = await createApp()

// 监听所有消息
onMessage(async (message) => {
  console.log('收到消息:', message.$content)
  
  // 回复消息
  await message.$reply('你好！')
})

// 启动后在控制台输入消息进行交互
```

## 两种模式

### 1. Process 模式（控制台）

直接从命令行接收输入并发送消息。

**特点：**
- 从 `stdin` 读取输入
- 消息输出到日志系统
- 适合开发和调试
- 无需额外服务

**消息格式：**

```typescript
{
  $id: string                    // 时间戳
  $adapter: 'process'
  $bot: string                   // 机器人名称
  $sender: {
    id: string                   // 进程 PID
    name: string                 // 进程标题
  },
  $channel: {
    id: string                   // 进程 PID
    type: 'private'
  },
  $content: MessageElement[]     // 消息内容
  $timestamp: number             // 时间戳
  $raw: string                   // 原始消息文本
}
```

### 2. Sandbox 模式（沙盒）

通过 WebSocket 连接的测试沙盒，支持多个并发连接。

**特点：**
- 通过 WebSocket 通信
- 支持多客户端连接
- 支持富文本消息段
- 与 Web 控制台集成

**WebSocket 端点：**
```
ws://localhost:8086/sandbox
```

**消息格式：**

发送到服务器：
```json
{
  "type": "private" | "group" | "channel",
  "id": "channel_id",
  "content": [
    { "type": "text", "data": { "text": "消息内容" } }
  ],
  "timestamp": 1234567890
}
```

从服务器接收：
```json
{
  "type": "private" | "group" | "channel",
  "id": "channel_id",
  "context": "sandbox",
  "bot": "bot_name",
  "content": [
    { "type": "text", "data": { "text": "回复内容" } }
  ],
  "timestamp": 1234567890
}
```

## Bot 类

### ProcessBot

控制台机器人类，处理 stdin/stdout 交互。

```typescript
class ProcessBot implements Bot {
  $config: ProcessConfig
  $connected: boolean
  
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $formatMessage(data): Message
  $sendMessage(options: SendOptions): Promise<string>
  $recallMessage(id: string): Promise<void>  // 不支持撤回
  
  // Web 消息接收接口
  receiveWebMessage(
    channelType: 'private' | 'group' | 'channel',
    channelId: string,
    content: string,
    senderId?: string,
    senderName?: string
  ): void
}
```

### SandboxBot

沙盒机器人类，处理 WebSocket 通信。

```typescript
class SandboxBot implements Bot {
  $config: SandboxConfig
  $connected: boolean
  
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $formatMessage(data): Message
  $sendMessage(options: SendOptions): Promise<string>
  $recallMessage(id: string): Promise<void>  // 不支持撤回
}
```

## 配置接口

### ProcessConfig

```typescript
interface ProcessConfig extends BotConfig {
  context: 'process'
  name: string
}
```

### SandboxConfig

```typescript
interface SandboxConfig extends BotConfig {
  context: 'sandbox'
  name: string
  ws: WebSocket  // WebSocket 连接实例
}
```

## 完整示例

### 控制台机器人

```typescript
import { createApp, onMessage, addCommand, MessageCommand } from 'zhin.js'

const app = await createApp({
  bots: [
    {
      name: 'console',
      context: 'process'
    }
  ]
})

// 添加命令
addCommand(new MessageCommand('echo <text...>')
  .action(async (message, { params }) => {
    return params.text.join(' ')
  }))

// 监听消息
onMessage(async (message) => {
  if (message.$content === 'hello') {
    await message.$reply('world!')
  }
})

// 启动后在控制台输入 "hello" 或 "echo test message"
```

### Web 沙盒集成

Process 适配器自动与 Web 控制台集成，提供测试沙盒界面。

**前端连接：**

```typescript
// 连接沙盒 WebSocket
const ws = new WebSocket('ws://localhost:8086/sandbox')

ws.onopen = () => {
  // 发送消息
  ws.send(JSON.stringify({
    type: 'private',
    id: 'test_channel',
    content: [
      { type: 'text', data: { text: 'Hello from web!' } }
    ],
    timestamp: Date.now()
  }))
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  console.log('收到回复:', message)
}
```

## Web 控制台客户端

Process 适配器包含一个 React 客户端组件，自动注册到 Web 控制台：

```
adapters/process/client/
├── index.tsx           # 客户端入口
├── ProcessSandbox.tsx  # 沙盒测试界面
└── RichTextEditor.tsx  # 富文本编辑器
```

访问 `http://localhost:8086` 可以在 Web 界面中看到沙盒测试功能。

## API 参考

### Bot 方法

```typescript
// 连接机器人
await bot.$connect()

// 断开连接
await bot.$disconnect()

// 发送消息
const messageId = await bot.$sendMessage({
  type: 'private',
  id: 'channel_id',
  context: 'process',
  bot: 'bot_name',
  content: [
    { type: 'text', data: { text: 'Hello' } }
  ]
})

// Web 消息接收（仅 ProcessBot）
bot.receiveWebMessage(
  'private',
  'channel_id',
  'Message content',
  'user_id',
  'User Name'
)
```

## 开发建议

### 1. 用于快速测试

Process 适配器非常适合快速测试插件功能：

```typescript
// test-plugin.ts
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('测试:', message.$content)
  await message.$reply('测试成功')
})

// 运行: zhin dev
// 输入任意文本即可测试
```

### 2. 结合其他适配器

可以同时使用多个适配器：

```typescript
export default defineConfig({
  bots: [
    {
      name: 'console',
      context: 'process'     // 用于开发测试
    },
    {
      name: 'prod-bot',
      context: 'discord',    // 生产环境使用
      token: process.env.DISCORD_TOKEN
    }
  ]
})
```

### 3. Web 沙盒测试

使用 Web 沙盒测试复杂的消息交互：

```typescript
// 测试富文本消息
await message.$reply([
  { type: 'text', data: { text: '你好' } },
  { type: 'at', data: { id: 'user_id', name: 'User' } },
  { type: 'image', data: { url: 'https://example.com/image.jpg' } }
])
```

## 注意事项

### 限制

1. **不支持撤回消息** - `$recallMessage` 为空实现
2. **控制台模式仅支持文本** - 富文本会转为文本显示
3. **单线程输入** - 控制台模式下一次只能处理一条消息

### 最佳实践

1. **开发时使用 Process 模式**
   ```bash
   zhin dev  # 快速启动测试
   ```

2. **测试时使用 Sandbox 模式**
   - 打开 Web 控制台
   - 使用沙盒测试复杂交互

3. **生产环境切换适配器**
   ```typescript
   bots: [
     process.env.NODE_ENV === 'production'
       ? { name: 'prod', context: 'discord', token: '...' }
       : { name: 'dev', context: 'process' }
   ]
   ```

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [适配器开发](https://docs.zhin.dev/adapter/getting-started)
- [Web 控制台](https://docs.zhin.dev/official/console)

## 许可证

MIT License
