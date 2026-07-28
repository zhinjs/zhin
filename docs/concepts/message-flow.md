# 消息流

Zhin.js 的消息链路是一条单向管道：**入站**从平台 Endpoint 流向命令/AI，**出站**从插件代码流向平台 Endpoint。整条管道由 `ImRuntime`（`@zhin.js/core` 的 `MessageGateway` 实现）串起来，每个环节都从当前 generation 快照取数，天然热重载安全。

## 入站：Adapter → 中间件 → 命令 → AI 兜底

```mermaid
flowchart LR
    P[平台事件<br/>WS / HTTP] --> E[EndpointInstance]
    E -->|"gateway.receive(input)"| G[ImRuntime]
    G --> L[acquire 快照租约]
    L --> M["new Message(...)"]
    M --> MW["中间件 inbound<br/>before-dispatch → after-dispatch"]
    MW --> D{MessageDispatcher}
    D -->|"前缀不匹配 / 无此命令"| U{unmatchedHandler?}
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
     readonly adapter: CapabilityId;  // 来源 endpoint 的能力 id
     readonly target: string;         // 场景，如 "group:123" / "private:456"
     readonly content: string;
     readonly id?: string;            // 平台消息 id
     readonly sender?: string;
     readonly metadata?: Readonly<Record<string, unknown>>; // 如 endpoint 名
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

5. **AI 兜底**。命令 miss（或无前缀文本）时交给 `unmatchedHandler`——装了 `@zhin.js/agent` 的 Host 会把它接到 Agent 回复；未安装则消息安静丢弃。

6. **事件广播**。dispatch 完成后向 `onMessage` 订阅者发出 `RuntimeMessageEvent`（含方向、adapter、target、sender、≤200 字的 `contentPreview`、时间戳），Console 的实时消息流就是消费它。

## 出站：$reply → 渲染 → 中间件 → Endpoint

```mermaid
flowchart LR
    A["$reply(content) / $replyFrom / gateway.send"] --> R[OutboundRenderer<br/>component → JSX 渲染<br/>raw 透传 / 数组展开]
    R --> N[normalizeOutboundPayload<br/>html 段 → 图片/文本<br/>sandbox 直接消费 html]
    N --> V["createOutboundEnvelope<br/>adapter·target·requester·generation"]
    V --> MW["中间件 outbound<br/>可 envelope.replace(payload)"]
    MW --> S[AdapterIndex.send<br/>校验 outbound 能力与在线状态]
    S --> E["endpoint.send({target, payload, parent})"]
```

- **SendContent 四种形态**（`packages/im/core/src/plugin-runtime/im/contracts.ts`）：字符串；`component(name, props)` 组件调用（经 `ComponentIndex` 递归渲染，深度上限 32）；`raw(payload)` 原样透传；以及三者的数组嵌套。
- **Envelope** 携带 `adapter`、`target`、`requester`（发起方插件，用于组件权限与审计）、`generation`，并提供 `replace(payload)` 给出站中间件改写内容。
- **出站中间件**与入站共用一套定义，`target: 'outbound'` 即拦截出站。
- **最终一公里**在 `AdapterIndex.send`：endpoint 必须声明 `outbound` 能力、且处于 `started && !stopped`，否则抛错；通过后调用 `endpoint.send()` 落到平台。

所有发送都应走这条统一管道（`$reply` / `$replyFrom` / `gateway.send`），不要在插件里直接持有平台 SDK 发消息——那会绕过渲染、中间件与事件广播。

## Endpoint 1:N 展开

一个适配器插件实例配置里声明 `endpoints: [{name, ...}]` 时，`AdapterIndex` 把它展开成 N 条独立 endpoint 记录（配置合并规则见 [配置即数据](./config-as-data.md)）：

- 每条记录的能力 id 形如 `<slot id>~<name>`，拥有自己的生命周期（start/open/close/stop）与在线状态；
- 消息上的 `$adapter` 携带展开后的标识（如 `icqq~8596238`），回复沿原路返回对应账号；
- Console 侧按 `(adapter, endpointId)` 寻址，`AdapterIndex.resolve` 依次匹配本地名、能力 id、owner 路径段和 Endpoint 的运行时名（如 ICQQ 的 uin），多匹配时优先精确的 endpoint 名。

因此"两个 QQ 号各收各的消息、各发各的回复"不需要任何特殊代码——配两个 endpoint entry 即可。
