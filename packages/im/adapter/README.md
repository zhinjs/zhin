# @zhin.js/adapter

Zhin Plugin Runtime 的 Adapter Feature。它从插件或项目的 `adapters/**/*.ts` 发现
`defineAdapter()` 定义，按 Plugin owner 投影 Endpoint，并把 start/open/close/stop 纳入同一
generation lifecycle。候选 Endpoint 可完成连接 readiness，但入站由 `SnapshotStore`
切换的 generation admission gate 阻断到 commit；旧 Endpoint 不会在 commit 前被关闭。
已声明的 Endpoint 默认都是 required：`create()`、`start()` 或 `open()` 任一步失败都会
销毁整组候选 Endpoint 并拒绝本次 generation，不存在 inert stub 或后台 late-open。

```ts
import { defineAdapter } from '@zhin.js/adapter';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create: (context) => ({ name: context.name }),
});
```

本包只依赖 Kernel 与 Feature Kit，不包含具体平台 SDK。生产 manifest 指向
`lib/provider.js`；开发时可通过 conditional export 读取源码。

单文件插件可用 `setup({ addAdapter })` 注册 `defineAdapter(...)`；Endpoint 仍由同一个
AdapterIndex 和 generation lifecycle 管理。

## Transport Contract

Adapter definitions declare `capabilities` for inbound/outbound admission and
`operations` for optional actions such as `recall`, `edit`, `reaction`, and
`typing`. Runtime callers should query the resulting `EndpointCapabilities`
instead of probing optional endpoint methods. The zero-dependency types live in
[`@zhin.js/im-contract`](../im-contract/README.md).

Framework-facing outbound code carries a structured `ConversationRef`.
`EndpointSendRequest` is `{ conversation, payload }`; platform adapters derive
their native target from `conversation` at the endpoint boundary.

## Endpoint Control Port

`EndpointInstance.control` owns actions addressed to an existing message:
`recall`, `addReaction`, and `removeReaction`. IM Core consumes only this port;
adapter-specific method names and compound message ids stay at the protocol
boundary.

New adapters should provide `control` directly and declare matching
`operations`. Protocol-specific methods and compound string identifiers are not
inspected or adapted by the runtime.

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
record name 即 entry.name——Console 展示、`resolve`/`instance` 查找、inbox 落库都按它命中
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
