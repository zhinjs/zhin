# @zhin.js/ai

框架无关的 AI 引擎，提供 LLM Provider 抽象、Agent 循环、记忆与压缩、成本追踪、性能缓存等能力。

不依赖任何 IM/Endpoint 概念，可独立用于 Web 后端、CLI 工具、自动化脚本等任意 Node.js 应用。

## 核心模块

### Provider 与推理

Provider Driver 声明协议和认证能力；Host 统一管理 **Service → Account → Profile**，分别表示部署／产品、真实账号和模型用途。模型能力来自明确目录，SDK 是 Driver 内部实现，不再由业务插件自行拼接 Key 和 SDK 名称。

插件使用当前操作已授权的 `InferenceClient`（Zhin 中由 `@zhin.js/ai-provider` 的 `aiInferenceClientToken` 提供）：

```typescript
import { assistantText } from '@zhin.js/ai'
import type { InferenceClient } from '@zhin.js/ai/provider'

async function reply(client: InferenceClient) {
  const response = await client.generate({
    request: {
      context: {
        systemPrompt: '你是一个助手',
        messages: [{ role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: '你好' }] }],
      },
    },
  })
  return assistantText(response)
}
```

`client.list({ kind: 'language' })` 返回当前主体可用的 Profile 引用；需要显式选择时将其 `reference` 传给 `generate`。`stream` 返回有明确生命周期的单消费者 run，消费结束、提前 break 或关闭时释放；Command / Tool 执行上下文负责关闭其 client，不能让它逃逸到下一次操作。

文生图使用同一个已授权 client 的独立模型用途：

```typescript
async function makeImage(client: InferenceClient) {
  return client.generateImage({ request: { prompt: 'a cat on a windowsill' } })
}
```

默认 image Profile 和生成参数在 Host 管理界面配置。Driver 不支持的显式参数明确报错，不静默跨模型降级。API Key、OAuth token 和 client secret 不进入 Service / Profile，也不进入模型上下文。

内置产品声明从 `@zhin.js/ai/providers` 导入；自定义 Driver 统一通过 `@zhin.js/ai/provider` 的 `defineProvider` 编写。插件在 setup 一次调用 `provideAiProviders(resources, definitions)` 注册，类型只增补唯一的 `@zhin.js/ai/provider` 接口。完整合同、账户配置和升级见 [Provider 文档](../../../docs/ai/providers.md) 与 [升级说明](../../../docs/ai/provider-upgrade.md)。

### 订阅集成与支持信息

Claude 订阅与 Antigravity：实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担。Codex：未经 OpenAI 对第三方客户端的明确授权。OpenCode Go 与 OpenCode Zen 分别使用各产品的 API Key；套餐、模型和适用场景应按各自产品条款核对，不能套用 Free 产品的条件。Anthropic API Key 与 Claude 订阅、Gemini API Key 与 Antigravity 是独立服务及认证身份。

Driver 可通过 `support?: ProviderSupportMetadata` 声明 `status: 'standard' | 'experimental'` 和可选纯文本 `notice`。Host 按已持有声明的 owner、id、contractVersion 精确投影到管理视图；缺少声明不推断为常规或官方支持。Console 只为实验集成显示短标识，必要提示放在选中详情或登录流程。支持信息不决定账号就绪、权限、注册或请求行为，也不进入模型图和请求上下文。

### agentLoop（回合引擎）

`agentLoop` 继续负责唯一的工具执行循环。它消费一个已绑定模型的 `LlmCompletionPort` 与模型元数据，既不读取 Host 凭据，也不重新解析 Provider 目录。Zhin 主回合、子任务与定时任务通过当前操作的 ModelExecutionScope 提供这两项。

```typescript
import { agentLoop, agentContextFrom, createUserMessage } from '@zhin.js/ai'
import type { LlmCompletionPort, Model } from '@zhin.js/ai'

async function runTurn(transport: LlmCompletionPort, model: Model) {
  const context = agentContextFrom({ systemPrompt: '你是一个助手', messages: [], tools: [] })
  for await (const event of agentLoop(
    createUserMessage('你好'), context, { model, transport, maxIterations: 5 },
  )) {
    if (event.type === 'agent_end') console.log(event.messages)
  }
}
```

模型目录刷新是显式管理操作，只产生 ID / label 观测；它不自动启用模型，不根据名称推断输入、工具或思考能力，也不在页面加载或启动时隐式请求供应商。

### 持久化与上下文（ADR 0009）

Agent 会话数据模型（IM conversation facts 由 `@zhin.js/im-contract` 的 `ConversationEventStore` 拥有）：

| 模块 | 表 / 存储 | 用途 |
|------|-----------|------|
| `ContextRepository` | `agent_messages` | epoch 内 LLM `AgentMessage[]`（含 tool 轮） |
| `AgentSessionStore` | `agent_sessions` | origin-neutral `session_key` → 活跃 `session_id`；`/reset` 归档；不保存 IM platform / endpoint / scene |

