---
title: "@zhin.js/adapter-onebot12"
package: "@zhin.js/adapter-onebot12"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/onebot12/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot12/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=7437e04dbcc4542d -->

# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) 适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **HTTP Webhook** 与 **反向 WS**（经 `httpHostToken` 注册路由）。

账号由 `Onebot12Adapter` 管理。Endpoint 直接继承实际 `OneBotV12Client`，保留原生方法与事件；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入，不占用 Client 的原生 `start` / `stop` / `send` 方法。

## 功能特性

- [OneBot 12 标准](https://12.onebot.dev/) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `endpointSpec.events`；出站 `send({ conversation, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot12/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

`AdapterIndex` 会把实例默认值与 `endpoints[]` 的逐项覆盖合并；协议层只接收一个已经展开的 endpoint 配置，不再读取嵌套 endpoint 或从进程环境推断身份。Webhook 配置必须同时提供 `path` 与 `api_url`，从而在启动前建立完整的双向能力。

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation: ConversationRef, message: { conversation, id }, content, sender, metadata })`

出站：`send({ conversation, payload })` → WS `send_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

Endpoint 直接继承 `@imhelper/onebot-v12` 的 `OneBotV12Client`；当前操作的 `$client` 就是该实际实例。业务代码直接调用
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
      platform: qq
      userId: "123456789"
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

## 账号选择

每个 Endpoint 必填 `platform` 和 `userId`，精确对应 OneBot12 的 `self.platform` 和 `self.user_id`；`id` 只是本地账号名称。已有配置需明确补齐这两个字段，不能从名称或服务端首个 bot 推断。修改 selector 使用显式账号替换，新身份先停用，旧历史保留。

WS、反向 WS 和 Webhook 都在进入原生 SDK 前过滤其他 bot 的事件。每个动作（包括 `$client.call()` 和 SDK 便捷操作）都在顶层携带固定 `self: { platform, user_id }`；调用参数中的 `params.self` 不会改变该目标。服务级无 `self` 帧只处理原有连接/echo 语义，不归入某个 bot 的聊天 Session。

只读身份核验从 `get_status.bots` 中精确选择目标，再以相同 `self` 调用 `get_self_info`。同一服务可以承载多个 bot；缺少所选 bot 或无法核验时要求显式替换，接口/HTTP 失败仍是失败，不自动换账号。

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
- 经所属 Adapter 增删持久化账号、启停单个 Endpoint；凭据由 Host 加密仓储保存，不改启动 YAML 或 `.env`，不重启进程；
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
