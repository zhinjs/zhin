# @zhin.js/core

Zhin.js **IM/多通道运行时**包：Plugin、Adapter、**Endpoint**、MessageDispatcher 与统一出站链。**AI 编排（ZhinAgent、工具安全、MCP）在 [`@zhin.js/agent`](../agent/README.md)**；本包仅 selective re-export `@zhin.js/ai` 的 Provider / Agent 原语供插件直接使用。

领域词汇见 [CONTEXT.md](./CONTEXT.md)；入站/出站流程见 [消息如何流转](../../docs/essentials/message-flow.md)。

## 核心概念

### Plugin（插件）

插件是 Zhin.js 的基本组织单位。每个插件拥有独立的生命周期和上下文，通过 `usePlugin()` Hook 访问框架能力。

```typescript
import { usePlugin, MessageCommand } from '@zhin.js/core'

const { addCommand, addTool, addCron, onMounted, onDispose } = usePlugin()

onMounted(() => console.log('插件已挂载'))
onDispose(() => console.log('插件已卸载'))

addCommand(
  new MessageCommand('hello <name:word>')
    .desc('打招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)
```

插件名称默认从文件路径推导，也可以显式声明：

```typescript
// 方式 1: 导出 pluginName 常量
export const pluginName = 'my-awesome-plugin'

// 方式 2: 使用 definePlugin 声明式 API
import { definePlugin } from '@zhin.js/core'

export default definePlugin({
  name: 'my-awesome-plugin',
  setup(plugin) {
    // 在这里使用 plugin 注册命令、工具等
  },
})

// 方式 3: 手动设置
const plugin = usePlugin()
plugin.setName('my-awesome-plugin')
```

### Feature（特性抽象）

Feature 是 Zhin.js 的核心扩展机制。所有内置功能均继承自 `Feature` 抽象基类，提供统一的注册/注销、插件归属追踪、JSON 序列化和变更事件通知能力。

```
Feature (抽象基类)
├── CommandFeature    — 消息命令       addCommand()
├── ToolFeature       — AI 可调用工具   addTool()
├── SkillFeature      — 技能记录       Agent 从 SKILL.md 注入
├── CronFeature       — 定时任务       addCron()
├── DatabaseFeature   — 数据模型       defineModel()
├── ComponentFeature  — 消息组件       addComponent()
├── ConfigFeature     — 插件配置       addConfig()
└── PermissionFeature — 权限管理
```

每个 Feature 都会在 `Plugin.prototype` 上注入对应的扩展方法（如 `addCommand`、`addTool`），插件通过 `usePlugin()` 获取这些方法。

Feature 支持变更事件监听，依赖方可实时响应 item 的增删：

```typescript
const toolFeature = plugin.inject('tool')
const off = toolFeature.on('add', (tool, pluginName) => {
  console.log(`工具 ${tool.name} 已注册 (来自 ${pluginName})`)
})
toolFeature.on('remove', (tool) => {
  console.log(`工具 ${tool.name} 已移除`)
})
```

### 出站消息段：`segment.html`

业务插件可返回 **`html` 消息段**，由出站链统一处理转图或文本回退：

```typescript
import { segment } from '@zhin.js/core'

return segment.html({
  html: '<div>…</div>',  // 必填：Satori 可渲染的 HTML
  text: undefined,        // 可选：显式回退文本（覆盖自动剥离）
  width: 540,
  backgroundColor: '#d8dce3',
  fileName: 'card.png',
})
```

- 安装 **`@zhin.js/plugin-html-renderer`** 时，`before.sendMessage` 自动将 `html` 转为 PNG。
- 未安装或转图失败时，`Adapter.renderSendMessage` 链尾调用 **`coerceHtmlSegmentsToText`**，用 **`htmlToFallbackText`** 剥离纯文本。
- 日志预览为 `[html-card]` + 自动剥离摘要（前 80 字），不 dump 完整 HTML。

### Adapter（适配器）

适配器将不同聊天平台接入 Zhin.js，统一消息收发接口。

```typescript
// 适配器通过 Adapter.register 静态注册
Adapter.register('my-platform', MyAdapter)
```

每个适配器可以通过 `addTool()` 注册平台特有工具，标准群管操作通过覆写 `IGroupManagement` 方法自动注册。

