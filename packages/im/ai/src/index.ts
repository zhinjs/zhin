/**
 * Framework-agnostic AI engine.
 *
 * Provides AI provider abstractions, agent loop, session management,
 * memory & compaction utilities with ZERO dependency on IM/Bot concepts.
 * Can be used in any Node.js application.
 * @module @zhin.js/ai
 */

// ── LLM engine core (ADR 0009) ──
export {
  LlmApiRuntime,
  createLlmTransportModel,
  defaultModelInput,
  resolveProviderConfigResilience,
  createAssistantMessageEventStream,
  createContext,
  createUserMessage,
  validateToolCall,
  toolCallFromContentBlock,
  stringParamTool,
  ToolCallValidationError,
  isLlmAgentMessage,
  isEventMessage,
  repairAgentMessagesForLlm,
  EMPTY_TOKEN_USAGE,
  DEFAULT_STEERING_MODE,
  DEFAULT_FOLLOW_UP_MODE,
  z,
  agentLoop,
  agentContextFrom,
  assistantText,
  assistantAnswerText,
  parseLenientJsonObject,
  registerStructuredOutputPromptText,
  CompletionFailureError,
  createLlmApiRuntime,
  isSdkId,
  SDK_IDS,
  createSdkProviderAdapter,
  SdkProviderAdapter,
  sdkEntryFromProvider,
  sdkSupportsImageGeneration,
  resolveSdkProviderModels,
  SDK_DEFAULT_MODELS,
  agentToolToLlmTool,
  agentToolsToLlmTools,
  formatRedactedJson,
  buildPromptCacheKey,
  supportsPromptCacheSdk,
  isStreamPromptCacheEnabled,
  applyProviderGatewayPreset,
  validateProviderGatewayConfig,
  inferModelReasoning,
  resolveTransportContextWindow,
  PROVIDER_GATEWAY_PRESETS,
  DEFAULT_PROVIDER_MEDIA,
  filterMediaBlocksForProvider,
  mediaBlockPlaceholder,
  mediaRefToInline,
  isMediaBlockRef,
  isMediaContentBlock,
  AiHttpTransport,
  createAiHttpTransport,
  resolveAiProxyUrl,
} from './llm/index.js';
export type {
  PromptCacheRetention,
  ProviderGatewayPreset,
  ProviderMediaKind,
  AiHttpTransportOptions,
} from './llm/index.js';
export type {
  Context,
  Model,
  ModelApi,
  ModelInputModality,
  ProviderInstanceConfig,
  AgentMessage,
  ConversationActor,
  ConversationQuote,
  ConversationTurnCause,
  ContextBlock,
  ContextMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CustomAgentMessage,
  EventMessage,
  ContentBlock,
  TextContentBlock,
  MediaContentBlock,
  MediaBlockRef,
  LlmTool,
  ParsedToolCall,
  AgentEvent,
  ThinkingLevel,
  ToolExecutionMode,
  QueueMode,
  LlmRequestInput,
  LlmRequestObservation,
  StreamOptions,
  AssistantStreamEvent,
  AssistantMessageEventStream,
  ApiProviderRegistration,
  AgentLoopConfig,
  AgentContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  ToolExecutionCause,
  TokenUsage,
  SdkId,
  LlmCompletionPort,
} from './llm/index.js';
export { renderContextMessage } from './llm/index.js';
export {
  DEFAULT_PROVIDER_RESILIENCE,
  ProviderRequestError,
  classifyProviderError,
  computeBackoffDelay,
  createResilientCompletionPort,
  describeProviderFailure,
  providerFailureKind,
  isProviderFailureMessage,
  parseRetryAfterMs,
  resolveProviderResilienceConfig,
} from './llm/index.js';
export type {
  ProviderErrorClassification,
  ProviderErrorKind,
  ProviderResilienceConfig,
  ProviderResilienceEvent,
  ProviderTimers,
  ResilientCompletionOptions,
} from './llm/index.js';
export { finishFailureKind, resolveFinish } from './llm/index.js';
export type { FinishFailureKind, FinishInput, FinishOutcome } from './llm/index.js';

// ── Core AI Types ──
export type {
  AIConfig,
  AmbientEngagementConfig,
  SceneEventWakeConfig,
  DecisionTaskConfig,
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  OllamaProviderConfig,
  ChatMessage,
  TextCompleteOptions,
  TextCompleteResult,
  ToolCall,
  MessageRole,
  AgentTool,
  AgentToolExecutionContext,
  AgentConfig,
  AgentResult,
  ToolResultTransformInput,
  ToolResultTransform,
  ToolFilterOptions,
  Usage,
  JsonSchema,
  ToolContext,
} from './types.js';

