# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) 适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **HTTP Webhook** 与 **反向 WS**（经 `httpHostToken` 注册路由）。

## 功能特性

- [OneBot 12 标准](https://12.onebot.dev/) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `messageGatewayToken`；出站 `send({ conversation, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot12.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation: ConversationRef, message: { conversation, id }, content, sender, metadata })`  
出站：`send({ conversation, payload })` → WS `send_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

## 前置条件

1. 启动兼容 OneBot 12 的实现，并确认其支持所选 WS 或 Webhook 模式。
2. Webhook 出站还需要可用的 `api_url`；反向连接需要实现端可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，生产环境必须启用鉴权。

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

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS 连接失败 | 核对 OneBot 版本、连接方向、URL 与端口 |
| Webhook 能收不能发 | 检查 `api_url` 可达性与 `send_message` 支持 |
| 401 或握手失败 | 确认 Header/query token 与实现端一致 |
| 事件字段无法识别 | 确认实现端发送的是 OneBot 12 而非 v11 结构 |

## 许可证

MIT License
