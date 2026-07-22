# @zhin.js/ai

框架无关的 AI 引擎，提供 LLM Provider 抽象、Agent 循环、记忆与压缩、成本追踪、性能缓存等能力。

不依赖任何 IM/Endpoint 概念，可独立用于 Web 后端、CLI 工具、自动化脚本等任意 Node.js 应用。

## 核心模块

### Provider（LLM 提供者）

统一的 LLM 提供者接口，内置多种主流模型支持：

```typescript
import { OpenAIProvider, OllamaProvider, AnthropicProvider } from '@zhin.js/ai'

const provider = new OpenAIProvider({
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',
  contextWindow: 128000,
  // models 可省略 — ModelRegistry 自动发现
  capabilities: { vision: true, streaming: true, toolCalling: true },
})

const response = await provider.chat({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '你好' }],
})
```

内置 Provider：

| Provider | 说明 |
|----------|------|
| `OpenAIProvider` | OpenAI 及兼容 API；`generateImage()` GPT Image（默认 `gpt-image-2`） |
| `DeepSeekProvider` | DeepSeek（继承 OpenAI） |
| `MoonshotProvider` | Moonshot / Kimi（继承 OpenAI） |
| `ZhipuProvider` | 智谱 GLM（继承 OpenAI）；`generateImage()` 文生图（默认 `cogview-3-flash`） |
| `GoogleProvider` | Gemini Nano Banana 文生图（`generateContent` + IMAGE；默认 `gemini-2.5-flash-image`）；不支持 chat |
| `CloudflareProvider` | Workers AI 聊天 + `generateImage()`（默认 `@cf/black-forest-labs/flux-1-schnell`） |
| `AnthropicProvider` | Anthropic Claude |
| `OllamaProvider` | Ollama 本地模型 |

文生图（Provider 方法，由 `@zhin.js/agent` 的 `generate_image` 工具调用）：

```typescript
import { ZhipuProvider, hasGenerateImage } from '@zhin.js/ai'

const zhipu = new ZhipuProvider({ apiKey: '...' })
if (hasGenerateImage(zhipu)) {
  const { base64, mimeType, model } = await zhipu.generateImage({
    prompt: 'a cat on a windowsill',
    watermarkEnabled: false, // 智谱：须在开放平台签署去水印声明后生效
  })
}
```

`zhin.config.yml` 可在 `ai.imageGeneration` 或 `ai.providers.<alias>.imageGeneration` 配置默认项（`watermarkEnabled`、`defaultModel`、`defaultSize`；Cloudflare 另有 `numSteps`）。

### agentLoop（推荐 — LLM 统一入口）

IM 栈与 `@zhin.js/agent` 的生产路径均经 **`agentLoop`**（ADR 0009）。Provider 须配置 **`sdk`**（见 [ADR 0018](../../../docs/adr/0018-ai-sdk-transport-layer.md)），由 `registerLlmApiFromProviders` 注册 AI SDK transport 到 ApiRegistry（`api: 'ai-sdk'`）。

```typescript
import {
  agentLoop,
  agentContextFrom,
  createUserMessage,
  agentToolsToLlmTools,
  getLlmTransportModel,
  registerLlmApiFromProviders,
  sdkEntryFromProvider,
} from '@zhin.js/ai'

registerLlmApiFromProviders(
  [sdkEntryFromProvider(provider)],
  (alias) => provider.models,
)

const model = getLlmTransportModel(provider.name, 'gpt-4o')
const context = agentContextFrom({
  systemPrompt: '你是一个助手',
  messages: [],
  tools: agentToolsToLlmTools([weatherTool]),
})

for await (const event of agentLoop(
  [createUserMessage('今天北京天气怎么样？')],
  context,
  { model, maxIterations: 5, executeTool: async (tc) => { /* ... */ } },
)) {
  if (event.type === 'agent_end') console.log(event.messages)
}
```

业务插件通常不直接调用 `agentLoop`，而是通过 **`ZhinAgent`**、**`AIService.runAgent`** 或 **`@zhin.js/agent` 的 turn runner**。

### Agent（已移除 — 改用 `agentLoop`）

::: danger 已删除
`createAgent` / `Agent` 类已从 `@zhin.js/ai` 中删除。如需直接调用 LLM，请使用 **`agentLoop`** 或 **`@zhin.js/agent`** 的封装。参见上方的 **`agentLoop`（推荐）** 章节。
:::

### ModelRegistry 与 ApiRegistry（模型发现 + agentLoop 白名单）