// ── Providers ──
export {
  ZHIPU_DEFAULT_IMAGE_MODEL,
  CLOUDFLARE_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  GOOGLE_DEFAULT_IMAGE_MODEL,
  MINIMAX_DEFAULT_IMAGE_MODEL,
  hasGenerateImage,
} from './image-generation.js';
export type {
  ImageGenerateRequest,
  ImageGenerateResult,
  ImageGenerationCapable,
  ImageGenerationDefaults,
} from './image-generation.js';

// ── Agent Engine (utilities, not the legacy Agent class) ──
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
  buildDocumentFrequency,
  createIdfFn,
  scoreWeightedTfidfOverlap,
  collectSkillWeightedTerms,
  collectTermSet,
} from './agent/tfidf.js';
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

// ── Agent memory scope ──
export { resolveAgentScopedSessionId } from './memory/agent-scoped-session.js';
export type { AgentMemoryScope } from './memory/agent-scoped-session.js';

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
  estimateContextFixedTokens,
  estimateAgentMessageTokens,
  estimateAgentMessagesTokens,
  findKeepRecentStartIndex,
  snapCompactionStartIndex,
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

// ── Agent session persistence ──
export {
  AGENT_SESSION_SOURCE_MODEL,
  agentSessionSourceFields,
  AGENT_MESSAGE_QUERY_MODEL,
  agentMessageQueryFields,
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  serializeAgentMessage,
  parseAgentMessageRow,
  agentMessageRowToLlm,
} from './memory/agent-db-models.js';
export type {
  AgentSessionRecord,
  AgentSessionStatus,
  CreateAgentSessionInput,
  AgentMessageRow,
  AgentSummaryRecord,
  AgentMessageExtra,
} from './memory/agent-db-models.js';
export {
  MEMORY_ENTRY_MODEL,
  MEMORY_ENTRY_ADDED_COLUMNS,
  MEMORY_ENTRY_KINDS,
  MEMORY_ENTRY_HISTORY_LIMIT,
  parseMemoryTags,
  serializeMemoryTags,
  parseMemoryHistory,
  isMemoryEntryKind,
  normalizeMemoryKind,
  renderMemoryEntriesMarkdown,
} from './memory/memory-entry-models.js';
export type {
  MemoryEntryScope,
  MemoryEntryKind,
  MemoryEntryTrustLevel,
  MemoryEntryVersion,
  MemoryEntryRecord,
  MemoryEntryUpsertInput,
  MemoryEntrySearchInput,
} from './memory/memory-entry-models.js';
export {
  InMemoryMemoryEntryRepository,
  DatabaseMemoryEntryRepository,
  ensureMemoryEntryColumns,
  isMemoryEntryExpired,
} from './memory/memory-entry-repository.js';
export type { MemoryEntryRepository, MemoryEntryLocator, MemoryEntryListInput } from './memory/memory-entry-repository.js';
export { tokenizeForBm25, rankBm25, rankMemoryEntries, memoryEntryDocument } from './memory/memory-bm25.js';
export type { Bm25Options, Bm25Hit } from './memory/memory-bm25.js';
export {
  parseAgentMessageExtra,
  renderUserMessageForLlm,
  normalizeUserMessageForStorage,
  userMessageBody,
  userMessagePlainText,
  type AgentMessageQuoteExtra,
} from './memory/user-message-presentation.js';
export type { AppendMessagesOptions } from './memory/context-repository.js';

export {
  AgentSessionStore,
  MemoryAgentSessionStore,
} from './memory/agent-session-store.js';
export type {
  AgentSessionRepository,
  AgentSessionStoreConfig,
} from './memory/agent-session-store.js';
export { PersistenceUnavailableError } from './memory/persistence-error.js';

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
export type { DeferredToolSessionSnapshot } from './memory/deferred-tool-session.js';
export {
  EMPTY_DEFERRED_TOOL_SNAPSHOT,
  getLoadedToolNamesFromSnapshot,
  getLoadedToolNamesInLoadOrder,
  touchToolInSnapshot,
  touchToolsInSnapshot,
  addSkillToSnapshot,
} from './memory/deferred-tool-session.js';
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

// ── Agent stream wire format (ADR 0039 P0) ──
export {
  ZHIN_SESSION_ID_HEADER,
  AGENT_STREAM_MEDIA_TYPE,
  ZHIN_AGENT_SESSION_API_PREFIX,
  AgentStreamEventType,
  formatAgentStreamNdjsonLine,
  createAgentStreamReduceState,
  reduceAgentStreamEvent,
} from './agent-stream.js';
export type {
  AgentStreamEvent,
  AgentStreamEventTypeName,
  StartAgentSessionResponse,
  ContinueAgentSessionBody,
  ContinueAgentSessionResponse,
  AgentStreamReduceState,
} from './agent-stream.js';

