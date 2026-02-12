# @zhin.js/adapter-discord

Zhin.js Discord 适配器，支持 Discord 机器人的消息收发和服务器管理。

## 功能特性

- 支持 Gateway（WebSocket）和 Interactions（HTTP Webhook）两种模式
- 斜杠命令（Slash Commands）支持
- 可配置 Intents 和默认活动状态
- 服务器管理 AI 工具（通过 declareSkill 暴露给 AI）
- 基于 discord.js 库

## 安装

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

## 依赖

- `@zhin.js/http` — HTTP 服务（Interactions 模式需要）

## 配置

### Gateway 模式（推荐）

```yaml
# zhin.config.yml
bots:
  - context: discord
    name: my-discord-bot
    token: ${DISCORD_BOT_TOKEN}
    # 可选配置
    # intents:
    #   - Guilds
    #   - GuildMessages
    #   - MessageContent
    # enableSlashCommands: true
    # defaultActivity:
    #   name: Zhin.js
    #   type: Playing

plugins:
  - adapter-discord
  - http
```

### Interactions 模式（Webhook）

```yaml
bots:
  - context: discord-interactions
    name: my-discord-bot
    token: ${DISCORD_BOT_TOKEN}
    applicationId: ${DISCORD_APP_ID}
    publicKey: ${DISCORD_PUBLIC_KEY}
    interactionsPath: /discord/interactions
```

### TypeScript 配置

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'discord',
      name: 'my-discord-bot',
      token: process.env.DISCORD_BOT_TOKEN!,
    }
  ],
  plugins: ['adapter-discord', 'http']
})
```

## 使用示例

### 注册命令

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('ping')
    .desc('测试延迟')
    .action(() => 'Pong!')
)
```

### 消息中间件

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  if (message.$adapter === 'discord') {
    console.log('Discord 消息:', message.$content)
  }
  await next()
})
```

## AI 工具（Skill）

适配器内置 Discord 服务器管理 Skill，工具供 AI 调用。

> 工具使用 Discord 的 Snowflake ID 格式标识 `guild_id`、`user_id`、`channel_id`。

## Discord 开发者配置

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建应用并获取 Bot Token
3. 开启 **MESSAGE CONTENT INTENT**（需要读取消息内容）
4. 通过 OAuth2 URL 邀请 Bot 加入服务器
5. Interactions 模式还需配置 Interactions Endpoint URL

## 许可证

MIT License
