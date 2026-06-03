---
title: "@zhin.js/adapter-telegram"
package: "@zhin.js/adapter-telegram"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/telegram/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/telegram/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=36bed46fc7eae32c -->

# @zhin.js/adapter-telegram

Telegram adapter for zhin.js framework.

## Installation

```bash
pnpm add @zhin.js/adapter-telegram
```

## Prerequisites

| 要求 | 说明 |
|------|------|
| **Bot Token** | 通过 [@BotFather](https://t.me/botfather) 创建 Bot 并获取 Token |
| **Polling（默认）** | 本地开发无需公网 IP；`polling: true`（默认） |
| **Webhook（可选）** | 生产环境：`polling: false` + 公网 **HTTPS** 域名与有效 TLS；Telegraf 在 `webhook.port` 监听 |
| **host-router** | 不需要；本适配器自行处理 polling / webhook |

必填字段见 `TelegramBotConfig`：`context`、`name`、`token`；`polling` 默认为 `true`。

## Minimal configuration

```yaml
plugins:
  - "@zhin.js/adapter-telegram"

bots:
  - context: telegram
    name: my-telegram-bot
    token: "${TELEGRAM_TOKEN}"
    polling: true
```

## Configuration

### 长轮询 Polling（默认，本地开发）

无需公网 IP 或 HTTPS，Bot 主动向 Telegram 拉取更新：

```yaml
plugins:
  - "@zhin.js/adapter-telegram"

bots:
  - context: telegram
    name: my-telegram-bot
    token: "${TELEGRAM_TOKEN}"
    polling: true
```

### Webhook（生产环境）

设置 `polling: false` 并配置 `webhook` 对象；Telegraf 在 `webhook.port` 上启动 HTTPS 服务：

```yaml
bots:
  - context: telegram
    name: my-telegram-bot
    token: "${TELEGRAM_TOKEN}"
    polling: false
    webhook:
      domain: https://bot.example.com
      path: /telegram-webhook
      port: 8443
```

#### Webhook 前置条件

| 要求 | 说明 |
|------|------|
| **HTTPS 公网域名** | `webhook.domain` 须为 Telegram 可访问的 `https://` 地址（有效 TLS 证书） |
| **端口可达** | `webhook.port`（如 8443）须从公网可连，或通过反向代理转发 |
| **Bot Token** | 通过 [@BotFather](https://t.me/botfather) 获取 |
| **无需 host-router** | 本适配器由 Telegraf 自行监听 webhook，不依赖 `@zhin.js/host-router` |

> 本地开发建议先用 **polling**；上线后再切 webhook 并在 BotFather 或 launch 时注册 webhook URL。

TypeScript 等价配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'my-telegram-bot',
      context: 'telegram',
      token: 'YOUR_BOT_TOKEN',
      polling: true,
      // polling: false,
      // webhook: { domain: 'https://yourdomain.com', path: '/telegram-webhook', port: 8443 },
    }
  ]
})
```

## Features

- ✅ Send and receive text messages
- ✅ Support for rich media (images, videos, audio, documents)
- ✅ Message formatting (bold, italic, code, links)
- ✅ Reply to messages
- ✅ Mentions (@username)
- ✅ Stickers and locations
- ✅ Callback queries (inline buttons)
- ✅ Long polling and webhook modes
- ✅ Private and group chats

## Getting Your Bot Token

1. Talk to [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token provided
4. Add the token to your configuration

## Usage Examples

### Basic Message Handling

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello from Telegram!'
  })
)
```

### Send Rich Media

```typescript
addCommand(new MessageCommand('photo')
  .action(async (message) => {
    return [
      { type: 'image', data: { url: 'https://example.com/photo.jpg' } },
      { type: 'text', data: { text: 'Check out this photo!' } }
    ]
  })
)
```

### Reply to Messages

```typescript
addCommand(new MessageCommand('quote <text:text>')
  .action(async (message, result) => {
    await message.$reply(`You said: ${result.params.text}`, true) // true = quote original message
  })
)
```

## Telegram-Specific Features

### Callback Queries

The adapter automatically handles callback queries (from inline keyboards) as special messages.

### File Handling

You can send files using:
- `file_id` (from received messages)
- URL
- Local file path

## Troubleshooting

| 现象 | 排查 |
|------|------|
| Bot 无响应 / 收不到消息 | 确认 Token 正确；进程已启动；私聊 Bot 或将其加入群组 |
| Polling 报错 | 检查网络能否访问 `api.telegram.org`；同一 Token 勿多进程同时 polling |
| Webhook 不工作 | `webhook.domain` 须为 Telegram 可访问的 `https://`；放行 `webhook.port`；BotFather 或 launch 时注册 URL |
| 发送失败 | Token  revoked 或 Bot 被限制；查看日志中的 Telegraf 错误 |

## Documentation

- [Telegram adapter on zhin.js.org](https://zhin.js.org/adapters/telegram)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT
