# @zhin.js/adapter-milky

Zhin.js [Milky](https://milky.ntqqrev.org/) 协议适配器（Plugin Runtime）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **Webhook**、**反向 WS**（经 `httpHostToken`）与 **SSE**（HTTP GET `/event`，fetch 解析 `text/event-stream`）。

账号由 `MilkyAdapter` 管理。Endpoint 直接继承实际 `MilkyV1Client`，保留原生方法与事件；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入，不占用 Client 的原生 `start` / `stop` / `send` 方法。

## 功能特性

- [Milky 协议](https://milky.ntqqrev.org/guide/communication) 兼容（事件 + HTTP API）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连协议端 `ws(s)://baseUrl/event`
- `access_token` 鉴权（Bearer + query）
- 入站经 `endpointSpec.events`；出站 `send({ conversation, payload })` → HTTP `send_*_message`

## 安装

```bash
pnpm add @zhin.js/adapter-milky
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/milky/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

`AdapterIndex` 会把实例默认值与 `endpoints[]` 的逐项覆盖合并；协议层只接收一个已经展开的 endpoint 配置，不再读取嵌套 endpoint 或从进程环境推断 endpoint 身份。

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation: ConversationRef(kind: "private"|"group", id), message, content, sender, metadata })`

出站：`send({ conversation, payload })` → HTTP `send_private_message` / `send_group_message`（payload 已由 gateway/core 渲染；无 segment-mapper）

Endpoint 直接继承 `@imhelper/milky-v1` 的 `MilkyV1Client`；当前操作的 `$client` 就是该实际实例。插件可直接调用
`$client.call()`、`getGroupList()` 等公开能力；`defineHandler({ adapter: 'milky', event: ... })`
使用 imhelper 的精确事件名与 payload 类型。HTTP、纯事件 WS/WSS 和 `ingest()` 都汇入同一个
原生 Client 事件流；所属 `MilkyAdapter` 管理账号与运行实例，协议连接、鉴权、重连和心跳保留在该实际 Client 中。

## 前置条件

1. 启动兼容 Milky 的实现，并记录 HTTP API 与事件连接地址。
2. 正向 WS/SSE 需 Zhin 主动可达实现端；Webhook/反向 WS 需实现端可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，生产环境不要暴露无鉴权接口。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  milky: "@zhin.js/adapter-milky"
milky:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: milky-bot
      baseUrl: "http://127.0.0.1:8080"
      access_token: "${MILKY_ACCESS_TOKEN}"
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-milky`（`instanceKey: milky`）。

## 连接方式

| connection | 状态 |
|------------|------|
| `ws` | 已实现（推荐） |
| `sse` | HTTP GET `/event`（`Accept: text/event-stream`） |
| `webhook` | 已实现：POST 入站 + baseUrl HTTP API 出站 |
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
| Permit 词汇 | `PERMITS.md` |
| 技能说明 | `skills/milky/SKILL.md` |

## 文档链接

- [Milky 快速开始](https://milky.ntqqrev.org/)
- [Milky 通信](https://milky.ntqqrev.org/guide/communication)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## Console 页面

启动后打开 Console 的「Milky」页（地址 `/milky`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 经所属 Adapter 增删持久化账号、启停单个 Endpoint；凭据由 Host 加密仓储保存，不改启动 YAML 或 `.env`，不重启进程；
- 如果适配器要求登录，页面会显示 LoginAssist 的扫码 / 滑块 / 设备确认待办；

读取需要 `milky:read`，写操作需要 `milky:write`；管理员 full token 不受限。页面里的「添加 endpoint」等价于原来的 `milky endpoint add`。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS/SSE 无事件 | 核对 `baseUrl`、连接模式与实现端事件服务 |
| 401 或握手失败 | 确认 Bearer/query 中的 `access_token` 与实现端一致 |
| Webhook/WSS 无法连接 | 检查 HTTP Host、网络可达性与回调路径 |
| 能收不能发 | 检查 HTTP API 与发送动作支持情况 |

## 许可证

MIT License