**两层协作**（IM 主路径由 `@zhin.js/agent` 的 `AIService` / `createZhinAgent` 接线）：

| 层 | 职责 |
|----|------|
| **ModelRegistry** | 启动时 `discover()` → `provider.listModels()`；缓存到 `data/model-registry-cache.json`；Tier 评分与 `selectModel` |
| **ApiRegistry**（`getLlmTransportModel`） | `agentLoop` 校验模型是否可用；**未配置 yaml `models` 时**白名单来自发现后的 `provider.models`，而非 Provider 类内硬编码默认列表 |

```typescript
import { ModelRegistry } from '@zhin.js/ai'

const registry = new ModelRegistry() // 默认 data/model-registry-cache.json

registry.loadCache() // 二次启动可先灌入 provider.models

const models = await registry.discover(provider) // 写回 provider.models 并 saveCache

const best = registry.selectModel(provider.name, 'chat')
const candidates = registry.selectModels(provider.name, 'chat', 5)
```

发现来源：

- **Ollama**：`/api/tags`；详情 `/api/show`（参数量、量化）
- **OpenAI 兼容**（含中转/聚合）：`GET {baseUrl}/models`；名称启发式推断能力
- **显式 yaml `models`**：跳过自动发现，直接作为 ApiRegistry 白名单（如 Cloudflare Workers AI）

冷启动：发现完成前若注册表白名单为空，`getLlmTransportModel` 不拦截；发现完成后按 `provider.models` 校验。

### 持久化与上下文（ADR 0009）

IM 主路径数据模型（见 [docs/advanced/ai.md](../../docs/advanced/ai.md)）：

| 模块 | 表 / 存储 | 用途 |
|------|-----------|------|
| `ImTranscriptStore` | `im_transcripts` | 入站/出站 IM 扁平静态行；`chat_history` 工具按需查询 |
| `ContextRepository` | `agent_messages` | epoch 内 LLM `AgentMessage[]`（含 tool 轮） |
| `AgentSessionStore` | `agent_sessions` | `session_key` → 活跃 `session_id`；`/reset` 归档 |

```typescript
import {
  createMemoryContextRepository,
  MemoryImTranscriptStore,
  type ContextRepository,
  type ImTranscriptStore,
} from '@zhin.js/ai'

const { repository, sessionStore } = createMemoryContextRepository({ tailMessageLimit: 200 })
const transcripts = new MemoryImTranscriptStore()
```

### ContextManager / ConversationMemory（辅助）

`ContextManager`（`context_summaries`）与 `ConversationMemory`（话题检测 + 链式摘要）仍可用于场景级摘要或实验路径；**ZhinAgent 生产回合的历史以 `ContextRepository` 为准**，不再双写旧 `chat_messages` / `ai_messages` 表。

### Compaction（上下文压缩）

管理上下文窗口，防止 token 超限：

```typescript
import {
  estimateTokens,
  evaluateContextWindowGuard,
  pruneHistoryForContext,
  compactSession,
} from '@zhin.js/ai'

const guard = evaluateContextWindowGuard({
  messages: history,
  maxContextTokens: 128000,
  maxHistoryShare: 0.5,
})
// guard.status: 'ok' | 'warning' | 'critical'
```

### Output（输出解析）

将 AI 文本回复解析为结构化元素：

```typescript
import { parseOutput, renderToPlainText } from '@zhin.js/ai'

const elements = parseOutput(aiResponse)
const text = renderToPlainText(elements)
```

支持的元素类型：`TextElement`、`ImageElement`、`AudioElement`、`VideoElement`、`CardElement`、`FileElement`。

#### 结构化输出（outputSchema）

`StreamOptions.outputSchema`（JSON Schema 对象）会在 LLM 调用时转为 AI SDK `Output.object` 约束，模型文本回复即为该 schema 的 JSON；tool-call 中间步自动回退原文本。zhin 出站消息段的 schema SSOT 在 `@zhin.js/core` 的 `segment-contract/json-schema.ts`（`aiOutboundJsonSchema`）；agent 侧经 `ai.agent.outputSchema`（`true`/`'segments'`/自定义 schema）开启，见 `docs/advanced/ai.md`「结构化输出」。

### RateLimiter（速率限制）

```typescript
import { RateLimiter } from '@zhin.js/ai'

const limiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 60000,
})

const result = limiter.check('user-123')
if (!result.allowed) {
  console.log(`请等待 ${result.retryAfterMs}ms`)
}
```

