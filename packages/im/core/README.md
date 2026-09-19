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

Core 不提供第二套 Adapter 基类、Endpoint 类型或进程级注册表。平台插件统一从 `zhin.js/adapter` 导入 `defineAdapter` 与 `Endpoint<TClient>`。

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
// commands/$hello.ts
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

Adapter 定义选择并创建 Endpoint；Endpoint 独占账号连接、平台 Client 和 IO。当前 generation 的 `AdapterIndex` 持有实例并提供发送、控制与 Client 查询。

```typescript
// adapters/$example.ts
import { Endpoint, defineAdapter } from 'zhin.js/adapter'

class ExampleEndpoint extends Endpoint<ExampleClient> {
  readonly client = new ExampleClient()

  async start(signal: AbortSignal) {
    // connect transport; bind cancellation to signal
  }

  async stop() {
    // idempotent cleanup
  }

  async send(request) {
    return this.client.send(request.conversation.id, request.payload)
  }
}

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create() {
    return new ExampleEndpoint()
  },
})
```

平台管理、撤回、编辑、reaction 与 typing 通过 Endpoint 的显式 capability/control 端口暴露。Agent 和业务层读取当前 generation 的能力投影，不扫描实例方法，也不维护自己的 Endpoint 目录。

## 消息链路

入站由 Endpoint 发出结构化事件，Core Runtime 完成身份附加、消息规范化和 generation 准入，然后依次执行 Middleware、Command、Handler 与可选 Agent 路由。

出站统一经过：

```text
Message.$reply / OutboundMessageService
  → component render
  → canonical segment normalization
  → before.sendMessage middleware
  → AdapterIndex.send
  → Endpoint.send
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
- `@zhin.js/core/tool-zod`：Tool schema 与 Zod 转换。
- `@zhin.js/core/jsx-runtime`：消息 JSX runtime。

插件作者通常从 `zhin.js` 及其 Feature 子路径导入；只有框架装配代码直接依赖 `@zhin.js/core/runtime`。

## 验证

```bash
pnpm --filter @zhin.js/core build
pnpm exec vitest run packages/im/core/tests packages/im/adapter/tests
pnpm check:architecture
```

## 许可证

MIT License