共享 group/channel session 的 `UserMessage.actor` 是参与者身份的唯一权威，保存稳定
`subjectId`、显示名与角色；`agent_messages.extra` 只保存引用等展示上下文。LLM 边界从 actor
渲染参与者标签，Compaction transcript 也直接读取 actor，并要求摘要保留决定、约束、TODO、
分歧及 authority 来源的归属。

数据库返回空集合才表示 Not Found；查询或写入异常统一抛出 `PersistenceUnavailableError`。Session/Context 调用方必须 fail closed，禁止把存储故障降级为空历史或新 epoch。

```typescript
import {
  createMemoryContextRepository,
  type ContextRepository,
} from '@zhin.js/ai'

const { repository, sessionStore } = createMemoryContextRepository({ tailMessageLimit: 200 })
```

### ContextManager（辅助）

`ContextManager`（`context_summaries`）仍可用于独立的场景级摘要实验；**ZhinAgent 生产回合的历史只以 `ContextRepository` 为准**，不再构造第二套话题记忆、定时器或 `ai_messages` 表。

### Compaction（上下文压缩）

管理上下文窗口，防止 token 超限：

Agent 历史摘要保留工具调用的参数、调用关联和结果状态，不包含私有推理或供应商签名。
`agentLoop` 的溢出恢复只在修复、投影后的消息 token 估算量减少时重试；
恢复失败保留原始溢出错误，取消后不再重试。估算量不等于供应商实际计费 token。

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

`StreamOptions.outputSchema`（JSON Schema 对象）会在 LLM 调用时转为 AI SDK `Output.object` 约束，模型文本回复即为该 schema 的 JSON；tool-call 中间步自动回退原文本。zhin 出站消息段的 schema SSOT 在 `@zhin.js/core` 的 `segment-contract/json-schema.ts`（`aiOutboundJsonSchema`）；Agent 的 IM 会话默认使用 `ai.agent.outputSchema: segments`，见[结构化回复](../../../docs/ai/structured-replies.md)。隔离/非 IM 调用不继承 IM 预设，自定义 Schema 仍按调用方契约处理。

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

Provider 领域契约从 `@zhin.js/ai/provider` 导入；纯引擎配置保留在根入口。IM 启动策略由 `@zhin.js/agent` 定义：

| 类型 | 用途 |
|------|------|
| `ProviderService` / `ProviderAccount` / `ModelProfile` | 服务、认证主体与选定的模型参数；能力由显式 `ModelDefinition` 声明 |
| `InferenceClient` | 当前 operation 授权后的统一 generate / stream / evaluate / generateImage 消费端口 |
| `AgentLoopConfig` | `agentLoop`：模型、工具列表、超时、回调等（替代已删除的 `createAgent`） |
| `SessionConfig` | 会话 `maxHistory`、`expireMs` |
| `ContextConfig` | `ContextManager` 总结阈值与 token 预算 |
| `AIPlan` | 声明服务、账号、Profiles 和用途选择；不包含 Host 凭据材料 |

完整 AI 模块文档：[zhin.js.org/advanced/ai](https://zhin.js.org/advanced/ai)

## 主要导出

| 导出 | 说明 |
|------|------|
| `agentLoop` / `agentContextFrom` / `LlmCompletionPort` | 统一回合引擎与已绑定模型的传输合同 |
| `agentToolsToLlmTools` | Plugin/AgentTool → LlmTool 桥接（agentLoop transport） |
| `@zhin.js/ai/provider` | Provider Driver、Service / Account / Profile、InferenceClient 和唯一类型注册入口 |
| `ContextRepository` / `AgentSessionStore` | Agent 会话持久化原语 |
| `@zhin.js/ai/providers` | 内置产品 Driver 声明；原生 SDK 按需安装 |
| `TextCompletionPort` | 压缩模块接收的已绑定纯文字回调；不负责账号或模型选择 |
| `ContextManager` | 场景摘要实验（辅助，不接入 ZhinAgent 生产回合） |
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

通用 SDK 的有效输出预算仍按显式请求、Profile、已声明的 native model 上限、既有 `8192` 依次解析。未填写 Profile 上限时不把默认值物化存入配置，因此原位切换 native model 后仍动态采用其声明值。Codex 的协议不支持这个字段；其 Profile schema 和实际请求均不添加该 cap。框架摘要、审批、旁听取消的是各自的隐式覆盖，本次没有全局取消预算默认。

The AI SDK peer minimum is `ai ^7.0.35`: `timeout.firstChunkMs` is absent from 7.0.34 and earlier published declarations. The scaffold derives this range from the package manifest. Other Provider SDK minimums are unchanged; current synthetic tests do not claim every version in each declared range was executed.
