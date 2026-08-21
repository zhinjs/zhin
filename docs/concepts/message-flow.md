# 消息流

用户在群里发一条 `/ping`，到 Bot 的回复落回平台，中间经过的每个环节都在一条单向管道上：**入站**从平台 Endpoint 流向命令/AI，**出站**从插件代码流向平台 Endpoint。整条管道由 `ImRuntime`（`@zhin.js/core` 的 `MessageGateway` 实现）串起来，每个环节都从当前 generation 快照取数，天然热重载安全。

## 入站：Adapter → 中间件 → 命令 → AI 兜底

```mermaid
flowchart LR
    P[平台事件<br/>WS / HTTP] --> E[EndpointInstance]
    E -->|"gateway.receive(input)"| G[ImRuntime]
    G --> L[acquire 快照租约]
    L --> M["new Message(...)"]
    M --> MW["中间件 inbound<br/>before-dispatch → after-dispatch"]
    MW --> D{MessageDispatcher}
    D -->|"前缀不匹配 / 无此命令"| U{snapshot IngressRoute?}
    U -->|"已装 Agent"| AI[AI 兜底回复]
    U -->|"未装"| N[静默丢弃]
    D -->|"命令命中且有返回值"| R["$replyFrom(owner, value)"]
    R --> O[出站管道]
    AI --> O
```

各环节的真实代码位置：

1. **Endpoint 归一化**。平台适配器的 Endpoint（如沙箱的 `SandboxWsEndpoint`）把平台事件归一化为 `IncomingMessage`，调用创建时注入的 `messageGatewayToken`：

   ```ts
   interface IncomingMessage {
     readonly conversation: ConversationRef; // 结构化会话（endpoint/kind/id/parent/threadId）
     readonly message?: MessageRef;   // 平台消息身份（原生消息 id）
     readonly content: string;
     readonly segments?: readonly Segment[];
     readonly sender?: { id: string; name?: string; roles?: readonly string[] };
     readonly replyTo?: { id: string }; // 显式平台引用，不从 metadata 猜测
     readonly metadata?: Readonly<Record<string, unknown>>;
   }
   ```

2. **租约与 Message**。`ImRuntime.receive` 先 `acquire()` 当前代快照（在途消息不被重载打断，见 [generation 与生命周期](./generation-lifecycle.md)），查出该 endpoint 的 owner 插件作为默认 requester，构造 `Message`。`Message` 携带 `$reply(content)` 与 `$replyFrom(owner, content)` 两个出站闭包；dispatch 结束后 reply 作用域关闭，之后再调 `$reply` 会抛 `Message reply scope has ended`。

3. **入站中间件**。`MiddlewareIndex` 按 `phase`（`before-dispatch` 先、`after-dispatch` 后）与 `order` 排序，逐个包住终端动作：

   ```ts
   defineMiddleware({
     phase: 'before-dispatch',   // 默认
     target: 'inbound',          // 默认；'outbound' 拦截出站
     order: 0,
     async handle(context, next) {
       // context.input 是 Message（inbound）或 OutboundEnvelope（outbound）
       await next();             // 不调用 next() 即拦截
     },
   });
   ```

4. **命令分发**。`MessageDispatcher` 先解析命令前缀（默认按消息所属适配器实例的配置：`endpoints[i].commandPrefix` 覆盖顶层 `commandPrefix`，默认 `''` 无前缀，见 [配置即数据](./config-as-data.md)），前缀不匹配直接 miss；命中前缀则剥离后交给 `CommandIndex.dispatch`。命令有返回值时，分发器用命令 owner 身份 `$replyFrom(owner, value)` 自动回复。

5. **AI 兜底**。命令 miss（或无前缀文本）时，`ImRuntime` 从当前消息所持 snapshot 的 root resources 解析 generation-owned `IngressRoute`。装了 `@zhin.js/agent` 的 composition root 会在 generation setup 提供该内部 route；未安装则消息安静丢弃。它不是 `MessageGateway` 上可变的插件 setter。

6. **事件广播**。dispatch 完成后向 `onMessage` 订阅者发出 `RuntimeMessageEvent`（含方向、conversation、sender、≤200 字的 `contentPreview`、时间戳），Console 的实时消息流就是消费它。

## 出站：$reply → 渲染 → 中间件 → Endpoint

```mermaid
flowchart LR
    A["$reply(content) / $replyFrom / gateway.send"] --> R[OutboundRenderer<br/>component → JSX 渲染<br/>raw 透传 / 数组展开]
    R --> N[normalizeOutboundPayload<br/>html 段 → 图片/文本<br/>sandbox 直接消费 html]
    N --> V["createOutboundEnvelope<br/>conversation·requester·generation"]
    V --> MW["中间件 outbound<br/>可 envelope.replace(payload)"]
    MW --> S[AdapterIndex.send<br/>校验 outbound 能力与在线状态]
    S --> E["endpoint.send({conversation, payload})"]
```

