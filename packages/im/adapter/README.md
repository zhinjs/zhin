# @zhin.js/adapter

Zhin Plugin Runtime 的平台接入创作面。项目只需在 `adapters/**/$*.ts` 默认导出一个
`defineAdapter()`；框架负责发现、多账号展开、热重载切代、事件准入和资源清理。

```ts
import { defineAdapter } from 'zhin.js/adapter';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create: () => {
    const client = createPlatformClient();
    return {
      client,
      connect({ events }) {
        const unsubscribe = client.onMessage((message) => void events.message({
          conversation: { kind: 'private', id: message.userId },
          content: message.text,
          sender: { id: message.userId },
        }));
        return unsubscribe;
      },
      send: ({ conversation, payload }) => client.send(conversation.id, payload),
    };
  },
});
```

普通适配器只实现 `client`、`connect` 和 `send`。`connect` 返回一个清理函数即可；
`Endpoint` 身份、`start/open/close/stop`、切代期间的事件缓冲均由框架处理。需要精细控制
连接状态的复杂协议仍可返回 `Endpoint` 子类，现有适配器无需迁移。

完整入门见 [适配器开发](../../../docs/authoring/adapters.md)，重连与心跳见
[端点生命周期](../../../docs/authoring/endpoint-lifecycle.md)。

## 源码地图

适配器包保持单层目录，避免为了分类制造更深的相对路径；文件按稳定责任划分：

| 文件 | 只负责 |
| --- | --- |
| `definition.ts` | `defineAdapter()`、能力声明和配置策略；作者入口 |
| `endpoint-contract.ts` | Client、事件、消息与紧凑实现的纯类型契约；不含运行时状态 |
| `endpoint.ts` | 可继承的 Endpoint 平台边界、身份绑定与代际事件准入 |
| `managed-endpoint.ts` | 把 `{ client, connect, activate?, send }` 转成完整 Endpoint；框架内部 |
| `adapter-index.ts` | 展开配置并编排一代 Endpoint；框架内部 |
| `endpoint-{client,control,content,management}.ts` | 四个相互独立的可选端口 |
| `endpoint-lifecycle.ts` | WebSocket/SSE 的连接、重连与心跳基座 |
| `endpoint-commands.ts` | Endpoint 配置命令与运行态投影 |

核心 import 依赖固定为：

```text
adapter-index → managed-endpoint → endpoint → endpoint-contract
definition ─────────────────────→ endpoint
definition ───────────────────────────────→ endpoint-contract
```

平台包只从 `zhin.js/adapter` 导入，不引用这些源码路径。阅读普通适配器时先看
`definition.ts` 和 `endpoint-contract.ts`；只有实现自定义生命周期时才需要看
`endpoint.ts`，`managed-endpoint.ts` 与 `adapter-index.ts` 属于 Runtime 装配细节。

本包只依赖 Kernel 与 Feature Kit，不包含具体平台 SDK。生产 manifest 指向
`lib/provider.js`；开发时可通过 conditional export 读取源码。

单文件插件可用 `setup({ addAdapter })` 注册 `defineAdapter(...)`；Endpoint 仍由同一个
AdapterIndex 和 generation lifecycle 管理。

## Adapter 与 Endpoint 职责

二者不是同一个运行时对象的两种叫法。固定职责如下：

| Module | 负责 | 禁止承担 |
| --- | --- | --- |
| Adapter definition | 声明平台能力与段策略；解析单个 endpoint 配置；注入依赖；返回紧凑实现对象或高级 Endpoint 子类 | 保存 live Endpoint Map、展开多账号配置 |
| Endpoint implementation | 代表一个具体账号/连接；拥有平台 client、协议编解码、connect/send/control/content/management | 理解 generation、手写准入门、注册全局 Endpoint |
| Framework Endpoint | 为紧凑实现补齐身份、start/open/close/stop、切代准入与清理；高级适配器可直接继承 | 理解平台协议、鉴权或媒体上传 |
| AdapterIndex | 展开 1:N 配置；作为当前 generation 的 Endpoint directory；校验能力；编排 admission 与生命周期；提供 Runtime 查询 | 理解平台协议、鉴权、媒体上传或 SDK 类型 |
| Plugin composition | 提供 schema、Resource、命令、HTTP Host 和平台专属 Agent tools | 绕过 AdapterIndex 保存另一份 live Endpoint 权威状态 |

`defineAdapter().create()` 是 Adapter 与 Endpoint 的唯一 Seam：调用前属于配置、能力和
依赖装配，返回后属于具体 Endpoint 的运行期。默认返回紧凑实现对象；只有协议确实需要
自定义生命周期时才继承 `Endpoint`。Adapter definition 应保持无连接状态；
Endpoint 不得把自己注册进模块级 Map。需要从命令、Agent tool 或 Host 查找当前 Endpoint
时，应解析当前 generation 的 AdapterIndex/Resource View，不能建立 second source of truth。

旧 `@zhin.js/core` 的 `Adapter` class 同时承担集合、消息管线、发送和 Registry，属于兼容
外壳，不是 Plugin Runtime 的 authoring model。新代码不得依赖、继承或伪造该 class；运行
期协作应依赖 `OutboundMessageService`、`OutboundHost`、`EndpointControl` 等窄 Interface。
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

`Endpoint.control` owns actions addressed to an existing message:
`recall`, `addReaction`, and `removeReaction`. IM Core consumes only this port;
adapter-specific method names and compound message ids stay at the protocol
boundary.

New adapters should provide `control` directly and declare matching
`operations`. Protocol-specific methods and compound string identifiers are not
inspected by the runtime. `createRecallEndpointControl()` bridges the common
platform `recall(messageId)` shape without leaking that shape into Core.

## Operation-scoped Client resolution

每个平台包公开一个由 `defineEndpointClient<Client, EventMap>()` 创建的 token，并通过
`AdapterClientRegistry` 注册 Client/EventMap 类型。当前 IM operation 不需要手动查找
Endpoint：Handler 的事件参数直接携带 `client`，Command、Middleware 和 Agent Tool 的
`context.$client` 是按需解析的属性 getter：

```ts
defineCommand({
  adapter: 'icqq',
  execute(context) {
    return context.$client.getGroupList();
  },
});

const client = icqqClient.get(context, id);  // task / schedule / Host / 跨账号
const client = icqqClient.find(context, id); // 可选显式查找；不存在时返回 undefined
```

声明字面量 `adapter` 后 `$client` 会反射为确切 Client；不声明时保持 `unknown`。
Token 的 `get()` 会校验 Endpoint adapter，并从当前 generation 的 AdapterIndex 解析；
返回值不得缓存到当前 operation 之外。平台 SDK 方法直接在 Client 上调用，Endpoint 不复制
SDK interface。普通消息发送仍必须走统一 outbound chain。

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
