# @zhin.js/adapter

Zhin Plugin Runtime 的平台接入创作面。项目只需在 `adapters/**/*/index.ts` 默认导出一个
`defineAdapter()`；框架负责发现、多账号展开、热重载切代、事件准入和资源清理。

```ts
import { Adapter, defineAdapter } from 'zhin.js/adapter';
import { ChannelEndpoint } from './endpoint.js';
import type { ChannelConfig } from './config.js';

class ChannelAdapter extends Adapter<ChannelEndpoint, ChannelConfig> {
  protected createEndpoint(config: ChannelConfig): ChannelEndpoint {
    return new ChannelEndpoint(config);
  }
}

export default defineAdapter<ChannelConfig>({
  capabilities: ['inbound', 'outbound'],
  createAdapter: () => new ChannelAdapter(),
});
```

这里的 `ChannelEndpoint` 是平台自己的类：继承真实 SDK Client，或继承真正拥有 IO、
请求与取消的协议 Client，并 `implements Endpoint`。它通过 `[endpointSpec]` 持有
`createEndpointSpecification(this, hooks)` 的结果；框架生命周期、出站、管理与消息
规范化钩子放在该命名空间，不覆盖 SDK 原生 `emit/on/off` 或其他方法。
没有 SDK 的平台不需要伪造 SDK 外壳。完整可运行示例见
[`examples/minimal-bot/adapters/terminal/index.ts`](../../../examples/minimal-bot/adapters/terminal/index.ts)。

`createAdapter` 必填；公开 `Endpoint` 只有结构 interface，没有可继承的框架基类，
也没有紧凑对象 materializer。Adapter 拥有账号配置、启动/停止、更新、销毁与 child
incarnation；AdapterIndex 只投影目录、租约路由和 generation 准入。
新增账号仅持久化，不构造 Client。配置通过注入的 desired Repository 做一次 CAS；
公开结果不含私有配置或凭据。Repository 在数据库就绪的 activation 阶段读取，
停用或删除的持久账号不会先按启动配置创建连接。

完整入门见 [适配器开发](../../../docs/authoring/adapters.md)，重连与心跳见
[端点生命周期](../../../docs/authoring/endpoint-lifecycle.md)。

## 源码地图

| 文件 | 只负责 |
| --- | --- |
| `definition.ts` | `defineAdapter()`、能力声明、`createAdapter` 作者入口 |
| `endpoint-contract.ts` | 原始事件、规范化消息与出站证据的类型契约 |
| `endpoint-specification.ts` | 公开 Endpoint interface、symbol 与原生 Client 规范附件 |
| `endpoint.ts` | 包内事件准入、缓冲和生命周期运行时，不是公开继承入口 |
| `adapter.ts`、`adapter-types.ts` | 账号 desired Repository、CAS、child incarnation 与操作租约 |
| `adapter-index.ts` | Adapter/Endpoint 目录、generation 投影和租约路由 |
| `endpoint-{client,control,content,management}.ts` | 原生事件桥接与可选控制、内容、管理端口 |
| `endpoint-lifecycle.ts` | WebSocket/SSE 的连接、重连与心跳基座 |
| `endpoint-configuration.ts` | 不含持久化行为的配置行 DTO |
| `endpoint-commands.ts`、`adapter-runtime-console.ts` | 聊天与 Console 共用的账号管理语义 |

平台包只从 `zhin.js/adapter` 导入，不引用内部源码路径。本包不包含具体平台 SDK。
生产 manifest 指向 `lib/provider.js`；开发时可通过 conditional export 读取源码。
单文件插件也可用 `setup({ addAdapter })` 注册同一 `defineAdapter(...)`。

## Adapter 与 Endpoint 职责

| Module | 负责 | 禁止承担 |
| --- | --- | --- |
| Adapter definition | 声明能力、配置类型和 Adapter 构造入口 | 保存另一份 live Endpoint Map |
| Adapter | 验证配置、账号 CAS、构造真实 Client、编排 child 生命周期 | 写项目 YAML/JSON 或 `.env` |
| Endpoint | 具体账号的真实 Client、协议 IO、原始事件与规范化消息 | 理解 Root generation 或注册平行目录 |
| AdapterIndex | owner 目录、能力校验、准入、租约路由 | 平台协议、鉴权或媒体上传 |
| Plugin composition | schema、Resource、命令、HTTP 与平台工具 | 绕过 Adapter 保存 live Endpoint 权威状态 |

