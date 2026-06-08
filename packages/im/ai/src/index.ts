/**
 * @zhin.js/ai — Framework-agnostic AI engine
 *
 * Provides AI provider abstractions, agent loop, session management,
 * memory & compaction utilities with ZERO dependency on IM/Bot concepts.
 * Can be used in any Node.js application.
 */

// ── LLM engine core (ADR 0009) ──
export {
  registerApiProvider,
  registerProviderInstance,
  getApiProvider,
  getProviderConfig,
  getModel,
  stream,
  complete,
  streamSimple,
  completeSimple,
  createAssistantMessageEventStream,
  createContext,
  createUserMessage,
  validateToolCall,
  toolCallFromContentBlock,
  stringParamTool,
  ToolCallValidationError,
  isLlmAgentMessage,
  EMPTY_TOKEN_USAGE,
  DEFAULT_STEERING_MODE,
  DEFAULT_FOLLOW_UP_MODE,
  Type,
  Value,
  agentLoop,
  agentContextFrom,
  assistantText,
  registerLlmApiFromProviders,
  resetLlmApiRegistryForTests,
  setLegacyProviderResolver,
  driverToModelApi,
  convertLegacyTools,
  agentMessagesToOpenAi,
} from './llm/index.js';
export type {
  Context,
  Model,
  ModelApi,
  ProviderInstanceConfig,
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CustomAgentMessage,
  ContentBlock,
  ImageContent,
  LlmTool,
  ParsedToolCall,
  AgentEvent,
  ThinkingLevel,
  ToolExecutionMode,
  QueueMode,
  StreamOptions,
  AssistantStreamEvent,
  AssistantMessageEventStream,
  ApiProviderRegistration,
  AgentLoopConfig,
  AgentContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  TokenUsage,
} from './llm/index.js';

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
  ToolResultTransformInput,
  ToolResultTransform,
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
  CloudflareProvider,
  GoogleProvider,
} from './providers/index.js';
export type {
  OpenAIConfig,
  DeepSeekConfig,
  AnthropicConfig,
  OllamaConfig,
  CloudflareConfig,
  GoogleConfig,
} from './providers/index.js';

export {
  ZHIPU_DEFAULT_IMAGE_MODEL,
  CLOUDFLARE_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  GOOGLE_DEFAULT_IMAGE_MODEL,
  hasGenerateImage,
} from './image-generation.js';
export type {
  ImageGenerateRequest,
  ImageGenerateResult,
  ImageGenerationCapable,
  ImageGenerationDefaults,
} from './image-generation.js';

// ── Agent Engine ──
export { Agent, createAgent, formatToolTitle } from './agent/index.js';
export type { AgentState, AgentEvents } from './agent/index.js';
export {
  sanitizeToolResult,
  compactMediaToolJsonForModel,
  isMediaToolWithBinaryPayload,
  parseMediaToolResultForOutbound,
  MEDIA_TOOL_NAMES_WITH_BINARY_JSON,
  relativizeCwdPaths,
  stripHallucinatedToolCalls,
  isOmittedToolSummary,
  TOOL_RESULT_OMITTED_PLAIN,
} from './agent/tool-result-sanitizer.js';
export type { ToolResultSanitizerOptions } from './agent/tool-result-sanitizer.js';
export { filterTools, tokenize } from './agent/tool-filter.js';
export {
  mergeToolsByName,
  isReservedToolName,
  isBuiltinToolSource,
} from './agent/tool-naming.js';
export type {
  ToolNamePolicyOptions,
  ToolNamePolicyWarning,
  MergeToolsByNameResult,
} from './agent/tool-naming.js';

// ── Session Management ──
export {
  SessionManager,
  MemorySessionManager,
  DatabaseSessionManager,
  createSessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
  resolveIMSessionId,
  resolveIMSceneIdForSession,
  resolveIMSessionIdFromToolContext,
} from './memory/session.js';
export type { ISessionManager, IMSessionScope, ResolveIMSessionIdInput, AISessionStatus } from './memory/session.js';

/** @deprecated ADR 0009 — 使用 ContextRepository + ImTranscriptStore */
export {
  ChatHistoryContext,
} from './memory/chat-history-context.js';
export type {
  ChatHistoryConfig,
  ChatHistoryQuery,
  ChatHistorySearchHit,
  ChatHistoryToolResult,
} from './memory/chat-history-context.js';

export {
  IMSessionStore,
  MemoryIMSessionStore,
  createSessionEpochId,
} from './memory/im-session-store.js';
export type {
  IMSessionRecord,
  CreateIMSessionInput,
  IMSessionStoreConfig,
} from './memory/im-session-store.js';

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
  // ── AgentMessage compaction (ADR 0010) ──
  estimateAgentMessageTokens,
  estimateAgentMessagesTokens,
  findKeepRecentStartIndex,
  microCompactAgentMessages,
  autoCompactAgentMessagesIfNeeded,
  compactAgentMessages,
  createAgentCompactionState,
  isContextOverflowError,
  summaryAsAgentUserMessage,
  shouldAutoCompactAgentMessages,
} from './compaction/index.js';
export type {
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
  AutoCompactTrackingState,
  AutoCompactResult,
  AgentCompactionConfig,
  AgentCompactionState,
  AgentCompactResult,
  AgentMicroCompactResult,
  AgentMicroCompactOptions,
} from './compaction/index.js';

