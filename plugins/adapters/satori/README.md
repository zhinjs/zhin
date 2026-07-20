# @zhin.js/adapter-satori

Zhin.js [Satori](https://satori.chat/zh-CN/introduction.html) **聊天协议**适配器（Plugin Runtime）。支持 **WebSocket 正向客户端**（`connection: ws`）与 **Webhook 入站**（`connection: webhook`，经 `httpHostToken` POST 路由）。

> **勿与本仓库的 `@zhin.js/satori` 混淆**：后者是 [Vercel satori](https://github.com/vercel/satori) 的 **SVG 图片渲染**工具包（`packages/toolkit/satori`），用于把 HTML/React 画成 SVG，**不是**聊天协议。参见 [@zhin.js/satori README](https://github.com/zhinjs/zhin/tree/main/packages/toolkit/satori)。

## 功能特性

- 🔌 [Satori 协议](https://satori.chat/zh-CN/introduction.html) 兼容
- 🌐 **WebSocket 正向**（`connection: ws`，默认）：应用连 SDK `ws(s)://baseUrl`，IDENTIFY + 心跳
- 🔐 Bearer Token 鉴权（API 与 WS IDENTIFY）
- 📨 频道 / 私聊消息收发，消息 id 格式为 `channelId:messageId`
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **Webhook**（`connection: webhook`）：SDK POST `Satori-Opcode: 0` 事件到 `path`

## 安装

```bash
pnpm add @zhin.js/adapter-satori
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/satori.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- `@zhin.js/host-http` — Webhook 模式需 `httpHostToken` 注册 POST 路由
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`（`baseUrl` / `token` / …）

入站：`gateway.receive({ adapter, target: channelId, content: text, sender, id, metadata })`  
出站：`send({ target: channelId, payload })` → Satori `message.create`（payload 已由 gateway/core 渲染；无 segment-mapper）

入站 `metadata.mentioned`：消息 content 中 `<at id="…"/>` 元素的 id 等于登录 selfId（READY/事件 `login.user.id`）时置 `true`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  satori:
    name: satori-bot
    connection: ws
    baseUrl: "http://127.0.0.1:5140"
    token: "${SATORI_TOKEN}"
    heartbeat_interval: 10000
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-satori`（`instanceKey: satori`）。

### 可选字段

| 字段 | 说明 |
|------|------|
| `heartbeat_interval` | WS PING 间隔（毫秒），默认 `10000` |
| `token` | Bearer；也可设环境变量 `SATORI_TOKEN` |

### Webhook

```yaml
plugins:
  satori:
    connection: webhook
    baseUrl: "http://127.0.0.1:5140"
    path: "/satori/webhook"
    token: "${SATORI_TOKEN}"
```

SDK 会向 `path` 发送 POST，请求头 `Satori-Opcode: 0` 表示事件；适配器从首个事件的 `login` 取得 platform / userId 用于后续 API 调用。

## 鉴权

- **API**：请求头 `Authorization: Bearer {token}`
- **WebSocket**：IDENTIFY 时 body 中传 `token`

## 消息 id 与撤回

- 消息 id 格式为 `channelId:messageId`，便于发消息 / 撤回时解析。
- 撤回时需 `channel_id` + `message_id`，适配器已按上述格式解析。

## AI 工具

技能说明见 `agent/skills/satori.md`。

## 协议文档

- [介绍](https://satori.chat/zh-CN/introduction.html)
- [总览](https://satori.chat/zh-CN/protocol/overview.html)
- [API](https://satori.chat/zh-CN/protocol/api.html)
