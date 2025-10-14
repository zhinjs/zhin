# @zhin.js/adapter-qq

Zhin 机器人框架的 QQ 官方适配器，用于连接 QQ 官方机器人 API。

## 特性

- 🤖 **官方 API** - 基于 qq-official-bot 实现
- 📨 **完整消息支持** - 频道消息、群组消息、私聊消息
- 🎯 **多种接收模式** - Webhook 和 WebSocket 模式
- 🌐 **多平台支持** - 支持频道、群组等多种应用场景
- 🔐 **安全认证** - AppID + Token + Secret 认证机制
- 📊 **完整类型支持** - TypeScript 类型定义

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## 前置准备

### 1. 申请 QQ 机器人

1. 访问 [QQ 开放平台](https://q.qq.com/)
2. 注册并创建机器人应用
3. 获取以下信息：
   - **AppID** - 应用 ID
   - **Token** - 机器人令牌
   - **Secret** - 应用密钥

### 2. 配置权限

在 QQ 开放平台配置机器人权限：
- 消息权限
- 频道权限
- 群组权限（如需要）

## 配置

### 基础配置

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'my-bot',              // 机器人名称
      context: 'qq',
      
      // 必需配置
      appid: '102073979',          // AppID
      secret: 'your_app_secret',   // 应用密钥
      
      // 接收模式
      mode: 'websocket',           // 'websocket' | 'webhook'
      
      // WebSocket intents（websocket 模式必需）
      intents: [
        "GUILDS",
        "GROUP_AT_MESSAGE_CREATE",
        "PUBLIC_GUILD_MESSAGES",
        "GUILD_MEMBERS",
        "DIRECT_MESSAGE",
        "C2C_MESSAGE_CREATE",
        "GUILD_MESSAGE_REACTIONS"
      ],
      
      // 可选配置
      logLevel: 'off',             // 日志级别
      removeAt: true,              // 移除@消息
      sandbox: true,               // 使用沙箱环境
      data_dir: './data',          // 数据目录
    }
  ],
  plugins: [
    'adapter-qq'
  ]
})
```

## 配置说明

### QQBotConfig

```typescript
interface QQBotConfig<T extends ReceiverMode, M extends ApplicationPlatform> extends BotConfig {
  context: 'qq'
  name: `${number}`              // AppID（字符串格式）
  
  // 认证信息
  appid: string
  token: string
  secret: string
  
  // 接收模式
  receiverMode: ReceiverMode
  
  // Webhook 配置
  webhook?: {
    path: string
    port?: number
    host?: string
  }
  
  // WebSocket 配置
  websocket?: {
    url: string
    intents: Intent[]
  }
  
  // 平台类型
  platform?: ApplicationPlatform
  
  // 数据目录
  data_dir?: string
}
```

### 接收模式

```typescript
enum ReceiverMode {
  Webhook = 'webhook',
  WebSocket = 'websocket'
}
```

### 平台类型

```typescript
type ApplicationPlatform = 
  | 'public'      // 公域（频道）
  | 'guild'       // 频道
  | 'group'       // 群组
```

## 消息格式

### 接收的消息

```typescript
{
  $id: string                    // 消息 ID
  $adapter: 'qq'
  $bot: string                   // AppID
  $sender: {
    id: string                   // 用户 ID
    name: string                 // 用户名称
  },
  $channel: {
    id: string                   // 频道/群组 ID
    type: 'private' | 'group' | 'channel'
  },
  $content: MessageElement[]     // 消息段数组
  $timestamp: number
  $raw: string                   // 原始消息文本
}
```

### 消息段类型

```typescript
// 文本
{ type: 'text', data: { text: string } }

// @用户
{ type: 'at', data: { qq: string } }

// 图片
{ type: 'image', data: { file: string, url?: string } }

// 表情
{ type: 'face', data: { id: string } }

// 回复
{ type: 'reply', data: { id: string } }

// Markdown
{ type: 'markdown', data: { content: string } }

// 按钮
{ type: 'button', data: { /* ... */ } }
```

## API 使用

### 监听消息

```typescript
import { onMessage } from 'zhin.js'

// 监听所有消息
onMessage(async (message) => {
  if (message.$adapter === 'qq') {
    console.log('QQ 消息:', message.$content)
    await message.$reply('收到！')
  }
})

// 监听频道消息
onEvent('message.channel.receive', async (message) => {
  console.log('频道消息:', message.$raw)
})

// 监听群组消息
onEvent('message.group.receive', async (message) => {
  console.log('群组消息:', message.$raw)
})

// 监听私聊消息
onPrivateMessage(async (message) => {
  if (message.$adapter === 'qq') {
    console.log('私聊消息:', message.$raw)
  }
})
```

### 发送消息

```typescript
import { segment } from 'zhin.js'