// ── Micro-Compact ──
export {
  microCompactMessages,
  COMPACTABLE_TOOLS,
  CLEARED_MESSAGE,
  DEFAULT_KEEP_RECENT_TOOL_RESULTS,
} from './compaction/index.js';
export type {
  MicroCompactOptions,
  MicroCompactResult,
} from './compaction/index.js';

// ── Cost Tracker ──
export { CostTracker } from './agent/cost-tracker.js';
export type {
  ModelUsage,
  ModelPricing,
  CostSnapshot,
  CostUpdateEvent,
} from './agent/cost-tracker.js';

// ── Tool Search Cache ──
export { CachedToolFilter, computeToolSetHash } from './agent/tool-filter.js';

// ── File State Cache ──
export { FileStateCache, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_SIZE_BYTES } from './file-state-cache.js';
export type { FileState } from './file-state-cache.js';

// ── Context Manager ──
export {
  ContextManager,
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from './memory/context-manager.js';
export type {
  MessageRecord,
  SummaryRecord,
  ContextConfig,
  SceneContext,
  ChatMessageDirection,
} from './memory/context-manager.js';

// ── Conversation Memory ──
export {
  ConversationMemory,
  AI_MESSAGE_MODEL,
  AI_SUMMARY_MODEL,
} from './memory/conversation-memory.js';
export type { ConversationMemoryConfig, SaveRoundMeta } from './memory/conversation-memory.js';

// ── ADR 0009 persistence (agent_* + im_transcripts) ──
export {
  IM_TRANSCRIPT_MODEL,
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  serializeAgentMessage,
  parseAgentMessageRow,
  agentMessageRowToLlm,
} from './memory/agent-db-models.js';
export type {
  ImTranscriptRecord,
  ImTranscriptWriteInput,
  ImTranscriptDirection,
  AgentSessionRecord,
  AgentSessionStatus,
  CreateAgentSessionInput,
  AgentMessageRow,
  AgentSummaryRecord,
  AgentMessageExtra,
  AgentMessageSenderExtra,
  SenderScope,
} from './memory/agent-db-models.js';
export {
  ORCHESTRATION_RUN_MODEL,
  ORCHESTRATION_TASK_MODEL,
  parseDependsOn,
  serializeDependsOn,
} from './memory/orchestration-db-models.js';
export {
  MEMORY_ENTRY_MODEL,
  parseMemoryTags,
  serializeMemoryTags,
} from './memory/memory-entry-models.js';
export type {
  MemoryEntryScope,
  MemoryEntryRecord,
  MemoryEntryUpsertInput,
  MemoryEntrySearchInput,
} from './memory/memory-entry-models.js';
export {
  InMemoryMemoryEntryRepository,
  DatabaseMemoryEntryRepository,
} from './memory/memory-entry-repository.js';
export type { MemoryEntryRepository } from './memory/memory-entry-repository.js';
export type {
  OrchestrationAgentRole,
  OrchestrationRunStatus,
  OrchestrationTaskStatus,
  OrchestrationExecutorKind,
  OrchestrationRunRecord,
  OrchestrationTaskRecord,
  CreateOrchestrationRunInput,
  CreateOrchestrationTaskInput,
} from './memory/orchestration-db-models.js';
export {
  buildSenderPrefix,
  parseAgentMessageExtra,
  applySenderExtraToUserMessage,
  renderUserMessageForLlm,
  normalizeUserMessageForStorage,
  stripSenderPrefixFromText,
  splitQuoteFromUserText,
  formatAuxiliaryUserContentForLlm,
  userMessagePlainText,
  type AgentMessageQuoteExtra,
} from './memory/sender-extra.js';
export type { AppendMessagesOptions } from './memory/context-repository.js';

export {
  AgentSessionStore,
  MemoryAgentSessionStore,
  createAgentSessionEpochId,
} from './memory/agent-session-store.js';
export type { AgentSessionStoreConfig } from './memory/agent-session-store.js';

export {
  DatabaseContextRepository,
  MemoryContextRepository,
  createMemoryContextRepository,
} from './memory/context-repository.js';
export type {
  ContextRepository,
  ContextRepositoryConfig,
  SaveSummaryOptions,
} from './memory/context-repository.js';
export type { SessionBranchPoint } from './memory/session-tree.js';
export {
  collectAbandonedPathRows,
  abandonedRowsToMessages,
  branchSummaryAsUserMessage,
  BRANCH_SUMMARY_PREFIX,
} from './memory/branch-summarization.js';
export {
  buildActivePathRows,
  listUserBranchPoints,
} from './memory/session-tree.js';

export {
  DatabaseImTranscriptStore,
  MemoryImTranscriptStore,
} from './memory/im-transcript-store.js';
export type {
  ImTranscriptStore,
  ImTranscriptQuery,
  ImTranscriptSearchHit,
  ImTranscriptSearchResult,
  ImTranscriptStoreConfig,
} from './memory/im-transcript-store.js';

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

// ── Model Registry ──
export { ModelRegistry, extractModelRoot, computeTierScore } from './model-registry.js';
export type { AIModelInfo, ModelTask } from './model-registry.js';
