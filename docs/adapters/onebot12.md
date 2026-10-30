---
title: "@zhin.js/adapter-onebot12"
package: "@zhin.js/adapter-onebot12"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/onebot12/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot12/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=bf5e043ddef829c7 -->

# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) 适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **HTTP Webhook** 与 **反向 WS**（经 `httpHostToken` 注册路由）。

## 功能特性

- [OneBot 12 标准](https://12.onebot.dev/) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `Endpoint.emit(...)`；出站 `send({ conversation, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot12/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

`AdapterIndex` 会把实例默认值与 `endpoints[]` 的逐项覆盖合并；协议层只接收一个已经展开的 endpoint 配置，不再读取嵌套 endpoint 或从进程环境推断身份。Webhook 配置必须同时提供 `path` 与 `api_url`，从而在启动前建立完整的双向能力。

入站：`gateway.receive({ conversation: ConversationRef, message: { conversation, id }, content, sender, metadata })`  
出站：`send({ conversation, payload })` → WS `send_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

每个 Endpoint 的 `$client` 是 `@imhelper/onebot-v12` 的 `OneBotV12Client`。业务代码直接调用
`$client.call(action, params)` 和 Client 的公开平台能力；Webhook 使用 Client 的
`acceptHttp()`，双工 WS 则由 Endpoint 分离 `echo` 响应后把事件交给 `ingest()`。

## 前置条件

1. 启动兼容 OneBot 12 的实现，并确认其支持所选 WS 或 Webhook 模式。
2. Webhook 出站还需要可用的 `api_url`；反向连接需要实现端可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，生产环境必须启用鉴权。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  onebot12: "@zhin.js/adapter-onebot12"
onebot12:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: ob12-bot
      url: "ws://127.0.0.1:6700"
      access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-onebot12`（`instanceKey: onebot12`）。

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

技能说明见 `skills/onebot12/SKILL.md`。

## 文档链接

- [OneBot 12 标准](https://12.onebot.dev/)
- [OneBot Connect WebSocket](https://12.onebot.dev/connect/communication/websocket/)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## Console 页面

启动后打开 Console 的「OneBot 12」页（地址 `/onebot12`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 增删 `plugins.onebot12.endpoints`（凭据写入 `.env`，配置里只保留 `${ENV}` 引用）；
- 如果适配器要求登录，页面会显示 LoginAssist 的扫码 / 滑块 / 设备确认待办；

读取需要 `onebot12:read`，写操作需要 `onebot12:write`；管理员 full token 不受限。页面里的「添加 endpoint」等价于原来的 `onebot12 endpoint add`。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS 连接失败 | 核对 OneBot 版本、连接方向、URL 与端口 |
| Webhook 能收不能发 | 检查 `api_url` 可达性与 `send_message` 支持 |
| 401 或握手失败 | 确认 Header/query token 与实现端一致 |
| 事件字段无法识别 | 确认实现端发送的是 OneBot 12 而非 v11 结构 |

## 许可证

MIT License
