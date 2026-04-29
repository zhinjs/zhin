// Core exports
export * from './feature.js'
export * from './bot.js'
export * from './plugin.js'
export * from './command.js'
export * from './component.js'
export * from './adapter.js'
export * from './message.js'
export * from './notice.js'
export * from './request.js'
export * from './prompt.js'
// Models
export * from './models/system-log.js'
export * from './models/user.js'
// Built-in Contexts
export * from './built/config.js'
export * from './built/command.js'
export * from './built/cron.js'
export * from './built/permission.js'
export * from './built/adapter-process.js'
export * from './built/component.js'
export * from './built/database.js'
export * from './built/message-filter.js'
// Tool/Skill/AgentPreset Features (backward-compat; canonical source is @zhin.js/agent)
export * from './built/tool.js'
export * from './built/skill.js'
export * from './built/agent-preset.js'
export * from './built/common-adapter-tools.js'
// AI Trigger Service (纯工具，无副作用)
export * from './built/ai-trigger.js'
// MessageDispatcher (消息调度器)
export * from './built/dispatcher.js'
// Schema 注册表 (插件配置声明)
export * from './built/schema-feature.js'
// Login assist (producer-consumer for QR / SMS / slider etc.)
export * from './built/login-assist.js'
// AI 模块 — selective re-export from @zhin.js/ai to avoid conflicts with core types
export {
  BaseProvider, OpenAIProvider, DeepSeekProvider, MoonshotProvider,
  ZhipuProvider, AnthropicProvider, OllamaProvider,
  Agent, createAgent, formatToolTitle,
  filterTools, tokenize,
  SessionManager, MemorySessionManager, DatabaseSessionManager,
  createSessionManager, createMemorySessionManager, createDatabaseSessionManager,
  AI_SESSION_MODEL,
  ContextManager, createContextManager, CHAT_MESSAGE_MODEL, CONTEXT_SUMMARY_MODEL,
  ConversationMemory, AI_MESSAGE_MODEL, AI_SUMMARY_MODEL,
  estimateTokens, estimateMessagesTokens,
  DEFAULT_CONTEXT_TOKENS,
  microCompactMessages,
  CostTracker,
  CachedToolFilter, computeToolSetHash,
  FileStateCache,
  RateLimiter,
  detectTone,
  parseOutput, renderToPlainText, renderToSatori,
  MemoryStorageBackend, DatabaseStorageBackend, createSwappableBackend,
  ModelRegistry, extractModelRoot, computeTierScore,
} from '@zhin.js/ai'
export type {
  AIConfig, AIProvider, ProviderConfig, ProviderCapabilities,
  ChatMessage, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk,
  ContentPart, ToolCall, MessageRole,
  AgentTool, AgentConfig, AgentResult,
  ToolFilterOptions, Usage, SessionConfig, Session, JsonSchema,
  AgentState, AgentEvents,
  ContextConfig, MessageRecord as AIMessageRecord,
  ConversationMemoryConfig,
  ContextWindowSource, ContextWindowInfo, ContextWindowGuardResult, PruneResult,
  MicroCompactOptions, MicroCompactResult,
  ModelUsage, ModelPricing, CostSnapshot,
  RateLimitConfig, RateLimitResult,
  Tone,
  OutputElement, TextElement, ImageElement, AudioElement, VideoElement,
  CardElement, FileElement,
  StorageBackend, DbModel as AIDbModel,
  AIModelInfo, ModelTask,
} from '@zhin.js/ai'

export * from './types.js'
export * from './utils.js'
export * from './errors.js'  // 导出错误处理系统
export * from './cron.js'
export * from './scheduler/index.js'
export * from '@zhin.js/database'
export * from '@zhin.js/logger'
// 只导出 Schema 类，避免与 utils.js 的 isEmpty 冲突
export { Schema } from '@zhin.js/schema'
// Re-export PluginLike from kernel (generic plugin interface)
export type { PluginLike } from '@zhin.js/kernel'