# Telegram 适配器

Telegram 适配器基于 `telegraf` 库实现，为 Zhin.js 提供 Telegram 平台支持。

## 安装

```bash
pnpm add @zhin.js/adapter-telegram
```

## 快速开始

### 1. 获取 Bot Token

1. 在 Telegram 中找到 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot` 命令并按照指引创建机器人
3. 获取并保存 Bot Token（格式: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`）

### 2. 配置机器人

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'telegram-bot',
      context: 'telegram',
      token: process.env.TELEGRAM_BOT_TOKEN, // Bot Token
      polling: true, // 使用长轮询模式（默认）
    }
  ],
  plugins: [
    '@zhin.js/adapter-telegram',
    // 其他插件...
  ]
})
```

### 3. 启动机器人

```bash
# 设置环境变量
export TELEGRAM_BOT_TOKEN='your_bot_token_here'

# 启动
pnpm dev
```

## 配置选项

### 长轮询模式（推荐开发使用）

```typescript
{
  name: 'telegram-bot',
  context: 'telegram',
  token: 'YOUR_BOT_TOKEN',
  polling: true, // 启用长轮询
  allowedUpdates: ['message', 'callback_query'] // 可选：指定接收的更新类型
}
```

### Webhook 模式（推荐生产使用）

```typescript
{
  name: 'telegram-bot',
  context: 'telegram',
  token: 'YOUR_BOT_TOKEN',
  polling: false,
  webhook: {
    domain: 'https://yourdomain.com', // 你的公网域名
    path: '/telegram-webhook',         // Webhook 路径
    port: 8443                         // 可选：端口号
  }
}
```

## 功能特性

### 消息类型支持

- ✅ **文本消息** - 纯文本、格式化文本（粗体、斜体、代码等）
- ✅ **媒体消息** - 图片、视频、音频、语音、文档
- ✅ **特殊消息** - 贴纸、位置信息
- ✅ **交互消息** - 回调查询（Callback Query）

### 消息实体解析

适配器自动解析 Telegram 消息实体：

- `mention` - 用户提及 (@username)
- `text_mention` - 文本提及
- `url` / `text_link` - 链接
- `bold` / `italic` / `code` / `pre` - 文本格式
- `hashtag` - 话题标签

### 回复和引用

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

// 简单回复
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello, World!'
  })
)

// 引用回复
addCommand(new MessageCommand('echo <text:text>')
  .action(async (message, result) => {
    await message.$reply(result.params.text, true) // true 表示引用原消息
  })
)
```

### 发送富媒体

```typescript
addCommand(new MessageCommand('photo')
  .action(async (message) => {
    return [
      { 
        type: 'image', 
        data: { 
          url: 'https://example.com/photo.jpg' 
        } 
      },
      { 
        type: 'text', 
        data: { 
          text: '这是一张图片' 
        } 
      }
    ]
  })
)
```

### Callback Query 处理

适配器自动处理内联按钮的回调查询：

```typescript
import { onMessage } from 'zhin.js'

onMessage((message) => {
  // Callback query 会作为特殊消息接收
  if (message.$raw.startsWith('/button_')) {
    const action = message.$raw.replace('/button_', '')
    return `你点击了按钮: ${action}`
  }
})
```

## 消息段类型

### 发送消息段

| 类型 | 说明 | 数据字段 |
|------|------|---------|
| `text` | 文本消息 | `text` |
| `at` | @提及用户 | `id`, `name` |
| `image` | 图片 | `file_id` / `url` / `file` |
| `video` | 视频 | `file_id` / `url` / `file` |
| `audio` | 音频 | `file_id` / `url` / `file` |
| `voice` | 语音 | `file_id` / `url` / `file` |
| `file` | 文档 | `file_id` / `url` / `file` |
| `sticker` | 贴纸 | `file_id` |
| `location` | 位置 | `latitude`, `longitude` |

### 接收消息段

适配器会将 Telegram 消息转换为标准消息段格式，包含原始 Telegram 数据。

## 平台特性

### 聊天类型

- **私聊** (`private`) - 与用户的一对一对话
- **群组** (`group`) - 群组、超级群组

### 文件处理

支持三种方式发送文件：

```typescript
// 1. 通过 file_id（从接收的消息中获取）
{ type: 'image', data: { file_id: 'AgACAgIAAxkBAAI...' } }

// 2. 通过 URL
{ type: 'image', data: { url: 'https://example.com/image.jpg' } }

// 3. 通过本地文件路径
{ type: 'image', data: { file: '/path/to/image.jpg' } }
```

## 限制说明

### 消息撤回

Telegram 的消息撤回需要知道 `chat_id`，但适配器的 `$recallMessage` 接口只接收 `message_id`。
当前实现会记录警告但不执行实际撤回操作。

如需撤回功能，建议：
1. 在消息格式化时保存 chat_id 映射
2. 或使用 `message.$recall()` 方法（已包含完整上下文）

## 错误处理

适配器会自动处理常见错误：

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()

// 发送失败会记录错误日志
try {
  await bot.$sendMessage(options)
} catch (error) {
  logger.error('Telegram 消息发送失败:', error)
}
```

## 最佳实践

### 1. 使用环境变量管理 Token

```bash
# .env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

```typescript
// zhin.config.ts
export default defineConfig({
  bots: [{
    context: 'telegram',
    token: process.env.TELEGRAM_BOT_TOKEN,
    // ...
  }]
})
```

### 2. 生产环境使用 Webhook

Webhook 模式比长轮询更稳定、高效：

```typescript
{
  polling: false,
  webhook: {
    domain: 'https://bot.example.com',
    path: '/telegram/webhook',
  }
}
```

**要求**：
- 必须使用 HTTPS
- 域名必须公网可访问
- 建议配置 Nginx 反向代理

### 3. 合理使用 allowedUpdates

只接收需要的更新类型可以减少流量：

```typescript
{
  allowedUpdates: [
    'message',          // 普通消息
    'callback_query',   // 回调查询
    // 'edited_message', // 编辑的消息
    // 'channel_post',   // 频道消息
  ]
}
```

## 调试技巧

### 查看原始消息

```typescript
import { onMessage } from 'zhin.js'

onMessage((message) => {
  console.log('Telegram 原始消息:', message.$raw)
  console.log('消息段:', message.$content)
})
```

### 日志级别

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()
logger.debug('详细调试信息')
logger.info('一般信息')
logger.warn('警告信息')
logger.error('错误信息')
```

## 参考资源

- [Telegram Bot API 文档](https://core.telegram.org/bots/api)
- [Telegraf 库文档](https://telegraf.js.org/)
- [BotFather 使用指南](https://core.telegram.org/bots#6-botfather)
- [Zhin.js 适配器开发](./development.md)

## 常见问题

### Q: 如何处理内联键盘？

A: Telegram 内联键盘的回调会作为 callback_query 消息接收，适配器会自动转换为标准消息格式。

### Q: 支持 Telegram 的 Bot API Server 吗？

A: 可以通过自定义 Telegraf 配置支持，但当前适配器未直接暴露此选项。

### Q: 如何发送 Markdown 格式的消息？

A: Telegram 支持多种格式，可以在发送消息时指定解析模式，但当前适配器主要使用消息段格式。建议直接使用 Telegram 的格式化语法。

---

更新时间: 2025-01-19
