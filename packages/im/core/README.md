# @zhin.js/core

## Plugin Runtime 子路径

新的 owner-aware IM 能力已经并入 Core，作为 Plugin Runtime 的正式领域接口：

- `@zhin.js/core/runtime`

`@zhin.js/adapter`、`@zhin.js/command`、`@zhin.js/component` 与
`@zhin.js/middleware` 提供纯 definition、约定发现 provider 和 generation projection；
Core Runtime 只消费它们发布的 snapshot。
旧根入口的 `addCommand`、`addComponent`、`addMiddleware` 暂时作为作者兼容接口保留，后续
只向 RuntimeSnapshot 投影，不再维护第二套运行时权威。

Zhin.js **IM/多通道运行时**包：Plugin、Adapter、**Endpoint**、MessageDispatcher 与统一出站链。**AI 编排（ZhinAgent、工具安全、MCP）在 [`@zhin.js/agent`](../agent/README.md)**；本包仅 selective re-export `@zhin.js/ai` 的 Provider / Agent 原语供插件直接使用。

领域词汇见 [CONTEXT.md](./CONTEXT.md)；入站/出站流程见 [消息如何流转](../../docs/essentials/message-flow.md)。

## 核心概念

### Plugin（插件）— Plugin Runtime

唯一启动路径：`zhin runtime start`。`plugin.ts` 必须 default-export `definePlugin()`；能力按约定目录发现。

```typescript
// plugin.ts
import { definePlugin } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'hello-bot',
  metadata: { displayName: 'Hello Bot' },
  setup(context) {
    context.lifecycle.add(() => { /* cleanup */ })
  },
})
```

```typescript
// commands/hello/[name].ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '打招呼',
  params: {
    name: { type: 'string' },
  },
  execute({ params }) {
    return `Hello, ${params.name}!`
  },
})
```

> **已移除**：`usePlugin()` / `getPlugin()` / `bootstrapNode`（`zhin.js/node`）调用即 throw；唯一入口为 `definePlugin` + `zhin runtime start`。`MessageCommand` / `Plugin.addCommand` 仍 deprecated。见 [public-api-surface](../../docs/contributing/public-api-surface.md)。

本包仍提供 IM 运行时契约（Message / Adapter / Endpoint）；创作面在 Feature 包与 `@zhin.js/plugin-runtime`。

### Feature（特性抽象）

约定式 Feature（Command / Middleware / Component / Adapter…）由独立包提供 definition + 约定发现；Core Runtime 消费 snapshot。

经典 `CommandFeature` / `addCommand` 等仍挂在 `Plugin.prototype`，**已 deprecated**，仅兼容 Agent init / game-kit：

```
Feature (抽象基类) — legacy 注册表仍在
├── CommandFeature    — MessageCommand（→ defineCommand）
├── ToolFeature       — AI 工具（→ defineAgentTool）
├── …
```

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

// Markdown 段（QQ 等平台 policy 为 origin 时透传）
return segment.markdown('# Title\n\nBody')
```

出站富媒体段（`qrcode` / `html` / `markdown`）在 **`Adapter.renderSendMessage` 首步** 按各 Adapter 的 **`outboundRichSegmentPolicy`** 统一渲染为 `image` / `text` / `origin`：

| 渲染模式 | 含义 |
|---------|------|
| `image` | 转为 `image` 段（qrcode 生成 PNG；html/markdown 经 `@zhin.js/html-renderer` 动态转图，未安装则降级 text） |
| `text` | 剥离为纯文本段 |
| `origin` | 原样透传，由 Endpoint 解释（如 QQ markdown、process 终端二维码） |

默认策略：`qrcode: image`，`html: text`，`markdown: text`。QQ / KOOK 等适配器 override static policy。

- 安装 **`@zhin.js/html-renderer`** 且 policy 为 `html: 'image'` 时，core 在首步动态 import 并转 PNG。
- policy 为 `html: 'text'` 时等价于 **`coerceHtmlSegmentsToText`** / **`htmlToFallbackText`**。
- 日志预览：`[html-card]`、`[qrcode]`、`[markdown]` + 摘要（前 80 字）。

#### 扩展新 Rich Segment（长期方案）

内置 kind 通过 **`richSegmentRegistry`** 注册；optional 能力通过 **`registerRichSegmentCapabilityLoader`** 注入（与 `@zhin.js/html-renderer` 同模式）。

```typescript
import {
  RichSegment,
  registerRichSegmentKind,
  registerRichSegmentCapabilityLoader,
  RICH_SEGMENT_MODE,
  segment,
} from '@zhin.js/core';