- **SendContent 形态**（`packages/im/core/src/plugin-runtime/im/contracts.ts`）：字符串；canonical `Segment`（一等公民，见下文「多模态」）；`component(name, props)` 组件调用（经 `ComponentIndex` 递归渲染，深度上限 32）；`raw(payload)` 原样透传；以及它们的数组嵌套。
- **Envelope** 携带 `conversation`（结构化会话寻址 `ConversationRef`，`@zhin.js/im-contract`）、`requester`（发起方插件，用于组件权限与审计）、`generation`，并提供 `replace(payload)` 给出站中间件改写内容。
- **出站中间件**与入站共用一套定义，`target: 'outbound'` 即拦截出站。
- **最终一公里**在 `AdapterIndex.send`：endpoint 必须声明 `outbound` 能力、且处于 `started && !stopped`，否则抛错；通过后调用 `endpoint.send()` 落到平台。

所有发送都应走这条统一管道（`$reply` / `$replyFrom` / `gateway.send`），不要在插件里直接持有平台 SDK 发消息——那会绕过渲染、中间件与事件广播。

## 多模态：双向 Segment 一贯制

全框架只有一种媒体表达——`@zhin.js/im-contract` 的 canonical `Segment` + `MediaRef`：

```ts
interface MediaRef {
  kind: 'url' | 'path' | 'base64' | 'file';  // file = 平台不透明引用（Telegram file_id 等）
  value: string;
  mime_type?: string;
  file_name?: string;
  size?: number;
}
// image / audio / video / file 段的 data 一律为 { media: MediaRef, alt?/duration?/name? }
```

**入站**：适配器把平台载荷归一为 `Segment[]` 随 `gateway.receive({ segments })` 上送。不透明平台 id 必须经当前 generation 的 `EndpointContentPort` 物化；引用解析期间快照租约一直持有。所有 URL、path 与 base64 随后进入同一条流水线：HTTPS/SSRF 与重定向检查 → 字节上限 → 文件魔数识别 → 声明 MIME/实际类型一致性检查 → `UserMessage.media`。框架不信任扩展名或 Adapter 声明的 MIME，也不把二进制/base64 写入会话事实源。每项媒体恰好产生 `accepted | derived | unsupported | rejected | failed` 终态；失败以明确的不可信 user-context 文本呈现，绝不伪装成“模型已看到图片”。Provider 必须显式声明 `text/image/audio/video/file` 输入能力，缺省仅 `text`；不支持的类型不会猜测放行。

## 会话事实、引用与通知

`ConversationEventStore` 是 IM 上下文的唯一事实源。入站/出站消息、撤回 tombstone、回应、成员加入/退出、禁言/解禁和角色变化按会话幂等追加；不再维护 `im_transcripts` 或文本型 `chat_history` 双轨。合并转发条目使用中性 `actor`，不映射成模型 `user/assistant/system` role。

会话中尚未被 Agent session 消费的入站消息也从该 Store 按游标读取，作为不可信 `user-context` 投影；当前触发 Turn 的消息会被排除，避免重复。不存在进程级 passive buffer，失败 Turn 不推进游标，HMR 与多 Root 也不会共享旁路状态。

当前 Turn 把 `replyTo`、forward 与媒体注册为 scoped `TurnReference`。Agent 只暴露 `inspect_conversation_reference(reference, depth?)`：先查本地事实源，再通过持租约的 Endpoint 回源；跨会话、跨 Endpoint、过期 Turn 均 fail-closed。尚未消费的重要 notice 会作为明确标注的“不可信会话数据”附在下一次用户 Turn，永远不进入 system/developer prompt；只有 Turn 成功提交才推进 session cursor，失败会保留。高频 reaction/poke 会聚合，登录、二维码、断线等 process 事件只进入诊断日志。

**出站**：AI 回复 → `OutputElement[]` → canonical `Segment[]`（`publishOutboundElements`）→ `$reply`（Segment 是一等 `SendContent`）→ `normalizeOutboundPayload`（html→image/文本、keyboard、媒体协商）→ endpoint。媒体协商按 adapter definition 的 `segments.outboundMedia` 声明驱动（`'url' | 'path' | 'base64' | 'upload'`）：仅 `url-or-text` 端点会在中央把非 URL 媒体降级为文本；其余由 adapter 按平台最优路径自物化（URL 直发 / base64 直发 / 平台上传 / 读盘），无 `data.media` 的段会被 warn 丢弃——legacy `data.url/file/base64` 形状已不存在。

## Endpoint 1:N 展开

一个适配器插件实例配置里声明 `endpoints: [{name, ...}]` 时，`AdapterIndex` 把它展开成 N 条独立 endpoint 记录（配置合并规则见 [配置即数据](./config-as-data.md)）：

- 每条记录的能力 id 形如 `<slot id>~<name>`，拥有自己的生命周期（start/open/close/stop）与在线状态；
- 消息上的 `$adapter` 携带展开后的标识（如 `icqq~8596238`），回复沿原路返回对应账号；
- Console 侧按 `(adapter, endpointId)` 寻址，`AdapterIndex.resolve` 依次匹配本地名、能力 id、owner 路径段和 Endpoint 的运行时名（如 ICQQ 的 uin），多匹配时优先精确的 endpoint 名。

因此"两个 QQ 号各收各的消息、各发各的回复"不需要任何特殊代码——配两个 endpoint entry 即可。
