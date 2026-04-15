# @zhin.js/adapter-discord

Zhin.js Discord 适配器，支持 Discord 机器人的消息收发和服务器管理。

## 功能特性

- 📦 **单一适配器**：`context: discord`，通过 `connection` 选择连接方式
- 🌐 **Gateway**（`connection: gateway`）：WebSocket 网关，支持群管、消息、斜杠命令等
- 📮 **Interactions**（`connection: interactions`）：HTTP 交互端点，斜杠命令等
- 可配置 Intents 和默认活动状态
- 服务器管理 AI 工具（仅 Gateway 支持）
- 基于 discord.js 库

## 安装

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

Interactions 模式需同时启用 `@zhin.js/http`。

## 配置

所有 Bot 使用 **同一 context：`discord`**，通过 **`connection`** 区分连接方式。

### Gateway（connection: gateway，默认）

```yaml
plugins:
  - "@zhin.js/adapter-discord"

bots:
  - context: discord
    connection: gateway
    name: my-discord-bot
    token: "${DISCORD_BOT_TOKEN}"
    # 可选: intents, enableSlashCommands, defaultActivity, slashCommands
```

### Interactions（connection: interactions）

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-discord"

bots:
  - context: discord
    connection: interactions
    name: my-discord-bot
    token: "${DISCORD_BOT_TOKEN}"
    applicationId: "${DISCORD_APP_ID}"
    publicKey: "${DISCORD_PUBLIC_KEY}"
    interactionsPath: "/discord/interactions"
```

未写 `connection` 时默认为 `gateway`。

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
