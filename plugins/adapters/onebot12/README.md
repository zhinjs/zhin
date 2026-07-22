# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) 适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **HTTP Webhook** 与 **反向 WS**（经 `httpHostToken` 注册路由）。

## 功能特性

- [OneBot 12 标准](https://12.onebot.dev/) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `messageGatewayToken`；出站 `send({ target, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot12.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: "private:uid"| "group:gid"|…, content, sender, metadata })`  
出站：`send({ target, payload })` → WS `send_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  onebot12:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: ob12-bot
        url: "ws://127.0.0.1:6700"
        access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-onebot12`（`instanceKey: onebot12`）。

## 连接方式

| connection | 状态 |
|------------|------|
| `ws` | 已实现（推荐） |
| `webhook` | 已实现：POST 入站 + `api_url` HTTP 出站 |
| `wss` | 已实现：反向 WS（httpHostToken） |

## 鉴权

- **Bearer**：`Authorization: Bearer <access_token>`
- 正向 WS 在 Upgrade 时附带请求头，并在 URL query 写入 `access_token`

## 动作与事件

- 事件：`type`（meta/message/notice/request）、`detail_type`、`message` 等，见 [事件](https://12.onebot.dev/connect/data-protocol/event/)。
- 动作：`send_message`、`delete_message`、`get_status` 等，见 [动作请求](https://12.onebot.dev/connect/data-protocol/action-request/)。

## AI 工具

技能说明见 `agent/skills/onebot12.md`。

## 文档链接

- [OneBot 12 标准](https://12.onebot.dev/)
- [OneBot Connect WebSocket](https://12.onebot.dev/connect/communication/websocket/)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
