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
} from './compaction.js';
export type {
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
} from './compaction.js';

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
