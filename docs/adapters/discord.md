---
title: "@zhin.js/adapter-discord"
package: "@zhin.js/adapter-discord"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/discord/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/discord/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=a7206ed57b8affb1 -->

# @zhin.js/adapter-discord

Zhin.js Discord 适配器（Plugin Runtime），默认通过 **Gateway WebSocket**（discord.js）收发消息（无需 host-router / host-http）。

## 功能

- Gateway WebSocket 入站（默认；无需公网 HTTPS / host）
- 解析 text / mention / attachment / embed / sticker / button
- 支持私聊、群组与服务器频道
- 出站 `send({ target, payload })` → Discord channel message（text / media / embed / keyboard）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Interactions HTTP webhook 延期（需 `httpHostToken`）；配置 `connection: interactions` 会明确报错

## 安装

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/discord.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http` / `@zhin.js/host-router`（Gateway 路径）

入站：`gateway.receive({ adapter, target: channelId, content: text, sender, metadata })`  
出站：`send({ target, payload })` → discord.js channel.send

### 平台权限（platform permit）

- sender role 已恢复：Gateway 入站 `metadata.role` / `metadata.permissions`（来自 member 权限位与 guild owner 判定，见 `src/gateway.ts` `resolveSenderRole`）。
- `plugin.ts` 在 generation setup 注册 checker，并在 dispose 注销；Plugin Runtime CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费 `permissions`。

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | [Discord Developer Portal](https://discord.com/developers/applications) 创建应用并获取 Token |
| **MESSAGE CONTENT INTENT** | 需开启才能读取消息正文 |
| **Gateway（默认）** | 本地/生产均可；discord.js 连接 Gateway，无需公网 HTTPS |
| **host-http** | Gateway **不需要**；Interactions webhook 延期至下一棒 |

必填字段：`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  discord:
    name: my-discord-bot
    token: ${DISCORD_BOT_TOKEN}
    # connection: gateway   # 默认
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-discord`（`instanceKey: discord`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DISCORD_BOT_TOKEN` | Bot Token |
| `DISCORD_BOT_NAME` | 可选，默认 endpoint 名 |

## Interactions（HTTP）

`connection: interactions` 经 `httpHostToken` 注册 POST 路由（默认 `/discord/interactions`），Ed25519 验签后处理 PING 与 slash command；出站走 Discord REST `channels/.../messages`。需配置 `applicationId` 与 `publicKey`。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具（7 个） | `agent/tools/`（`discord_*`：角色、Embed、反应等） |
| 技能说明 | `agent/skills/discord.md` |

工具使用 Discord Snowflake ID 标识 `guild_id`、`user_id`、`channel_id`。

## Discord 开发者配置

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建应用并获取 Bot Token
3. 开启 **MESSAGE CONTENT INTENT**
4. 通过 OAuth2 URL 邀请 Bot 加入服务器

## 许可证

MIT License
