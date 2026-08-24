---
sidebar: false
---

# Platform Client × Zhin integration contract

> 实施状态（2026-08-24）：Zhin 已接入 `imhelper@1.0.6` 及 Milky V1、Satori V1、
> OneBot 11/12 `1.0.6` Client。下文既记录已落地契约，也列出仍适合在上游继续收紧的边界。

这份契约适用于所有 Zhin 平台适配器：ICQQ 等 SDK 实例、Discord/Slack/Telegram 等平台
Client，以及 `imhelper` / `@imhelper/*` 协议 Client。目标是让事件直接暴露真实 Client，
而不是让 Zhin 复制平台方法或让 Client 接管框架生命周期：

- Zhin `Endpoint`：账号配置、Transport 生命周期、热重载代际、重连/心跳、
  `HttpHost` 路由与 WebSocket upgrade、事件送入 Zhin Core。
- Platform Client：平台 API、协议事件解码、类型、实例对象与便捷业务方法。
- 插件收到任意事件时，通过事件的 `client` 直接调用该 Client。

Zhin 中的具体平台 Endpoint 统一继承 `ClientEndpoint`。这个深模块唯一负责
Client 公开事件订阅、open/close admission 和 `platform.receive` 注入；WS、WSS、
SSE、Webhook 子类只实现各自 transport 与账号生命周期，不再各写一套事件桥。

## 所有适配器的统一 Client 规则

- `Endpoint.client` 必须是实际 SDK/协议 Client 实例，且与 Endpoint 是不同对象。
- 平台适配器包必须向唯一的 `AdapterClientRegistry` 注册 `adapter → Client + EventMap`；handler、
  command、middleware 与 tool 都从同一个字面量 `adapter` 推断类型，不得各建一套
  `AgentEndpoint`/registry。脱离 IM operation 的 task、schedule 与 Host 可另用导出的
  `EndpointClientToken` 显式选账号。
- SDK 已提供 Client/EventMap 时直接引用并推导，不复制接口。ICQQ 例如直接使用
  `@icqqjs/icqq` 的 `Client` 与 `EventMap`。
- SDK 没有稳定 EventMap 时，适配器可以在自己的公开 Client module 声明一次准确映射；
  Endpoint、handler 与测试都从它推导。
- 平台原生方法不在 Endpoint 上重包一层。普通消息仍走统一 outbound chain；入群审批、成员
  管理、平台查询等业务直接调用当前 operation 的 Client。

## imhelper 已提供的公开构造面

`1.0.6` 已从各协议包公开稳定 Client 类和工厂，例如 `OneBotV11Client` /
`createOnebot11Client()`。Client 继承 `ImHelper`，公开原生 `call()`、完整平台能力、精确事件
重载以及三种宿主注入入口：

```ts
export class OneBotV11Client extends ImHelper<
  number,
  OneBotV11Event,
  EventMap<number>,
  OneBotV11Adapter
> {
  call<T>(action: string, params?: Record<string, unknown>): Promise<OneBotV11Response<T>>
  ingest(event: OneBotV11Event): void
  acceptHttp(request: HttpIngressRequest, response?: HttpIngressResponseWriter): Promise<HttpIngressResult>
  acceptWebSocket(socket: UpgradedWebSocket): () => void
}
```

Milky、Satori、OneBot 12 使用同一形态。Zhin Endpoint 直接暴露这些 Client，并只把 Zhin
拥有的 transport 输入交给它们；不会调用 Client 的 `start()`/`stop()` 去启动第二套连接器。

## 公开类型必须以 Client 为根完整闭合

用户不应为了调用原生能力再导入 Zhin 内部 Endpoint 类型或手写断言。每个协议包应从公开
入口导出完整的 Client、构造选项、事件映射、原始事件联合、调用结果和结构化错误类型：

```ts
export class OneBotV11Client { /* 完整公开方法 */ }
export interface OneBotV11ClientOptions { /* ... */ }
export interface OneBotV11ClientEventMap {
  readonly event: OneBotV11Event
  readonly 'message.private': OneBotV11PrivateMessageEvent
  readonly 'notice.group_member_increase': GroupMemberIncreaseNoticeEvent<number>
  // 未知扩展事件仍由 `event` 保底，不静默丢弃。
}
export type OneBotV11ClientEventName = keyof OneBotV11ClientEventMap
export class OneBotV11ProtocolError extends Error { /* status/action/retcode */ }
```