// 1. 内置 capability：speech（@zhin.js/speech）已注册，tts kind 已内置
// 可选：注册 ffmpeg 等
registerRichSegmentCapabilityLoader('media-pipeline', async (opts) => {
  const { createMediaPipeline } = await import('@zhin.js/media-pipeline');
  return createMediaPipeline(opts.getConfig?.());
});

// 2. 使用内置 segment.tts（Adapter policy 决定 audio/text/origin）
// segment.tts({ text: '你好' })
class MyAdapter extends Adapter {
  static override outboundRichSegmentPolicy = {
    tts: 'audio',
    qrcode: 'image', // 其余 kind 用 registry 默认值
  };
}
```

**分工**：Rich Segment 负责「语义段 → 标准 IM 段」；Endpoint `materializeOutboundMedia` 负责「已有 audio/video/file → 平台上传」。

### Adapter（适配器）

适配器将不同聊天平台接入 Zhin.js，统一消息收发接口。

```typescript
// 适配器通过 Adapter.register 静态注册
Adapter.register('my-platform', MyAdapter)
```

每个适配器可以通过 `addTool()` 注册平台特有工具，标准群管操作通过覆写 `ISceneManagement` 方法自动注册。

**群管理能力自动检测：** 适配器基类声明了 `ISceneManagement` 接口中的可选方法（`kickMember`、`muteMember`、`banMember` 等），子类只需覆写自己平台支持的方法，`start()` 会自动检测哪些方法已实现，生成对应的 Tool 并注册为"群聊管理"Skill。目前所有 9 个 IM 适配器（ICQQ、OneBot11、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书）均已采用此模式：

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
| Provider | `AIProvider` 接口、`createSdkProviderAdapter`（AI SDK 传输） |
| Agent 原语 | `ModelRegistry`、`agentLoop` |
| 会话 / 上下文 | `ConversationEventStore`（IM 事实）与 Agent 的 `ContextRepository`（模型会话） |
| 压缩 / 限流 / 输出 | `compactSession`、`RateLimiter`、`parseOutput`、`CostTracker` |

完整 Agent 能力与配置见 [`@zhin.js/agent`](../agent/README.md) 与 [AI 模块](https://zhin.js.org/advanced/ai)。

## 主要导出

入口为 [`src/index.ts`](./src/index.ts)。摘要如下（非完整列表）：

```typescript
// 插件系统
export { Plugin, usePlugin, getPlugin, definePlugin } from './plugin.js'  // usePlugin/getPlugin 为 throwing stub

// Feature 体系（Cron / Scheduler 来自 @zhin.js/kernel）
export { Feature, Cron, Scheduler } from '@zhin.js/kernel'
export { CommandFeature, ToolFeature, SkillFeature, ScheduleFeature, DatabaseFeature, ... } from './built/*.js'

// 消息路由
export { createMessageDispatcher } from './built/dispatcher.js'

// 适配器与消息（MessageCommand 已 deprecated）
export { Adapter, Message, MessageCommand, Endpoint, segment, ... } from './'

// 富媒体出站段
export {
  resolveRichSegments,
  DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
  QrcodeSegment,
  HtmlSegment,
  MarkdownSegment,
} from './built/rich-segments/index.js'
export type { RichSegmentKind, RichRenderMode, OutboundRichSegmentPolicy } from './built/rich-segments/types.js'

// HTML 出站回退（legacy；policy html:'text' 时等价）
export { htmlToFallbackText, coerceHtmlSegmentsToText, registerHtmlSegmentFallback } from './built/*.js'

// AI 原语（来自 @zhin.js/ai，非 ZhinAgent）
export {
  AIProvider, createSdkProviderAdapter, ModelRegistry,
  ContextRepository, ContextManager, ConversationMemory, compactSession, ...
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