export type {
  JournalStore,
  JournalRunSummary,
} from './journal-store.js';

export {
  createAgentStreamNdjsonParserState,
  parseAgentStreamNdjsonChunk,
  flushAgentStreamNdjsonParser,
  iterateAgentStreamNdjson,
  foldAgentStreamNdjson,
} from './agent-stream-consumer.js';
export type {
  AgentStreamNdjsonParserState,
  FoldAgentStreamOptions,
} from './agent-stream-consumer.js';

export {
  AgentStepStatus,
  createStepId,
} from './agent-step-checkpoint.js';
export type {
  AgentStepCheckpoint,
  AgentStepStatusName,
  AgentStepInterruptKind,
} from './agent-step-checkpoint.js';

// ── Tool policy (ADR 0039 P1) ──
export {
  toolApprovalAlways,
  toolApprovalOnce,
  toolApprovalNever,
} from './tool-policy.js';
export type {
  ToolApprovalMode,
  ToolApprovalPolicy,
  ToolToModelOutputInput,
  ToolToModelOutputFn,
} from './tool-policy.js';

// ── MCP qualified names ──
export {
  formatMcpQualifiedToolName,
  parseMcpQualifiedToolName,
  isMcpQualifiedToolName,
  parseLegacyMcpToolName,
  resolveMcpConnectionFromToolName,
} from './mcp-qualified-name.js';

// ── Authorization / HITL stream payloads ──
export type {
  AuthorizationRequiredData,
  AuthorizationCompletedData,
  InputRequestedData,
  InputCompletedData,
} from './authorization-events.js';

// Structured decisions are independent of text completion and IM orchestration.
export type {
  JsonValue, ChoiceQuestion, ScoreCriteria, ScoreQuestion, NoulQuestion,
  DecisionQuestion, DecisionQuestions, ChoiceAnswer, ScoreAnswer, NoulAnswer,
  DecisionAnswer, DecisionRequest, DecisionResult, DecisionOptions, DecisionProvider,
} from './decision/index.js';

export { createPromptContextBlock, createPromptStateBlock, projectPromptContext } from './memory/prompt-context.js';
export { trimFinishedToolResults, lastTurnStart, FINISHED_TOOL_RESULT_KEEP_CHARS } from './memory/tool-result-trim.js';
export {
  projectParticipantHeaders, parseParticipantHeader, buildStoredHeader, renderParticipantHeader, shortHeaderOf,
  factsFromActor, factsFromBot, factsFromAssistantActor, mergeHeaderRoles, muteTimeFromExpiry, formatHeaderInstant,
  renderQuoteLine, HEADER_TIME_INTERVAL_MS, QUOTE_INLINE_MAX_CHARS,
  type ParticipantFacts, type BotHeaderFacts, type HeaderFormatOptions,
} from './memory/participant-header.js';
export {
  MessageAliasTable, UnconfirmedMessageAliasError, indexMessageAliases, isMessageAlias, messageAliasOf, resolveMessageAliasArguments,
  assignRowAliasSeqs, payloadMessageId,
  type MessageAliasIndex, type MessageAliasAssignment,
} from './memory/message-alias.js';

export {
  HEADER_VALUE_MAX_CHARS,
  RESERVED_SENDER_IDS,
  SYSTEM_SENDER_ID,
  escapeHeaderValue,
  quoteEventValue,
  renderSenderId,
  formatHeader,
} from './memory/message-header.js';

export {
  STATE_CHANGE_PREFIX,
  MEMBER_PROFILE_FIELDS,
  formatEventClock,
  formatMemberChangedLine,
  formatMemberPresenceLine,
  createMemberChangedEvent,
  createMemberPresenceEvent,
} from './memory/event-message.js';
export type { MemberProfileField, EventMessageSource } from './memory/event-message.js';
export {
  renderEventsForProvider,
  createLlmMessageProjection,
  isMidConversationSystemMessage,
} from './memory/event-rendering.js';
export type { MidConversationSystemMessage } from './memory/event-rendering.js';
export { agentMessagesToAiSdk } from './llm/bridge/ai-sdk-messages.js';
export {
  MID_CONVERSATION_SYSTEM_VALUES,
  isMidConversationSystem,
  isLocalEndpoint,
  resolveMidConversationSystem,
} from './llm/mid-conversation-system.js';
export type { MidConversationSystem } from './llm/mid-conversation-system.js';
