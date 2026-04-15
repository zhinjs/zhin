# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) 协议适配器，**一个适配器**支持正向 WebSocket、HTTP Webhook、反向 WebSocket 三种连接方式，由配置项 `connection` 区分。

## 功能特性

- 🔌 [OneBot 12 标准](https://12.onebot.dev/) 兼容（OneBot Connect + 接口定义）
- 📦 **单一适配器**：`context: onebot12`，通过 `connection` 选择连接方式
- 🌐 **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- 📮 **HTTP Webhook**（`connection: webhook`）：OneBot 实现 POST 事件到应用提供的 path，可选 `api_url` 用于发消息/撤回
- 🔄 **反向 WebSocket**（`connection: wss`）：应用开 WS 服务端，OneBot 实现连上来
- 🔐 `access_token` 鉴权（Bearer）
- 📨 私聊 / 群聊 / 频道消息收发，消息段与 OneBot 12 标准一致

## 安装

```bash
pnpm add @zhin.js/adapter-onebot12 ws
```

Webhook / 反向 WS 需启用 `@zhin.js/http`：

```bash
pnpm add @zhin.js/http
```

## 配置

所有 Bot 使用 **同一 context：`onebot12`**，通过 **`connection`** 区分连接方式。

### 正向 WebSocket

```yaml
plugins:
  - "@zhin.js/adapter-onebot12"

bots:
  - context: onebot12
    connection: ws
    name: ob12-bot
    url: "ws://127.0.0.1:6700"
    access_token: "${ONEBOT12_ACCESS_TOKEN}"
    reconnect_interval: 5000
    heartbeat_interval: 30000
```

### HTTP Webhook

OneBot 实现会向你的 `path` 发送 POST 事件；若需发消息/撤回，请配置实现提供的 HTTP 端点 `api_url`。

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-onebot12"

bots:
  - context: onebot12
    connection: webhook
    name: ob12-webhook-bot
    path: "/onebot12/webhook"
    api_url: "http://127.0.0.1:6700"   # 可选，用于 send_message / delete_message
    access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

### 反向 WebSocket

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-onebot12"

bots:
  - context: onebot12
    connection: wss
    name: ob12-wss-bot
    path: "/onebot12/event"
    access_token: "${ONEBOT12_ACCESS_TOKEN}"
    heartbeat_interval: 30000
```

## 鉴权

- **Bearer**：请求头 `Authorization: Bearer <access_token>`
- 正向 WS 在建立连接时通过 HTTP Upgrade 头鉴权；Webhook / 反向 WS 同上

配置 `access_token` 并与 OneBot 实现端一致即可。

## 连接方式对比

| connection | 说明 |
|------------|------|
| `ws` | 应用连实现的 WebSocket 服务器 |
| `webhook` | 实现 POST 事件到应用 path；发消息需配置 `api_url` |
| `wss` | 应用开 WS 服务端，实现连上来 |

## 动作与事件

- 事件：`type`（meta/message/notice/request）、`detail_type`、`message`（消息段数组）等，见 [事件](https://12.onebot.dev/connect/data-protocol/event/)。
- 动作：`send_message`（params: detail_type, user_id/group_id/channel_id, message）、`delete_message` 等，见 [动作请求](https://12.onebot.dev/connect/data-protocol/action-request/)。

## 协议文档

- [OneBot 12 标准](https://12.onebot.dev/)
- [OneBot Connect 通信方式](https://12.onebot.dev/connect/communication/websocket/)
- [数据协议（事件 / 动作）](https://12.onebot.dev/connect/data-protocol/event/)
