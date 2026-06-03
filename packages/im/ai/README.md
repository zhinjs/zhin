# @zhin.js/ai

框架无关的 AI 引擎，提供 LLM Provider 抽象、Agent 循环、会话管理、记忆与压缩、成本追踪、性能缓存等能力。

不依赖任何 IM/Bot 概念，可独立用于 Web 后端、CLI 工具、自动化脚本等任意 Node.js 应用。

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
| `OpenAIProvider` | OpenAI 及兼容 API |
| `DeepSeekProvider` | DeepSeek（继承 OpenAI） |
| `MoonshotProvider` | Moonshot / Kimi（继承 OpenAI） |
| `ZhipuProvider` | 智谱 GLM（继承 OpenAI） |
| `AnthropicProvider` | Anthropic Claude |
| `OllamaProvider` | Ollama 本地模型 |

### Agent（Agent 引擎）

无状态的多轮 tool-calling 循环引擎：

```typescript
import { createAgent } from '@zhin.js/ai'
import type { AgentTool } from '@zhin.js/ai'

const weatherTool: AgentTool = {
  name: 'get_weather',
  description: '查询城市天气',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: '城市名' } },
    required: ['city'],
  },
  execute: async ({ city }) => `${city}：晴，25°C`,
}

const agent = createAgent(provider, {
  maxIterations: 5,
  turnTimeout: 60000,
  modelFallbacks: ['gpt-4o-mini'],
  systemPrompt: '你是一个助手',
  tools: [weatherTool],
})

// run(userMessage, contextMessages?, filterOptions?)
const result = await agent.run('今天北京天气怎么样？')
```

`createAgent(provider, config)` 的 `config` 为 `Omit<AgentConfig, 'provider'>`；`agent.run()` 接受用户字符串与可选历史 `ChatMessage[]`。Agent 支持自动模型降级：主模型失败时依次尝试 `modelFallbacks`。

### ModelRegistry（模型注册表）

自动发现、缓存和智能选择 Provider 上的可用模型：

```typescript
import { ModelRegistry } from '@zhin.js/ai'

const registry = new ModelRegistry() // 可选 dataDir，默认 data/model-registry-cache.json

// 自动发现可用模型
const models = await registry.discover(provider)

// 智能选择（按 Tier 评分 0-100）
const best = registry.selectModel(provider.name, 'chat')
const vision = registry.selectModel(provider.name, 'vision')

// 获取候选列表（用于降级）
const candidates = registry.selectModels(provider.name, 'chat', 5)
```

特性：
- 调用 Provider 的 `listModels()` 自动发现模型
- Ollama: `/api/show` 获取详细参数量和量化信息
- OpenAI 兼容 API: 启发式推断（支持 `prefix/model-name` 中转格式）
- Tier 评分（0-100）实现智能排序（claude-opus 96, gpt-4o 88, deepseek-r1 85...）
- 本地缓存 `data/model-registry-cache.json` 避免重复 API 调用

### SessionManager（会话管理）

管理对话会话的创建、检索和过期：

```typescript
import { createMemorySessionManager, createDatabaseSessionManager } from '@zhin.js/ai'

// 内存模式
const sessionManager = createMemorySessionManager({
  maxHistory: 50,
  expireMs: 3600000,
})

// 数据库持久化模式
const dbSessionManager = createDatabaseSessionManager(databaseModel, {
  maxHistory: 50,
  expireMs: 3600000,
})
```

### ContextManager（上下文管理）

管理消息记录和上下文摘要：

```typescript
import {
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from '@zhin.js/ai'

// 需先通过 DatabaseFeature 注册 CHAT_MESSAGE_MODEL / CONTEXT_SUMMARY_MODEL
const contextManager = createContextManager(messageModel, summaryModel, {
  enabled: true,
  maxRecentMessages: 100,
  summaryThreshold: 50,
  keepAfterSummary: 10,
  maxContextTokens: 4000,
})
```

### ConversationMemory（对话记忆）

双层记忆系统：短期滑动窗口 + 长期链式摘要。

```typescript
import { ConversationMemory } from '@zhin.js/ai'

const memory = new ConversationMemory({
  slidingWindowSize: 5,
  minTopicRounds: 3,
  topicChangeThreshold: 0.5,
})
memory.setProvider(provider) // 摘要生成需要 Provider
```

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
| `AgentConfig` | `createAgent`：模型、`modelFallbacks`、`maxIterations`、`turnTimeout`、工具列表等 |
| `SessionConfig` | 会话 `maxHistory`、`expireMs` |
| `ContextConfig` | `ContextManager` 总结阈值与 token 预算 |
| `ConversationMemoryConfig` | 话题切换与短期窗口 |
| `AIConfig` | 应用级 YAML `ai:` 块的 TypeScript 形状（Provider、sessions、context、trigger、`agent.modelHarness` 等） |

完整 AI 模块文档：[zhin.js.org/advanced/ai](https://zhin.js.org/advanced/ai)

## 主要导出

| 导出 | 说明 |
|------|------|
| `OpenAIProvider` / `AnthropicProvider` / `OllamaProvider` | LLM 提供者 |
| `Agent` / `createAgent` | Agent 引擎 |
| `ModelRegistry` | 模型发现与 Tier 选择 |
| `SessionManager` | 会话管理 |
| `ContextManager` / `createContextManager` | 上下文管理 |
| `ConversationMemory` | 对话记忆 |
| `compactSession` / `pruneHistoryForContext` / `microCompactMessages` | 上下文压缩 |
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

> 也可通过 `zhin.js` 或 `@zhin.js/agent` 间接引入。

## 许可证

MIT License
