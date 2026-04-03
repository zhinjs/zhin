/**
 * @zhin.js/ai — Framework-agnostic AI engine
 *
 * Provides AI provider abstractions, agent loop, session management,
 * memory & compaction utilities with ZERO dependency on IM/Bot concepts.
 * Can be used in any Node.js application.
 */

// ── Core AI Types ──
export type {
  AIConfig,
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  OllamaProviderConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ContentPart,
  ToolCall,
  ToolDefinition,
  ToolDefinition as ChatToolDefinition,
  MessageRole,
  AgentTool,
  AgentConfig,
  AgentResult,
  ToolFilterOptions,
  Usage,
  SessionConfig,
  Session,
  JsonSchema,
  ToolContext,
} from './types.js';

// ── Providers ──
export {
  BaseProvider,
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from './providers/index.js';
export type {
  OpenAIConfig,
  AnthropicConfig,
  OllamaConfig,
} from './providers/index.js';

// ── Agent Engine ──
export { Agent, createAgent, formatToolTitle } from './agent.js';
export type { AgentState, AgentEvents } from './agent.js';
export { filterTools, tokenize } from './tool-filter.js';

// ── Session Management ──
export {
  SessionManager,
  MemorySessionManager,
  DatabaseSessionManager,
  createSessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
} from './session.js';
export type { ISessionManager } from './session.js';

// ── Context & Compaction ──
export {
  DEFAULT_CONTEXT_TOKENS,
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  BASE_CHUNK_RATIO,
  MIN_CHUNK_RATIO,
  SAFETY_MARGIN,
  estimateTokens,
  estimateMessagesTokens,
  splitMessagesByTokenShare,
  chunkMessagesByMaxTokens,
  computeAdaptiveChunkRatio,
  resolveContextWindowTokens,
  evaluateContextWindowGuard,
  summarizeWithFallback,
  summarizeInStages,
  pruneHistoryForContext,
  compactSession,
  // ── 三级压缩管线 ──
  AUTOCOMPACT_BUFFER_TOKENS,
  POST_COMPACT_TOKEN_BUDGET,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  createAutoCompactTracking,
  shouldAutoCompact,
  autoCompactIfNeeded,
} from './compaction.js';
export type {
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
  AutoCompactTrackingState,
  AutoCompactResult,
} from './compaction.js';

// ── Micro-Compact ──
export {
  microCompactMessages,
  COMPACTABLE_TOOLS,
  CLEARED_MESSAGE,
  DEFAULT_KEEP_RECENT_TOOL_RESULTS,
} from './micro-compact.js';
export type {
  MicroCompactOptions,
  MicroCompactResult,
} from './micro-compact.js';

// ── Cost Tracker ──
export { CostTracker } from './cost-tracker.js';
export type {
  ModelUsage,
  ModelPricing,
  CostSnapshot,
  CostUpdateEvent,
} from './cost-tracker.js';

// ── Tool Search Cache ──
export { CachedToolFilter, computeToolSetHash } from './tool-search-cache.js';

// ── File State Cache ──
export { FileStateCache, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_SIZE_BYTES } from './file-state-cache.js';
export type { FileState } from './file-state-cache.js';

// ── Context Manager ──
export {
  ContextManager,
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from './context-manager.js';
export type {
  MessageRecord,
  SummaryRecord,
  ContextConfig,
  SceneContext,
} from './context-manager.js';

// ── Conversation Memory ──
export {
  ConversationMemory,
  AI_MESSAGE_MODEL,
  AI_SUMMARY_MODEL,
} from './conversation-memory.js';
export type { ConversationMemoryConfig } from './conversation-memory.js';

// ── Output Parsing ──
export { parseOutput, renderToPlainText, renderToSatori } from './output.js';
export type {
  TextElement,
  ImageElement,
  AudioElement,
  VideoElement,
  CardField,
  CardButton,
  CardElement,
  FileElement,
  OutputElement,
} from './output.js';

// ── Rate Limiter ──
export { RateLimiter } from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';

// ── Tone Detector ──
export { detectTone } from './tone-detector.js';
export type { Tone } from './tone-detector.js';

// ── Storage Abstraction ──
export {
  MemoryStorageBackend,
  DatabaseStorageBackend,
  createSwappableBackend,
} from './storage.js';
export type { StorageBackend, DbModel } from './storage.js';