首次修改已有静态账号前，Console 列出清单并由管理员确认迁移；迁移保留身份和历史。
之后 Console 与聊天命令使用同一持久化账号配置，变更不写启动文件、不重启 Root。
新增只保存，启动由用户明确操作；普通连接配置更新只重连目标账号。身份替换关闭旧
账号，产生新 instance/canonical identity，历史保留且不继承旧 Session，新账号仍须手动启动。
身份字段与普通可更新字段由平台明确声明，opaque 凭据核验由真实只读协议接口负责。
配置冲突或提交结果未知时应读取权威状态核实，不能自动重放写操作。

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
their native target from `conversation` at the endpoint boundary. A single send may return a
non-empty platform message id; adapters that split a payload return ordered `{ parts }` evidence.
Each part may contain its confirmed `messageId` and the `sourceIndices` of the original top-level
payload segments (a non-array payload is one segment). A missing id stays unknown. IM Runtime
alone wraps confirmed ids as `MessageRef` / `DeliveryReceipt` and maps source content; arbitrary
endpoint result shapes are rejected. When a later send fails, `EndpointDeliveryError.parts`
preserves completed parts with `disposition: 'unknown'`; callers must not resend the whole batch.

## Endpoint Control Port

`createEndpointSpecification(..., { control })` supplies framework actions addressed to an existing message:
`recall`, `addReaction`, and `removeReaction`. IM Core consumes only this port;
adapter-specific method names and compound message ids stay at the protocol
boundary.

Adapters provide the specification’s `control` hook and declare matching
`operations`. Protocol-specific methods and compound string identifiers are not
inspected by the runtime. `createRecallEndpointControl()` bridges the common
platform `recall(messageId)` shape without leaking that shape into Core.

## Operation-scoped Client resolution

每个平台通过公开 `zhin.js/adapter` 的 `AdapterRegistry` 注册实际 Adapter 类；
这是同一底层注册表的公开导出，不新增另一处 registry。
Client 和 EventMap 从该类的泛型推断，不再有独立 Client token 或 descriptor lookup。
Handler 的事件参数携带原生 `client`；Command、Middleware 和 Agent Tool 的
`context.$client` 按当前 operation 的 Endpoint 解析：

```ts
defineCommand({
  adapter: 'icqq',
  execute(context) {
    return context.$client.getGroupList();
  },
});
```

声明字面量 `adapter` 后 `$client` 推断为确切原生 Client；不声明时保持 `unknown`。
跨账号任务通过当前 owner 的 AdapterIndex 查询真实 canonical identity，并在 operation
租约内使用，不能缓存到 operation 之外。SDK 方法直接在 Client 上调用；普通消息发送
仍走统一 outbound chain。SDK 外部副作用不能靠取消信号撤回。

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
- `plugins.<adapter> endpoints[index]` 配置单个 endpoint 的**特殊配置**，逐项覆盖通用
  配置，`id` 必填。
- 不写 `endpoints` 时退化为单 endpoint（历史行为），实例 config 交给 Adapter 构造对应 Endpoint。

静态配置展开使用通用字段与单项覆盖（项优先）；运行时账号以 Repository 中的
instanceId 和 canonicalId 为身份依据。配置项 id、显示名与 SDK nickname 不能代替
canonical identity，重建账号也不能凭这些值继承旧身份。
多账号示例见 `plugins/adapters/icqq` / `plugins/adapters/qq` 的 README 与 schema。

Endpoint specification 可通过 `transportState` getter 报告本地传输状态：`idle / connecting / open / reconnecting / closed / stopped`。
`AdapterIndex.describe()` 分开报告 `admitted` 与 `transportState`，只有准入开放且传输为 `open` 才是 `connected`。
未提供健康 getter 时报告 `unknown`，不会假报在线。
specification 的 `start()` 完成仅表示启动调用完成；HTTP/反向连接需区分 listener 挂载与实际连接等待。
候选代事件缓冲有界（256）；`eventDiagnostics` 提供 buffered/dropped/dispatchFailures，无事件正文。

