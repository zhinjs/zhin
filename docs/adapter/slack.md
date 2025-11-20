# Slack 适配器

Slack 适配器基于 `@slack/bolt` 框架实现，为 Zhin.js 提供 Slack 平台支持。

## 安装

```bash
pnpm add @zhin.js/adapter-slack
```

## 快速开始

### 1. 创建 Slack 应用

1. 访问 [Slack API](https://api.slack.com/apps)
2. 点击 "Create New App" → "From scratch"
3. 输入应用名称并选择工作区
4. 在 "OAuth & Permissions" 中添加以下 Bot Token Scopes：
   - `chat:write` - 发送消息
   - `chat:write.public` - 在公共频道发送消息
   - `channels:history` - 查看频道消息
   - `channels:read` - 查看频道信息
   - `groups:history` - 查看私有频道消息
   - `im:history` - 查看私信消息
   - `users:read` - 查看用户信息
   - `files:write` - 上传文件

### 2. 获取凭证

**基础凭证**：
- **Bot Token** (`xoxb-...`) - OAuth & Permissions 页面
- **Signing Secret** - Basic Information → App Credentials

**Socket Mode 凭证**（开发推荐）：
- 在 "Socket Mode" 启用 Socket Mode
- 生成 App-Level Token (`xapp-...`)，需要 `connections:write` scope

### 3. 订阅事件

在 "Event Subscriptions" 中订阅：
- `message.channels` - 公共频道消息
- `message.groups` - 私有频道消息
- `message.im` - 私信消息
- `app_mention` - @机器人

### 4. 安装应用

在 "Install App" 页面将应用安装到工作区。

## 配置选项

### Socket Mode（推荐开发使用）

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'slack-bot',
      context: 'slack',
      token: process.env.SLACK_BOT_TOKEN,          // Bot User OAuth Token
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN,       // App-Level Token
      socketMode: true
    }
  ],
  plugins: [
    '@zhin.js/adapter-slack',
    // 其他插件...
  ]
})
```

**环境变量**：
```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
```

### HTTP Mode（推荐生产使用）

```typescript
{
  name: 'slack-bot',
  context: 'slack',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: 3000  // 监听端口
}
```

**要求**：
- 需要公网可访问的 URL
- 在 Slack 应用的 "Event Subscriptions" 配置 Request URL
- 建议使用 HTTPS 和反向代理（如 Nginx）

## 功能特性

### 消息类型支持

- ✅ **文本消息** - 纯文本、Slack mrkdwn 格式
- ✅ **用户提及** - @用户 (`<@U12345>`)
- ✅ **频道提及** - #频道 (`<#C12345>`)
- ✅ **链接** - URL 和带标题的链接
- ✅ **附件** - 图片、文件
- ✅ **线程回复** - 在主题中回复

### Slack 格式解析

适配器自动解析 Slack 的特殊格式：

```typescript
// Slack 原始格式 -> 消息段
"<@U12345678>"         // → { type: 'at', data: { id: 'U12345678' } }
"<#C12345678|general>" // → { type: 'channel_mention', data: { id: 'C12345678', name: 'general' } }
"<https://example.com|Example>" // → { type: 'link', data: { url: '...', text: '...' } }
```

### 发送消息

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

// 简单文本
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello from Slack!'
  })
)

// 提及用户
addCommand(new MessageCommand('mention <userId:text>')
  .action(async (message, result) => {
    return [
      { type: 'at', data: { id: result.params.userId } },
      { type: 'text', data: { text: ' 你好！' } }
    ]
  })
)