EventMap 固定使用“事件名 → payload”的映射，不把 listener 函数签名当 payload，也不以
`Record<string, any>` 抹平已知事件。Client 的 `on`/`once`、Zhin 的平台事件 handler 和
`ingest()` 都应从这一个 EventMap/原始事件联合推导，避免维护平行类型。

Zhin 适配器只注册一次 Client/EventMap，并可为后台 operation 导出同源 token：

```ts
export const onebot11Client = defineEndpointClient<
  OneBotV11Client,
  OneBotV11ClientEventMap
>('onebot11')

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly onebot11: {
      readonly client: OneBotV11Client
      readonly events: OneBotV11ClientEventMap
    }
  }
}
```

用户侧目标调用形态是一次 handler 声明后直接获得完整类型，不再经过 Endpoint 包装方法：

```ts
export default defineHandler({
  adapter: 'onebot11',
  event: 'notice.group_member_increase',
  async handle({ client, event, endpoint }) {
    await client.call('get_group_info', { group_id: event.group_id })
  },
})
```

这里 `event` 随事件名精确收窄，`client` 是完整 `OneBotV11Client`，`endpoint` 保留账号身份
与代际安全信息。短调用链不等于删掉控制能力：Client 仍须保留原生 `call()`、便捷方法、
`AbortSignal`/timeout、结构化错误和底层 `ingest()`；Zhin 不为每个 SDK 方法再包一层。

ICQQ 使用完全相同的 authoring interface：

```ts
export default defineHandler({
  adapter: 'icqq',
  event: 'notice.group.increase',
  async handle({ client, event }) {
    await client.pickGroup(event.group_id).sendMsg(`welcome ${event.user_id}`)
  },
})
```

其中 `client` 是 `@icqqjs/icqq.Client`，`event` 是 SDK `EventMap` 中该事件 listener 的首个
payload。未知扩展事件使用显式 `event: '*'`，此时 Client 仍保持完整类型，但 payload 为
`unknown`，避免伪造 exhaustive 类型。

## Handler、Command、Middleware、Tool 与后台 operation 的统一姿势

只有一个 IM authoring 判别面，不按 Feature 各发明 helper：

1. handler、command、middleware、tool 声明字面量 `adapter` 后，事件或 context 直接得到
   精确 Client；`$client` 是 operation-scoped getter，只有读取时才解析当前 Endpoint。
2. 未声明 `adapter` 时 `$client` 的静态类型固定为 `unknown`，运行时也不伪造平台能力。
3. task、schedule、Host 或跨账号操作没有当前 Endpoint 时，必须
   `token.get(context, endpointKey)` 显式选账号。

Handler 已直接拿到 Client，不需要再次解析：

```ts
defineHandler({
  adapter: 'icqq',
  event: 'request.group.add',
  async handle({ client, event }) {
    await client.setGroupAddRequest(event.flag, true)
  },
})
```

Command context 带当前 Message，直接读取 `$client`：

```ts
defineCommand({
  adapter: 'icqq',
  async execute(context) {
    await context.$client.sendLike(Number(context.sender!.id), 10)
    return 'ok'
  },
})
```

Middleware 用相同的 `adapter` 同时声明运行时过滤与静态类型：

```ts
defineMiddleware<Message>({
  target: 'inbound',
  adapter: 'icqq',
  async handle(context, next) {
    // context.$client: @icqqjs/icqq.Client
    audit(context.$client.uin, context.input)
    await next()
  },
})
```

同一写法适用于 outbound middleware：运行时先按 adapter 过滤，再由 `$client` getter 从
`OutboundEnvelope` 当前 generation 解析 Client。返回值不能缓存到 operation 之外。

Agent tool 的 IM origin 直接使用同一 getter，不再让模型提供 `endpoint_id`：

```ts
defineAgentTool({
  adapter: 'icqq',
  async execute({ group_id }, context) {
    return context.$client.getGroupMemberList(group_id)
  },
})
```

task / schedule / Host 没有当前消息，固定使用 token 的显式 endpoint 形式。这样调用链保持短，同时账号选择、
跨平台过滤、generation lease 和错误语义仍然可控。

## Transport 必须可注入、可拆分

