# @zhin.js/adapter-satori

Zhin.js [Satori](https://satori.chat/zh-CN/introduction.html) 协议适配器，**一个适配器**支持 WebSocket 正向与 Webhook 两种连接方式，由配置项 `connection` 区分；支持 HTTP API 与 Bearer Token 鉴权。

## 功能特性

- 🔌 [Satori 协议](https://satori.chat/zh-CN/introduction.html) 兼容
- 📦 **单一适配器**：`context: satori`，通过 `connection` 选择连接方式
- 🌐 **WebSocket 正向**（`connection: ws`）：应用连 SDK `ws(s)://baseUrl/v1/events`
- 📮 **Webhook**（`connection: webhook`）：应用提供 POST 端点收事件
- 🔐 Bearer Token 鉴权（API 与 WS IDENTIFY）
- 📨 频道 / 私聊消息收发，消息 id 格式为 `channelId:messageId`

## 安装

```bash
pnpm add @zhin.js/adapter-satori ws
```

Webhook 方式需启用 `@zhin.js/http`（适配器依赖 router 注册）：

```bash
pnpm add @zhin.js/http
```

## 配置

所有 Bot 使用 **同一 context：`satori`**，通过 **`connection`** 区分连接方式。

### WebSocket 正向

```yaml
plugins:
  - "@zhin.js/adapter-satori"

bots:
  - context: satori
    connection: ws
    name: satori-bot
    baseUrl: "http://127.0.0.1:5140"
    token: "${SATORI_TOKEN}"
    heartbeat_interval: 10000
```

### Webhook

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-satori"

bots:
  - context: satori
    connection: webhook
    name: satori-webhook-bot
    baseUrl: "http://satori-sdk 地址"
    path: "/satori/webhook"
    token: "${SATORI_TOKEN}"
```

SDK 会向 `path` 发送 POST，请求头 `Satori-Opcode: 0` 表示事件；适配器从首个事件的 `login` 取得 platform / userId 用于后续 API 调用。

## 鉴权

- **API**：请求头 `Authorization: Bearer {token}`
- **WebSocket**：IDENTIFY 时 body 中传 `token`

配置 `token` 并与 Satori SDK 端一致即可。

## 连接方式对比

| connection | 说明 |
|------------|------|
| `ws` | 应用主动连 SDK `/v1/events`，IDENTIFY + 心跳 |
| `webhook` | 应用提供 POST path，SDK 推送事件 |

## 消息 id 与撤回

- 消息 `$id` 格式为 `channelId:messageId`，便于发消息 / 撤回时解析。
- 撤回时需 `channel_id` + `message_id`，适配器已按上述格式解析。

## 协议文档

- [介绍](https://satori.chat/zh-CN/introduction.html)
- [总览](https://satori.chat/zh-CN/protocol/overview.html)
- [API](https://satori.chat/zh-CN/protocol/api.html)