// 发送链接
addCommand(new MessageCommand('link')
  .action(async (message) => {
    return [
      { 
        type: 'link', 
        data: { 
          url: 'https://slack.com', 
          text: 'Visit Slack' 
        } 
      }
    ]
  })
)
```

### 线程回复

```typescript
addCommand(new MessageCommand('thread')
  .action(async (message) => {
    // 第二个参数为 true 时，在线程中回复
    await message.$reply('这是线程回复', true)
  })
)
```

### 发送文件

```typescript
addCommand(new MessageCommand('file')
  .action(async (message) => {
    return {
      type: 'file',
      data: {
        file: '/path/to/file.pdf',
        name: 'document.pdf'
      }
    }
  })
)
```

## 消息段类型

### 发送消息段

| 类型 | 说明 | 数据字段 |
|------|------|---------|
| `text` | 文本消息 | `text` |
| `at` | @提及用户 | `id` |
| `channel_mention` | #频道提及 | `id` |
| `link` | 链接 | `url`, `text`（可选） |
| `image` | 图片 | `url`, `title`（可选） |
| `file` | 文件 | `file`（本地路径）, `name` |

### 接收消息段

适配器解析 Slack 消息为标准格式，保留原始 Slack 数据。

## Slack mrkdwn 格式

Slack 使用自己的 Markdown 变体：

| 格式 | 语法 | 示例 |
|------|------|------|
| 粗体 | `*text*` | `*bold*` |
| 斜体 | `_text_` | `_italic_` |
| 删除线 | `~text~` | `~strikethrough~` |
| 代码 | `` `text` `` | `` `code` `` |
| 引用 | `> text` | `> quote` |

**注意**：当前适配器接收时会解析这些格式，但发送时需要在文本中使用 Slack 的格式语法。

## 平台特性

### 聊天类型

- **私信** (`private`) - 与用户的一对一对话（IM）
- **频道** (`group`) - 公共频道、私有频道、群组 DM

### 消息ID格式

Slack 使用时间戳（`ts`）作为消息ID，格式如 `1234567890.123456`

### 用户和频道ID

- 用户ID: `U` 或 `W` 开头（如 `U12345678`）
- 频道ID: `C` 开头（如 `C12345678`）

## 限制说明

### 消息撤回

Slack 的消息删除需要频道信息，但当前 `$recallMessage` 接口只接收消息ID。
建议使用 `message.$recall()` 方法（包含完整上下文）。

### 文件上传

文件上传通过 Slack Web API 处理，需要本地文件路径。远程URL需要先下载。

## 错误处理

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()

try {
  await bot.$sendMessage(options)
} catch (error) {
  logger.error('Slack 消息发送失败:', error)
}
```

## 最佳实践

### 1. 环境变量管理

```bash
# .env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

不要将凭证硬编码在代码中！

### 2. 开发用 Socket Mode

Socket Mode 无需公网 URL，适合本地开发：

```typescript
{
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
}
```

### 3. 生产用 HTTP Mode

HTTP Mode 更稳定，适合生产环境：

```typescript
{
  socketMode: false,
  port: 3000
}
```

配合 Nginx：
```nginx
location /slack {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 4. 权限最小化

只添加应用需要的 OAuth scopes，避免过度授权。

### 5. 日志级别

```typescript
{
  logLevel: 'INFO' // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
}
```

## 调试技巧

### 查看原始消息

```typescript
import { onMessage } from 'zhin.js'

onMessage((message) => {
  console.log('Slack 原始消息:', message.$raw)
  console.log('消息段:', message.$content)
  console.log('发送者:', message.$sender)
  console.log('频道:', message.$channel)
})
```

### 测试事件

使用 Slack 的 "Event Subscriptions" 页面的 "Reinstall your app" 来触发测试事件。

### 查看 API 调用

在 Slack 应用的 "Event Subscriptions" 可以查看 Request logs。

## 高级功能

### 交互组件（待实现）

Slack 支持按钮、下拉菜单等交互组件，当前适配器专注于消息处理。
如需使用交互组件，可以扩展适配器或直接使用 `@slack/bolt` 的高级功能。

### Block Kit（待实现）

Slack 的 Block Kit 提供丰富的消息布局，当前适配器使用简化的消息格式。

## 参考资源

- [Slack API 文档](https://api.slack.com/)
- [Slack Bolt 框架](https://slack.dev/bolt-js/)
- [Block Kit 设计工具](https://app.slack.com/block-kit-builder)
- [mrkdwn 格式参考](https://api.slack.com/reference/surfaces/formatting)
- [Zhin.js 适配器开发](./development.md)

## 常见问题

### Q: Socket Mode vs HTTP Mode 如何选择？

A: 
- **开发环境**：使用 Socket Mode，无需配置公网 URL
- **生产环境**：使用 HTTP Mode，更稳定可靠

### Q: 如何处理斜杠命令（Slash Commands）？

A: 当前适配器专注于消息处理。斜杠命令需要额外配置，建议直接使用 Bolt 框架的功能。

### Q: 支持企业版 Slack（Enterprise Grid）吗？

A: 支持，但需要相应的企业版权限配置。

### Q: 消息格式化不生效？

A: 发送时需要使用 Slack 的 mrkdwn 语法（`*bold*`、`_italic_` 等）在文本内容中。

---

更新时间: 2025-01-19
