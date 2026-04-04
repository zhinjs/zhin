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
import { Agent, createAgent } from '@zhin.js/ai'

const agent = createAgent(provider, logger, {
  maxIterations: 5,
  timeout: 60000,
  modelFallbacks: ['gpt-4o-mini'],  // 可选：降级模型列表
})

const result = await agent.run({
  messages: [
    { role: 'system', content: '你是一个助手' },
    { role: 'user', content: '今天天气怎么样？' },
  ],
  tools: [weatherTool],
})
```

Agent 支持自动模型降级：当主模型请求失败时，依次尝试 `modelFallbacks` 中的模型。

### ModelRegistry（模型注册表）

自动发现、缓存和智能选择 Provider 上的可用模型：

```typescript
import { ModelRegistry } from '@zhin.js/ai'

const registry = new ModelRegistry(logger)

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
import { createContextManager } from '@zhin.js/ai'

const contextManager = createContextManager(logger, {
  enabled: true,
  maxMessagesBeforeSummary: 100,
  summaryRetentionDays: 30,
})
```

### ConversationMemory（对话记忆）

双层记忆系统：短期滑动窗口 + 长期链式摘要。

```typescript
import { ConversationMemory } from '@zhin.js/ai'

const memory = new ConversationMemory(provider, logger, {
  shortTermWindow: 5,
  minTopicRounds: 3,
  topicChangeThreshold: 0.5,
})
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

### MicroCompact（微压缩）

轻量级上下文压缩引擎，在完整 LLM 摘要之前先做增量裁剪，降低 token 消耗：

```typescript
import { MicroCompact } from '@zhin.js/ai'

const compactor = new MicroCompact({ maxTokens: 2000 })
const compacted = compactor.compact(messages)
```

### ToolSearchCache（工具搜索缓存）

缓存工具关键词匹配结果，避免每轮对话重复扫描全部工具：

```typescript
import { ToolSearchCache } from '@zhin.js/ai'

const cache = new ToolSearchCache({ maxSize: 100, ttlMs: 60000 })
const tools = cache.getOrSearch('天气查询', () => searchTools('天气查询'))
```

## 主要导出

| 导出 | 说明 |
|------|------|
| `OpenAIProvider` / `AnthropicProvider` / `OllamaProvider` | LLM 提供者 |
| `Agent` / `createAgent` | Agent 引擎 |
| `SessionManager` | 会话管理 |
| `ContextManager` | 上下文管理 |
| `ConversationMemory` | 对话记忆 |
| `compactSession` / `pruneHistoryForContext` | 上下文压缩 |
| `CostTracker` | Token 用量与成本追踪 |
| `FileStateCache` | 文件状态缓存 |
| `MicroCompact` | 微压缩引擎 |
| `ToolSearchCache` | 工具搜索缓存 |
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
