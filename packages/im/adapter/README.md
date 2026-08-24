# @zhin.js/adapter

Zhin Plugin Runtime 的 Adapter Feature。它从插件或项目的 `adapters/**/*.ts` 发现
`defineAdapter()` 定义，按 Plugin owner 投影 Endpoint，并把 start/open/close/stop 纳入同一
generation lifecycle。候选 Endpoint 可完成连接 readiness，但入站由 `SnapshotStore`
切换的 generation admission gate 阻断到 commit；旧 Endpoint 不会在 commit 前被关闭。
已声明的 Endpoint 默认都是 required：`create()`、`start()` 或 `open()` 任一步失败都会
销毁整组候选 Endpoint 并拒绝本次 generation，不存在 inert stub 或后台 late-open。

```ts
import { defineAdapter } from 'zhin.js/adapter';

export default defineAdapter({
  capabilities: ['inbound'],
  create: (context) => ({ name: context.name }),
});
```

本包只依赖 Kernel 与 Feature Kit，不包含具体平台 SDK。生产 manifest 指向
`lib/provider.js`；开发时可通过 conditional export 读取源码。

单文件插件可用 `setup({ addAdapter })` 注册 `defineAdapter(...)`；Endpoint 仍由同一个
AdapterIndex 和 generation lifecycle 管理。

## Adapter 与 Endpoint 职责

二者不是同一个运行时对象的两种叫法。固定职责如下：

| Module | 负责 | 禁止承担 |
| --- | --- | --- |
| Adapter definition | 声明平台能力与段策略；解析单个 endpoint 配置；注入依赖；选择并构造一种 Endpoint implementation | 建连、收发消息、持有 socket/timer/listener、维护在线状态、保存 live Endpoint Map |
| Endpoint instance | 代表一个具体账号/连接；拥有 transport、协议编解码、send/control/content/management、start/open/close/stop 与资源清理 | 展开多账号配置、查找兄弟 Endpoint、发布 generation、维护全局 registry、执行 endpoint add/edit/remove 配置命令 |
| AdapterIndex | 展开 1:N 配置；作为当前 generation 的 Endpoint directory；校验能力；编排 admission 与生命周期；提供 Runtime 查询 | 理解平台协议、鉴权、媒体上传或 SDK 类型 |
| Plugin composition | 提供 schema、Resource、命令、HTTP Host 和平台专属 Agent tools | 绕过 AdapterIndex 保存另一份 live Endpoint 权威状态 |

`defineAdapter().create()` 是 Adapter 与 Endpoint 的唯一 Seam：调用前属于配置、能力和
依赖装配，返回后属于具体 Endpoint 的运行期。Adapter definition 应保持无连接状态；
Endpoint 不得把自己注册进模块级 Map。需要从命令、Agent tool 或 Host 查找当前 Endpoint
时，应解析当前 generation 的 AdapterIndex/Resource View，不能建立 second source of truth。

旧 `@zhin.js/core` 的 `Adapter` class 同时承担集合、消息管线、发送和 Registry，属于兼容
外壳，不是 Plugin Runtime 的 authoring model。新代码不得依赖、继承或伪造该 class；运行
期协作应依赖 `MessageGateway`、`OutboundHost`、`EndpointControl` 等窄 Interface。
`pnpm check:adapter-endpoint-boundaries` 对现存 legacy Adapter consumer 与模块级 Agent
Endpoint registry 使用基线 allowlist 做单调收缩门禁：允许逐项删除，但禁止新增。

## Transport Contract

Adapter definitions declare `capabilities` for inbound/outbound admission and
`operations` for optional actions such as `recall`, `edit`, `reaction`, and
`typing`. `operations` accepts either a static list or a resolver receiving the
concrete `AdapterContext`; use the resolver when connection modes expose different
operations. `AdapterIndex` resolves, freezes, and exposes the exact set for every
expanded Endpoint. Runtime callers should query the resulting `EndpointCapabilities`
instead of probing optional endpoint methods. Declarations and the explicit
`EndpointControl` port are validated in both directions, so hidden or unimplemented
operations fail candidate generation before commit. The zero-dependency types live in
[`@zhin.js/im-contract`](../im-contract/README.md).

Framework-facing outbound code carries a structured `ConversationRef`.
`EndpointSendRequest` is `{ conversation, payload }`; platform adapters derive
their native target from `conversation` at the endpoint boundary and return one
non-empty platform message id. IM Runtime alone wraps that id as a structured
`MessageRef` / `DeliveryReceipt`; arbitrary endpoint result shapes are rejected.

## Endpoint Control Port

`EndpointInstance.control` owns actions addressed to an existing message:
`recall`, `addReaction`, and `removeReaction`. IM Core consumes only this port;
adapter-specific method names and compound message ids stay at the protocol
boundary.

New adapters should provide `control` directly and declare matching
`operations`. Protocol-specific methods and compound string identifiers are not
inspected by the runtime. `createRecallEndpointControl()` bridges the common
platform `recall(messageId)` shape without leaking that shape into Core.

## Endpoint 生命周期基座（createEndpointLifecycle）

WS/SSE 类端点的 start/stop/重连/心跳统一走 `createEndpointLifecycle`
（`src/endpoint-lifecycle.ts`），不要手写 `#started`/`#scheduleReconnect` 状态机——
napcat/milky/onebot11/onebot12/satori 已迁移（各自曾独立犯过同一个 start 失败竞态）。
基座内置：start 失败复位不武装重连、仅曾 open 才按退避重连（指数+jitter 可配）、
stop 主动断开不重连、心跳 PONG 看门狗、定时器集中清理、陈旧 socket 事件防叠套。
迁移指引见该文件 JSDoc。

## Adapter ↔ Endpoint：固定 1 对多

一个 adapter 插件实例固定对应一到多个 endpoint：

- `plugins.<adapter>` 配置该 adapter 所有 endpoint 的**通用配置**（如凭据共享字段、
  `master`、`intents`）。
- `plugins.<adapter>.endpoints[index]` 配置单个 endpoint 的**特殊配置**，逐项覆盖通用
  配置，`name` 必填。
- 不写 `endpoints` 时退化为单 endpoint（历史行为），实例 config 原样传给 `create()`。

展开由 `expandEndpointConfigs`（`src/adapter-index.ts`）完成：endpoint record id 为
`<slotId>~<name>`，合并顺序 `{...通用, ...项}`（项优先），`endpoints` 键不下传给适配器。
record name 即 entry.name——Console 展示、endpoint identity 解析、inbox 落库都按它命中
唯一 endpoint（适配器实例的 live name 如 icqq uin 优先于它展示）。entry.name 不得含
`~`/`\0`（会破坏 id 结构），重名/缺名的 entry 会被丢弃并 warn。
多账号示例见 `plugins/adapters/icqq` / `plugins/adapters/qq` 的 README 与 schema。

## 命令前缀（commandPrefix）

适配器实例 config 支持 `commandPrefix`（默认 `''`）：`''` 表示任意文本都按命令匹配；
`'/'` 则要求消息以 `/` 开头才进命令分发。`endpoints[i].commandPrefix` 可逐项覆盖。
解析在 `@zhin.js/core` 的 `MessageDispatcher`（`defaultCommandPrefixResolver`）；
`ImRuntime({ commandPrefix })` 可设全局静态前缀覆盖该行为。

验证：`pnpm --filter @zhin.js/adapter test && pnpm --filter @zhin.js/adapter build`。

架构说明见 [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)。