Client 不应强制自己打开端口。HTTP/Webhook 的基线入口采用标准 Node 请求与响应对象；
Endpoint 决定路由和调用时机，Client 处理当前请求的协议语义：

```ts
interface HttpIngressResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: { status: 'ok' | 'error'; message?: string }
}

interface ProtocolClient<TRawEvent> {
  // 消费宿主交入的一条 HTTP/Webhook 请求；不得创建 server 或监听端口。
  acceptHttp(
    request: import('node:http').IncomingMessage,
    response?: import('node:http').ServerResponse,
  ): Promise<HttpIngressResult>

  // Host/Endpoint 已完成解析，或 Transport 不是 HTTP 时使用。
  ingest(event: TRawEvent): Promise<void> | void
}
```

`acceptHttp()` 在事件已摄取后 resolve；传入 response 时由 Client 写出响应，同时仍返回相同
结构化结果，省略 response 时可由 Host 自行写出。鉴权和路由归 Endpoint，JSON 解析、方法检查
与 1MB body 限制归 Client。Client 不持有 response、路由、socket 或 server 的跨请求生命周期。

反向 WebSocket upgrade 不是纯 `IncomingMessage`，可提供独立重载或方法：

```ts
acceptWebSocket(
  socket: WebSocketLike,
): () => void
```

这里的 socket 仍由 Endpoint/HttpHost 创建和关闭；`head` 保留 Node upgrade 时已经读出的
首段数据，Client 只绑定协议帧。该方法接收已经升级的 socket，不负责 HTTP upgrade，也不
自行监听端口。

如果希望 Client 自己建立正向 WebSocket/SSE 连接，则应与宿主注入入口明确区分：

```ts
open(options?: { signal?: AbortSignal }): Promise<void>
close(): Promise<void>
```

因此最终语义固定为：`acceptHttp(request, response)` 消费宿主 HTTP 请求，
`acceptWebSocket(socket)` 接收宿主已经升级的纯事件 socket，`ingest(rawEvent)` 处理最底层
原始事件，`start()`/`stop()` 管理 Client 自带 receiver，返回的 disposer 只解除宿主 socket
监听。Zhin 使用前三个注入入口，不调用 Client 自带 receiver 生命周期。
Zhin `Endpoint` 负责决定何时调用它们。

## 上游仍可继续优化的边界

- 当前 `1.0.6` 的 EventMap 声明了全部 canonical 事件，但运行时投影尚未闭合：
  OneBot 11/12 只投影已知消息，Milky 只投影消息与撤回；其他
  notice/request/meta 只会触发原始 `event`。这会使 `client.on('request.group', ...)`
  和同名 Zhin handler 通过类型检查却不触发。上游应让每个协议 adapter 的
  `transformEvent()` 覆盖其声明的每个投影，或把 EventMap 收窄到真正会发出的事件。
- `OneBotV12Response` 缺少协议 action response 实际包含的 `echo`，因此
  `$client.call()` 运行时会完整返回 echo，但 TypeScript 无法读取。该字段应补到上游响应类型。
- 四个协议包尚未公开结构化协议错误类型。Client 的原生 `call()` 应原样返回
  `status/retcode/data/message/echo`；网络、HTTP 和解析失败则应抛出带 action/status 的结构化错误。
- 增加显式 `receiveMode: 'manual'`（或允许不创建 receiver）。Zhin 当前虽不调用
  `start()`，但 Client 构造时仍会创建一个永不启动的 receiver。
- 为 OneBot 双工 WS 提供可注入的 action-response classifier，或明确文档说明
  `acceptWebSocket()` 仅适合纯事件 socket。Zhin 目前正确地先按 `echo` 分流，再只对事件调用
  `ingest()`；Milky 纯事件 WS/WSS 则直接使用 `acceptWebSocket()`。
- 给异步监听器增加可等待的 dispatch/错误汇聚语义。当前 EventEmitter + `ingest(): void`
  无法等待 async listener，listener rejection 仍可能成为未处理拒绝。
- Client 的宽泛 `on(eventName: string | symbol, ...)` overload 会放过拼错的事件名；建议将逃生舱
  改成单独的 `onUnknown()`，让默认 `on()` 保持严格。

## Client 自带 receiver 的生命周期与重连要求

- `open()` 必须以“初次连接真正 ready”为 resolve 边界，初连失败应 reject。
- `close()` 必须幂等，取消并清空重连、心跳、请求超时，关闭 socket，并等待当前
  connect/reconnect 完成或中止。