// 发送文本消息
await message.$reply('Hello, QQ!')

// 发送图片
await message.$reply([
  segment.text('这是一张图片：'),
  { type: 'image', data: { file: 'https://example.com/image.jpg' } }
])

// At 某人
await message.$reply([
  { type: 'at', data: { qq: message.$sender.id } },
  segment.text(' 你好！')
])

// 引用回复
await message.$reply('这是回复', true)

// 发送 Markdown
await message.$reply([
  {
    type: 'markdown',
    data: {
      content: '# 标题\n这是 **Markdown** 消息'
    }
  }
])
```

### 撤回消息

```typescript
const messageId = await message.$reply('这条消息会被撤回')

// 撤回消息
await bot.$recallMessage(messageId)
```

## Webhook 模式

### 配置

```typescript
{
  name: '123456789',
  context: 'qq',
  appid: '123456789',
  token: 'your_token',
  secret: 'your_secret',
  receiverMode: ReceiverMode.Webhook,
  webhook: {
    path: '/qq/webhook',
    port: 8080
  }
}
```

### 设置 Webhook URL

在 QQ 开放平台设置 Webhook URL：

```
https://your-domain.com/qq/webhook
```

## WebSocket 模式

### 配置

```typescript
import { Intent } from '@zhin.js/adapter-qq'

{
  name: '123456789',
  context: 'qq',
  appid: '123456789',
  token: 'your_token',
  secret: 'your_secret',
  receiverMode: ReceiverMode.WebSocket,
  websocket: {
    url: 'wss://api.sgroup.qq.com/websocket',
    intents: [
      Intent.GUILDS,
      Intent.GUILD_MESSAGES,
      Intent.DIRECT_MESSAGES,
      Intent.GROUP_MESSAGES
    ]
  }
}
```

### Intents

```typescript
enum Intent {
  GUILDS = 1 << 0,
  GUILD_MESSAGES = 1 << 9,
  DIRECT_MESSAGES = 1 << 12,
  GROUP_MESSAGES = 1 << 25,
  // ...更多
}
```

## 完整示例

### 频道机器人

```typescript
import { createApp, onMessage, MessageCommand, addCommand } from 'zhin.js'
import { ReceiverMode } from '@zhin.js/adapter-qq'

const app = await createApp({
  bots: [
    {
      name: '123456789',
      context: 'qq',
      appid: process.env.QQ_APPID!,
      token: process.env.QQ_TOKEN!,
      secret: process.env.QQ_SECRET!,
      receiverMode: ReceiverMode.Webhook,
      webhook: {
        path: '/qq/webhook'
      },
      platform: 'guild'
    }
  ]
})

// 添加命令
addCommand(new MessageCommand('hello')
  .scope('qq')
  .action(async (message) => {
    return 'Hello from QQ Official Bot!'
  }))

// 监听消息
onMessage(async (message) => {
  if (message.$adapter === 'qq') {
    console.log('收到 QQ 消息')
  }
})
```

## 注意事项

### 1. 权限配置

确保在 QQ 开放平台配置了正确的权限：
- 消息接收权限
- 消息发送权限
- 特定频道或群组的访问权限

### 2. 消息限制

- 文本消息有长度限制
- 图片、文件等有大小限制
- 发送频率有限制

### 3. Webhook vs WebSocket

**Webhook 模式：**
- ✅ 简单易用
- ✅ 无需维护长连接
- ❌ 需要公网地址
- ❌ 需要配置 HTTPS

**WebSocket 模式：**
- ✅ 实时性好
- ✅ 无需公网地址
- ❌ 需要维护长连接
- ❌ 配置相对复杂

### 4. 环境变量

建议使用环境变量存储敏感信息：

```env
QQ_APPID=123456789
QQ_TOKEN=your_bot_token
QQ_SECRET=your_app_secret
```

## 故障排除

### Webhook 收不到消息

1. 检查 Webhook URL 是否正确配置
2. 确认服务器可以从公网访问
3. 检查防火墙设置
4. 查看 QQ 开放平台的推送日志

### WebSocket 连接失败

1. 检查 WebSocket URL 是否正确
2. 确认 Intents 配置正确
3. 检查网络连接
4. 查看日志错误信息

### 发送消息失败

1. 检查是否有发送权限
2. 确认消息格式正确
3. 检查是否被限流
4. 查看 API 返回的错误信息

## 相关资源

- [QQ 开放平台](https://q.qq.com/)
- [QQ 机器人文档](https://bot.q.qq.com/wiki/)
- [qq-official-bot 库](https://github.com/lc-cn/qq-official-bot)
- [Zhin 完整文档](https://docs.zhin.dev)

## 许可证

MIT License