### Storage（存储抽象）

统一存储后端，支持内存和数据库模式，可在运行时热切换：

```typescript
import { MemoryStorageBackend, createSwappableBackend } from '@zhin.js/ai'

const backend = createSwappableBackend(new MemoryStorageBackend())

// 运行时切换到数据库
backend.swap(new DatabaseStorageBackend(model))
```

### CostTracker（成本追踪）

追踪每次 LLM 调用的 token 用量和估算成本，支持按模型/Provider 统计：

```typescript
import { CostTracker } from '@zhin.js/ai'

const tracker = new CostTracker()
tracker.record({ model: 'qwen3:14b', inputTokens: 1200, outputTokens: 350 })

console.log(tracker.summary())
// { totalCalls: 1, totalInputTokens: 1200, totalOutputTokens: 350, estimatedCost: 0.002 }
```

### FileStateCache（文件状态缓存）

缓存文件 mtime 和内容摘要，避免工具多次读取同一文件时重复访问磁盘：

```typescript
import { FileStateCache } from '@zhin.js/ai'

const cache = new FileStateCache({ maxEntries: 500, ttlMs: 30000 })
const content = await cache.getOrRead('/path/to/file.ts')
```

### microCompactMessages（微压缩）

轻量级上下文压缩，在完整 LLM 摘要之前清理旧工具结果，降低 token 消耗：

```typescript
import { microCompactMessages } from '@zhin.js/ai'

const { messages: compacted, savedTokens } = microCompactMessages(messages, {
  keepRecentToolResults: 6,
})
```

### CachedToolFilter（工具过滤缓存）

缓存 `filterTools` 结果，避免相同用户消息与工具集重复评分：

```typescript
import { CachedToolFilter } from '@zhin.js/ai'

const cache = new CachedToolFilter()
const tools = cache.filter('天气查询', allTools, { maxTools: 10 })
```

## 配置类型

框架无关的配置形状定义在 [`src/types.ts`](./src/types.ts)：

| 类型 | 用途 |
|------|------|
| `ProviderConfig` / `OllamaProviderConfig` | 各 LLM Provider 连接与能力 |
| `AgentLoopConfig` | `agentLoop`：模型、工具列表、超时、回调等（替代已删除的 `createAgent`） |
| `SessionConfig` | 会话 `maxHistory`、`expireMs` |
| `ContextConfig` | `ContextManager` 总结阈值与 token 预算 |
| `ConversationMemoryConfig` | 话题切换与短期窗口 |
| `AIConfig` | 应用级 YAML `ai:` 块的 TypeScript 形状（Provider、sessions、context、trigger、`agent.modelHarness` 等） |

完整 AI 模块文档：[zhin.js.org/advanced/ai](https://zhin.js.org/advanced/ai)

## 主要导出

| 导出 | 说明 |
|------|------|
| `agentLoop` / `agentContextFrom` / `getLlmTransportModel` | LLM 统一回合引擎（推荐） |
| `agentToolsToLlmTools` | Plugin/AgentTool → LlmTool 桥接（agentLoop transport） |
| `registerLlmApiFromProviders` / `ModelRegistry` | ApiRegistry 注册 + `/v1/models` 发现与白名单 |
| `ContextRepository` / `AgentSessionStore` / `ImTranscriptStore` | ADR 0009 持久化原语 |
| `OpenAIProvider` / `AnthropicProvider` / `OllamaProvider` | LLM 提供者 |
| `ContextManager` / `ConversationMemory` | 场景摘要 / 话题记忆（辅助） |
| `compactSession` / `pruneHistoryForContext` / `microCompactMessages` | 上下文压缩库 API；IM 生产路径经 `@zhin.js/agent` 的 `transformContext`（ADR 0010） |
| `CostTracker` | Token 用量与成本追踪 |
| `FileStateCache` | 文件状态缓存 |
| `CachedToolFilter` | 工具过滤缓存 |
| `parseOutput` / `renderToPlainText` | 输出解析 |
| `RateLimiter` | 速率限制 |
| `detectTone` | 情绪检测 |
| `MemoryStorageBackend` / `createSwappableBackend` | 存储抽象 |

## 安装

```bash
pnpm add @zhin.js/ai
```

> 在 Zhin 项目中通常经 `@zhin.js/agent` 依赖引入；也可 `import … from 'zhin.js/ai'`（须已安装 `@zhin.js/ai`，一般由 agent 带入）。

## 许可证

MIT License
