---
title: "@zhin.js/adapter-discord"
package: "@zhin.js/adapter-discord"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/discord/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/discord/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=19998697236531ee -->

# @zhin.js/adapter-discord

Zhin.js Discord 适配器（Plugin Runtime），默认通过 **Gateway WebSocket**（discord.js）收发消息（无需 host-router / host-http）。

## 功能

- Gateway WebSocket 入站（默认；无需公网 HTTPS / host）
- 解析 text / mention / attachment / embed / sticker / button
- 支持私聊、群组与服务器频道
- 出站 `send({ conversation, payload })` → Discord channel message（Markdown content / media / embed / keyboard）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Interactions HTTP webhook 延期（需 `httpHostToken`）；配置 `connection: interactions` 会明确报错

## 安装

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/discord/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http` / `@zhin.js/host-router`（Gateway 路径）

入站：`gateway.receive({ conversation, message, content: text, sender, metadata })`（`conversation` 为 `ConversationRef`，guild 频道带 `parent` guild 容器）  
出站：`send({ conversation, payload })` → discord.js channel.send

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

必填字段（`endpoints[i]`）：`id`、`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  discord:
    # connection: gateway   # 默认
    endpoints:
      - id: my-discord-bot
        token: ${DISCORD_BOT_TOKEN}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-discord`（`instanceKey: discord`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DISCORD_BOT_TOKEN` | YAML 示例中 `token` 引用的 Bot Token |

## Interactions（HTTP）

`connection: interactions` 经 `httpHostToken` 注册 POST 路由（默认 `/discord/interactions`），Ed25519 验签后处理 PING 与 slash command；出站走 Discord REST `channels/.../messages`。需配置 `applicationId` 与 `publicKey`。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `PERMITS.md` |
| 平台工具（7 个） | `agents/discord/skills/discord/tools/`（Skill 激活后披露 `discord_*`：角色、Embed、反应等） |
| 技能说明 | `agents/discord/skills/discord/SKILL.md` |

工具使用 Discord Snowflake ID 标识 `guild_id`、`user_id`、`channel_id`。

## Discord 开发者配置

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建应用并获取 Bot Token
3. 开启 **MESSAGE CONTENT INTENT**
4. 通过 OAuth2 URL 邀请 Bot 加入服务器

## 故障排查

| 现象 | 排查 |
| --- | --- |
| Gateway 反复断线 | 检查 Token、网络代理、Gateway Intents 与应用后台配置 |
| 能上线但收不到正文 | 启用 Message Content Intent，并给 Bot 频道读取权限 |
| 能收不能发 | 检查 Send Messages、Embed Links 与附件权限 |
| `connection: interactions` 启动失败 | 当前生产路径使用 Gateway；改回 `gateway` |

## 许可证

MIT License


受控 Gateway 故障验收可为单个测试 endpoint 设置 `gatewayFaultProxyUrl: ws://127.0.0.1:18090/`。
只接受此格式的 loopback origin；REST API 仍走 SDK 默认路径。入口通过正式 `ws.buildStrategy`
使用已验证的 `@discordjs/ws` 1.2.3，SDK 继续负责心跳、Identify 和 Resume，初连及平台返回的
区域 `resume_gateway_url` 均转到本地代理。Endpoint 的启动、停止和失败复位统一使用
`createEndpointLifecycle`，SDK 断线恢复状态由 `isReady()` 投影为 `reconnecting`。

代理启动、切断与恢复见仓库 `scripts/platform-acceptance/FAULT-PROXY.md`。
本地 SDK 测试不能替代真实 Discord 消息及断线恢复验收。

### 出站失败与重试边界

Gateway 客户端的 REST 设置 `retries: 0` 并以 `rejectOnRateLimit` 拒绝后台 429 排队，二者分别覆盖网络/5xx 重试与限流重发。真实 SDK HTTP fixture 验证连接丢失、500、429、403 各只有一个 POST。已有 Gateway 代理不控制 Discord REST，不能据此宣称出站 API 故障验收通过。API 专用入口需通过正式 REST agent/dispatcher 保留 discord.com HTTPS 身份和证书校验，仅把测试实例 TCP 路由固定到 loopback。验收项目已提供独立 `restApiProxy` / `DISCORD_REST_API_PROXY_PORT`。SDK合同见 [RESTOptions](https://discord.js.org/docs/packages/rest/main/RESTOptions:Interface)。

### REST 专用 TLS 故障验收

Gateway 实例可选 `restApiProxy: { port: 18570 }`，默认关闭。正式 RESTOptions.agent 使用 Undici Dispatcher，只允许真实 `https://discord.com:443`，保留原API URL、SNI和证书链/域名校验，TCP固定到 `127.0.0.1:18570`。错误目的地拒绝且不回退直连。与 `gatewayFaultProxyUrl` 分开；不要同时cut两条链路。SDK REST 的 Gateway discovery 等 API 也经过此代理，启动时必须先forwarding。正式 WebSocket连接不经过此REST Dispatcher；Gateway正常运行中API断开不能被记为入站WSS已重连。

```bash
node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host discord.com --upstream-port 443 --port 18570 --control-port 18571
DISCORD_REST_API_PROXY_PORT=18570 pnpm --filter platform-acceptance-bot dev:discord
```

forwarding 下以新sample确认真实消息基线；control `POST /cut` 后另发新sample，出站结果须失败/unknown且无自动POST重发；`POST /recover` 后先确认旧sample未补发，再新sample确认恢复。检查平台可见消息与报告回执，不重发未知sample。此模式仅Gateway REST、JSON消息能力；Interactions Endpoint 与其他CDN目的地不适用，配置Interactions会明确拒绝。本地真实SDK TLS fixture覆盖服务收到POST后切断、可信CA但SAN不匹配拒绝、默认直连与手动恢复，不能当成实机结果。停止/连接失败会销毁专用Dispatcher，并取消尚未完成TLS握手。

公开扩展点参考：[Discord RESTOptions.agent](https://discord.js.org/docs/packages/rest/main/RESTOptions:Interface)、[Undici 6.28 Agent](https://github.com/nodejs/undici/blob/v6.28.0/docs/docs/api/Agent.md)。