- 主动断开后，任何迟到的 `close/error/online` 回调都不得重新武装重连。
- 重连次数、退避、抖动应可配置；不能固定 10 次后永久离线。默认建议无限重连，设置
  最大间隔，并允许 `AbortSignal` 终止。
- 每次连接尝试必须有代次/attempt identity；旧连接的迟到事件不能改变新连接状态。
- 不直接 `console.log/error`；接受 logger，或只发出结构化 lifecycle/error 事件。

## HTTP/API 调用要求

- 不硬编码 `/{platform}/{accountId}/onebot/v11`、`.../milky/v1` 等 onebots 服务端路径。
  提供明确的 `apiBaseUrl` / `eventUrl`，或可注入的 `resolveActionUrl(action)`。
- OneBot 11 需同时支持 HTTP Action API 与复用正向/反向 WS 的 echo 请求。
- OneBot 12 需支持 `self`、echo 和 HTTP/WS action response。
- Milky 使用标准 `/api/{action}`；Satori 使用 `/v1/{resource}.{method}` 及
  `Satori-Platform` / `Satori-User-ID` headers。
- 暴露原生 `call()`；便捷方法建立在 `call()` 上，不隐藏协议扩展 action。
- 支持注入 `fetch`、超时和 `AbortSignal`；非 2xx、解析与 transport 失败应抛出包含
  action/status 的结构化错误。协议 retcode/code 失败由原生 `call()` 完整返回，
  便捷方法或框架内部解包器可再把它转成错误。
- token 不能出现在日志或错误 URL 中。

## 事件要求

- EventMap 必须正式声明原始 `event`，不使用运行时 emit、类型层缺失的断言。
- 每个收到的原始事件都必须至少触发一次 `event`；未知 notice/request/meta/detail type
  不能静默丢弃。
- 已知事件再投影为 `message.*`、`notice.*`、`request.*`、`meta.*`；原始事件必须保留，
  以支持入群验证、欢迎、退群通知、机器人上线/离线和协议扩展事件。
- 明确 timestamp 单位并统一转换；保留原始 timestamp。
- request 事件应提供有生命周期约束的 approve/reject 方法，底层调用对应协议 Client。
- 事件监听器的异步错误不能成为 unhandled rejection；应返回可等待的 dispatch 结果或
  发出结构化 error 事件。

## 测试契约

- 测试与用户调用同一个公开 Client interface，只观察公开返回值、抛出的结构化错误、发出的
  事件、传入 transport 的请求和 dispose 后的外部行为。
- 不读取私有字段，不断言内部 timer/socket 容器，不 mock 私有方法，不依赖具体重连循环、
  parser 分层或 EventEmitter 实现。
- `acceptHttp`、`acceptWebSocket`、`ingest`、原生 `call()` 和 `close()` 是主要测试 seam；
  实现内部重构时，只要这些可观察行为不变，测试不应修改。
- Zhin 侧使用真实公开 Client 类型和最小公开 fake，禁止为测试新增仅内部可见的 registry、
  setter 或 Endpoint 代理方法。

## HTTP 入站安全要求

若 `connect()` 接受 HTTP `IncomingMessage`：

- 限制 body 大小，监听 aborted/error，并正确处理 backpressure/提前结束。
- 鉴权使用原始 header/query；需要签名的平台保留原始 bytes，不能先 parse 再 stringify。
- 方法、路径、content-type 不匹配时抛出可映射为明确 HTTP 状态的结构化错误。
- 方法本身只处理当前请求，绝不调用 `listen()` 或创建隐式全局 server。

## 建议的最终使用方式

```ts
const client = new OneBotV11Client({
  baseUrl,
  selfId: String(selfId),
  receiveMode: 'ws',
  call: actionTransport,
})

class OneBot11Endpoint extends Endpoint<OneBotV11Client> {
  readonly client = client

  async start(signal: AbortSignal) {
    await this.transport.start(signal, raw => this.client.ingest(raw))
  }
}
```

Zhin 再订阅 Client 的完整原始事件和已知投影，通过唯一 `EndpointEvent` 入口发送
`{ endpoint, client, name, payload }`。这样 Client 可脱离 Zhin 单独使用，Endpoint 也不
泄漏框架内部生命周期给插件。
