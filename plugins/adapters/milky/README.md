# @zhin.js/adapter-milky

Zhin.js [Milky](https://milky.ntqqrev.org/) 协议适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **Webhook**、**反向 WS**（经 `httpHostToken`）与 **SSE**（HTTP GET `/event`，fetch 解析 `text/event-stream`）。

## 功能特性

- [Milky 协议](https://milky.ntqqrev.org/guide/communication) 兼容（事件 + HTTP API）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连协议端 `ws(s)://baseUrl/event`
- `access_token` 鉴权（Bearer + query）
- 入站经 `Endpoint.emit(...)`；出站 `send({ conversation, payload })` → HTTP `send_*_message`

## 安装

```bash
pnpm add @zhin.js/adapter-milky
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/milky.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation: ConversationRef(kind: "private"|"group", id), message, content, sender, metadata })`  
出站：`send({ conversation, payload })` → HTTP `send_private_message` / `send_group_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

## 前置条件

1. 启动兼容 Milky 的实现，并记录 HTTP API 与事件连接地址。
2. 正向 WS/SSE 需 Zhin 主动可达实现端；Webhook/反向 WS 需实现端可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，生产环境不要暴露无鉴权接口。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  milky:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: milky-bot
        baseUrl: "http://127.0.0.1:8080"
        access_token: "${MILKY_ACCESS_TOKEN}"
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-milky`（`instanceKey: milky`）。

## 连接方式

| connection | 状态 |
|------------|------|
| `ws` | 已实现（推荐） |
| `sse` | HTTP GET `/event`（`Accept: text/event-stream`） || `webhook` | 已实现：POST 入站 + baseUrl HTTP API 出站 |
| `wss` | 已实现：反向 WS（httpHostToken） |

## 鉴权

- **Bearer**：`Authorization: Bearer <access_token>`
- 正向 WS 在 Upgrade 时附带请求头，并在 URL query 写入 `access_token`
- HTTP API 同样使用 Header / query 鉴权

## 消息 ID

`{message_scene}:{peer_id}:{message_seq}`（如 `group:123456:10001`）。

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 技能说明 | `agent/skills/milky.md` |

## 文档链接

- [Milky 快速开始](https://milky.ntqqrev.org/)
- [Milky 通信](https://milky.ntqqrev.org/guide/communication)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS/SSE 无事件 | 核对 `baseUrl`、连接模式与实现端事件服务 |
| 401 或握手失败 | 确认 Bearer/query 中的 `access_token` 与实现端一致 |
| Webhook/WSS 无法连接 | 检查 HTTP Host、网络可达性与回调路径 |
| 能收不能发 | 检查 HTTP API 与发送动作支持情况 |

## 许可证

MIT License