**群管理能力自动检测：** 适配器基类声明了 `IGroupManagement` 接口中的可选方法（`kickMember`、`muteMember`、`banMember` 等），子类只需覆写自己平台支持的方法，`start()` 会自动检测哪些方法已实现，生成对应的 Tool 并注册为"群聊管理"Skill。目前所有 9 个 IM 适配器（ICQQ、OneBot11、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书）均已采用此模式：

```typescript
class IcqqAdapter extends Adapter<IcqqEndpoint> {
  // 覆写标准群管方法
  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId)
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`)
    return endpoint.kickMember(Number(sceneId), Number(userId), false)
  }
  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) { /* ... */ }
  async setAdmin(endpointId: string, sceneId: string, userId: string, enable = true) { /* ... */ }
  // ...共覆写 7 个标准方法

  async start() {
    this.registerIcqqPlatformTools()  // 头衔、公告、戳一戳等平台特有工具
    await super.start()               // 自动检测 → 生成标准 Tool → 与平台工具一起注册 Skill
  }
}
```

### MessageDispatcher（消息路由）

三阶段消息处理管线：

```
消息到达 → Guardrail（守卫） → Route（路由） → Handle（处理）
                │                    │                │
           权限/频率检查         命令 or AI？      执行命令 / AI Agent
```

- **Guardrail** — 鉴权、速率限制、黑名单等前置检查
- **Route** — 判断消息是命令还是 AI 对话
- **Handle** — CommandFeature 处理命令；AI 对话由 `@zhin.js/agent` 的 ZhinAgent / AIService 处理（经 Dispatcher 注册）

### AI 与 @zhin.js/agent

Core **不包含** ZhinAgent 实现。IM 侧的 AI 对话、工具收集、执行策略、MCP 客户端与 `ctx.ai` / `ctx.agent` 挂载均在 **`@zhin.js/agent`**（主包 `zhin.js` 会 `initAgentModule()` 并 re-export）。

本包从 `@zhin.js/ai` selective re-export 以下内容，供插件或适配器在不依赖 agent 层时使用：

| 类别 | 示例导出 |
|------|----------|
| Provider | `OpenAIProvider`、`OllamaProvider`、`AnthropicProvider` 等 |
| Agent 原语 | `Agent`、`createAgent`、`ModelRegistry` |
| 会话 / 上下文 | `SessionManager`（遗留）、`ContextRepository`、`ImTranscriptStore`、`ContextManager`、`ConversationMemory` |
| 压缩 / 限流 / 输出 | `compactSession`、`RateLimiter`、`parseOutput`、`CostTracker` |

完整 Agent 能力与配置见 [`@zhin.js/agent`](../agent/README.md) 与 [AI 模块](https://zhin.js.org/advanced/ai)。

## 主要导出

入口为 [`src/index.ts`](./src/index.ts)。摘要如下（非完整列表）：

```typescript
// 插件系统
export { Plugin, usePlugin, getPlugin, definePlugin } from './plugin.js'

// Feature 体系（Cron / Scheduler 来自 @zhin.js/kernel）
export { Feature, Cron, Scheduler } from '@zhin.js/kernel'
export { CommandFeature, ToolFeature, SkillFeature, CronFeature, DatabaseFeature, ... } from './built/*.js'

// 消息路由
export { createMessageDispatcher } from './built/dispatcher.js'

// 适配器与消息
export { Adapter, Message, MessageCommand, Endpoint, segment, ... } from './'

// HTML 出站回退
export { htmlToFallbackText, coerceHtmlSegmentsToText, registerHtmlSegmentFallback } from './built/*.js'

// AI 原语（来自 @zhin.js/ai，非 ZhinAgent）
export {
  OpenAIProvider, OllamaProvider, Agent, createAgent, ModelRegistry,
  SessionManager, ContextManager, ConversationMemory, compactSession, ...
} from '@zhin.js/ai'
```

> ZhinAgent、`initAgentModule`、`AIService`、ExecPolicy、编排 Registry 等请从 **`zhin.js`** 或 **`@zhin.js/agent`** 引入。

## 安装

```bash
pnpm add @zhin.js/core
```

> 通常不需要直接安装此包。使用 `zhin.js` 主入口包即可自动引入。

## 许可证

MIT License