## 命令前缀（commandPrefix）

适配器实例 config 支持 `commandPrefix`（默认 `''`）：`''` 表示任意文本都按命令匹配；
`'/'` 则要求消息以 `/` 开头才进命令分发。`endpoints[i].commandPrefix` 可逐项覆盖。
解析在 `@zhin.js/core` 的 `MessageDispatcher`（`defaultCommandPrefixResolver`）；
`ImRuntime({ commandPrefix })` 可设全局静态前缀覆盖该行为。

## Console RPC（适配器页面）

适配器可以在 `plugin.ts` 的 `setup` 里发布一个 Console RPC，把原本只能靠聊天命令完成的 endpoint 管理搬到 Console：

```ts
import { createAdapterConsoleRpc } from 'zhin.js/adapter';
import { pluginConsoleRpcToken } from 'zhin.js';
import { telegramConsoleSpec } from './src/console-spec.js';

context.resources.provide(pluginConsoleRpcToken, createAdapterConsoleRpc({
  ...telegramConsoleSpec,
  getConfig: () => context.config.get(),
}));
```

生成的 `status` 和 `endpoint-add/update/start/stop/remove/replace` 约定：

- 页面读取需要 `<adapterKey>:read`，写操作需要 `<adapterKey>:write`；
- Host 从调用者所属插件的运行目录解析 Adapter，不能跨 owner 选择账号；
- mutation 携带 `expectedGeneration`、`expectedRevision`，首次迁移另需管理员确认；
- `env: true` / `secret: true` 是敏感字段声明：响应只返回遮蔽值，凭据由 Host 私有存储保存；
- 新增与替换只保存且未启动；普通更新仅作用于目标账号；
- 无运行目录或持久化能力时拒绝修改，不回退项目文件写入；
- 返回的 `saved` 与 `execution` 分别表示配置提交和运行执行状态；`commit_unknown` 必须先核实；
- 平台自有动作由 `actions` 声明，`availableActions` 控制显示（例如 QQ 扫码绑定）。

浏览器侧使用 [`@zhin.js/client`](../../console/client/README.md) 的 `createAdapterConsolePage(adapterKey)`。

## 掉线通知（createAdapterOutageNotifier）

适配器可用共享 helper 在自身掉线时经**另一个**适配器实例发通知，不绕过统一出站链路：

```ts
import { createAdapterOutageNotifier, resolveAdapterNotifyTarget } from 'zhin.js/adapter';
import { outboundHostToken } from 'zhin.js';

const target = resolveAdapterNotifyTarget(config.notify); // yaml: adapter/endpoint/kind/id
const notifier = createAdapterOutageNotifier(
  context.has?.(outboundHostToken) ? context.use(outboundHostToken) : undefined,
  target,
);
await notifier.send('ICQQ 10001 已掉线');
```

`notify` 目标显式写 `adapter`、`endpoint`、`kind`、`id`，不会猜会话；`configured` 为 false 时 `send` 返回 `false`，适配器照常运行。ICQQ/QQ 的 `notify` schema 见各自 `schema.json`。

验证：`pnpm --filter @zhin.js/adapter test && pnpm --filter @zhin.js/adapter build`。

架构说明见 [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)。


### Transport 创建上下文

`createAdapter(context)` 只提供 `owner`、`config`、`generation`、`signal` 和 `use(token)`；
Adapter 还提供端点的 `id`、`endpointId` 和 `name`。这些值属于 owner 的创建生命周期，
不是每次消息或工具调用的 operation snapshot。未改 owner 的连接可跨局部热重载保留。

创建上下文不提供 `project()`，类型和实际对象都如此；JavaScript 强行调用会抛出
`TypeError`，不会悄悄读取旧代投影。需要跨 Feature 的业务执行放在 command、handler、
middleware 或 tool 中，通过它们当前 operation 的上下文解析。
