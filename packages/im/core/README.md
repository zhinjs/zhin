# @zhin.js/core

`@zhin.js/core` 负责组合 Zhin 的 IM 领域：规范化消息、入站分发、出站渲染、交互语义，以及 Plugin Runtime 的 IM Host。它消费独立 Feature 包产生的 generation snapshot，不拥有平台连接或能力注册表。

架构与消息链路分别见：

- [分层架构](../../../docs/concepts/architecture.md)
- [消息流](../../../docs/concepts/message-flow.md)
- [公开 API 分级](../../../docs/contributing/public-api-surface.md)

## 边界

| 职责 | 所属包 |
|------|--------|
| Adapter 声明、Endpoint 生命周期与 `AdapterIndex` | `@zhin.js/adapter` |
| Command 声明与 `CommandIndex` | `@zhin.js/command` |
| Middleware / Component / Handler 声明 | 对应 Feature 包 |
| generation、snapshot、资源与插件生命周期 | `@zhin.js/plugin-runtime` |
| 消息规范化、渲染、分发与 IM Runtime | `@zhin.js/core` |
| Agent 编排、工具安全与 MCP | `@zhin.js/agent` |
| 进程装配 | `@zhin.js/cli` |

Core 不提供第二套 Adapter 基类、Endpoint 类型或进程级注册表。平台插件统一从 `zhin.js/adapter` 导入 `Adapter`、`defineAdapter`、结构 `Endpoint` 与 `endpointSpec`。

## Plugin Runtime

应用入口使用 `definePlugin()`，能力入口放在约定目录中。只有 `$` 开头的文件会被发现，其他文件可作为同目录 helper 安全复用。

```typescript
// plugin.ts
import { definePlugin } from 'zhin.js'

export default definePlugin({
  name: 'hello-bot',
  setup(context) {
    context.lifecycle.add(() => {
      // release plugin-owned resources
    })
  },
})
```

```typescript
// commands/hello/index.ts
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: '打招呼',
  execute() {
    return 'Hello!'
  },
})
```

运行时入口是 `zhin runtime start`。Core 的 `@zhin.js/core/runtime` 子路径供 CLI composition root 装配 IM Host，不是插件侧 service locator。

## Adapter 与 Endpoint

Adapter 是账号配置、CAS 与连接 incarnation 的唯一 owner。Endpoint 继承真实 SDK 或实质协议 Client，并通过 `endpointSpec` / `createEndpointSpecification` 附加框架钩子；不覆盖 SDK 原生事件和 API。当前 generation 的 `AdapterIndex` 提供目录、租约路由和只读 connection 数据，不向普通查询暴露内部生命周期对象。

```typescript
// adapters/napcat/index.ts
import { defineAdapter } from 'zhin.js/adapter'
import { NapcatAdapter } from '../../src/adapter.js'
import type { NapCatEndpointConfig } from '../../src/protocol.js'

export default defineAdapter<NapCatEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  createAdapter: context => new NapcatAdapter(context),
})
```

`createAdapter` 是唯一工厂。公开 `Endpoint` 没有可继承基类，实际 Native Client 规范示例见 [适配器开发](../../../docs/authoring/adapters.md)。同一个公开 `AdapterRegistry` 推断 Command、Handler、Middleware 和 Tool 的实际 Client 与事件类型，不另建 Client token 或目录。

平台管理、撤回、编辑、reaction 与 typing 通过 specification 的显式 capability/control 端口暴露。调用者通过 `AdapterIndex.management/control` 获取捕获真实 incarnation 的受租约保护端口，不能从只读 connection 数据取未受保护的操作。普通业务消息继续走统一出站链路。

## 消息链路

入站由 Endpoint 发出结构化事件，Core Runtime 完成身份附加、消息规范化和 generation 准入，然后依次执行 Middleware、Command、Handler 与可选 Agent 路由。

出站统一经过：

```text
Message.$reply / OutboundMessageService
  → component render
  → canonical segment normalization
  → before.sendMessage middleware
  → AdapterIndex.send
  → Endpoint specification send hook
```

任何平台发送都必须经过这条链路。

## 语义消息段

业务代码可以返回 `segment.html()`、`segment.markdown()`、`segment.qrcode()` 等语义段。Adapter 定义通过 `segments` 声明交互模式和媒体能力；Core 按当前 Endpoint 能力渲染，平台 Endpoint 只处理最终 payload。

```typescript
import { segment } from '@zhin.js/core'

return segment.html({
  html: '<div>status</div>',
  text: 'status',
  width: 540,
})
```

这些 helper 只创建 canonical `{ type, data }` 消息段。Core 的统一出站规范化链路负责 HTML 渲染、Markdown 策略、交互降级和媒体协商；能力来自当前 generation 的资源与 Adapter definition，不存在第二套消息段类、registry 或 loader。

## 主要入口

- `@zhin.js/core`：Message、场景、消息段、渲染与通用 IM 契约。
- `@zhin.js/core/runtime`：IM Runtime 的 composition ports 与实现。
- `@zhin.js/core/jsx-runtime`：消息 JSX runtime。

插件作者通常从 `zhin.js` 及其 Feature 子路径导入；只有框架装配代码直接依赖 `@zhin.js/core/runtime`。

## 验证

命令可通过 `execution` 显式开启冷却、并发预算与一次进度反馈，详见
[`@zhin.js/command`](../command/README.md#可选执行预算)。Core 在真实入站 operation 上绑定身份，
Root Resource 保存跨 generation 的预算；外层 finally 在所有已启动发送排空后释放。
retirement signal 只停止尚未启动的提示，不释放仍在执行的占用，也不取消普通旧 lease 的发送。
诊断 `dispatchStatus: 'limited'` 与 `limit` 表示准入拒绝，不是权限授权或平台投递失败。

```bash
pnpm --filter @zhin.js/core build
pnpm exec vitest run packages/im/core/tests packages/im/adapter/tests
pnpm check:architecture
```

## 许可证

MIT License

## 定制内置展示

应用 Root 可从 `zhin.js/command` 选择 `commandFeedbackToken`、`commandMenuPresentationToken`，从 `zhin.js/middleware` 选择 `outboundPresentationToken`。保留默认反馈、分页、权限与平台能力；不绑定或返回 `undefined` 继续使用内置展示。具体上下文、JSX 作者和失败边界见[定制内置展示](../../../docs/authoring/behavior-customization.md)。
