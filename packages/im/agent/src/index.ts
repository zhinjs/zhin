/**
 * @zhin.js/agent — AI Agent orchestration hub
 *
 * Provides AgentOrchestrator as the central registry for
 * tools, skills, subagents, mcps, and hooks.
 */

// ── Re-export AI primitives from @zhin.js/ai (no shims) ──
export type {
  AIConfig,
  AIProvider,
  ChatMessage,
  ContentPart,
  AgentTool,
  AgentConfig,
  AgentResult,
  ToolResultTransformInput,
  ToolResultTransform,
} from '@zhin.js/ai';

export { Agent, createAgent, formatToolTitle } from '@zhin.js/ai';
export type { AgentState, AgentEvents } from '@zhin.js/ai';

export {
  SessionManager,
  MemorySessionManager,
  DatabaseSessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
} from '@zhin.js/ai';

export {
  ContextManager,
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from '@zhin.js/ai';
export type { ContextConfig, MessageRecord } from '@zhin.js/ai';

export {
  ConversationMemory,
  AI_MESSAGE_MODEL,
  AI_SUMMARY_MODEL,
} from '@zhin.js/ai';
export type { ConversationMemoryConfig } from '@zhin.js/ai';

export { RateLimiter } from '@zhin.js/ai';
export type { RateLimitConfig, RateLimitResult } from '@zhin.js/ai';

export { detectTone } from '@zhin.js/ai';
export type { Tone } from '@zhin.js/ai';

export { parseOutput, renderToPlainText, renderToSatori } from '@zhin.js/ai';
export type {
  OutputElement, TextElement, ImageElement, AudioElement,
  VideoElement, CardElement, FileElement, CardField, CardButton,
} from '@zhin.js/ai';

export {
  MemoryStorageBackend,
  DatabaseStorageBackend,
  createSwappableBackend,
} from '@zhin.js/ai';
export type { StorageBackend, DbModel } from '@zhin.js/ai';

export {
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
  DEFAULT_CONTEXT_TOKENS,
} from '@zhin.js/ai';
export type { ContextWindowSource, ContextWindowInfo, ContextWindowGuardResult, PruneResult } from '@zhin.js/ai';

// ── Agent-specific modules ──

export { AIService } from './service.js';

export { ZhinAgent } from './zhin-agent/index.js';
export type { ZhinAgentConfig, OnChunkCallback } from './zhin-agent/index.js';

export { PERM_MAP, DEFAULT_CONFIG as ZHIN_AGENT_DEFAULT_CONFIG, SECTION_SEP } from './zhin-agent/config.js';
export { MODEL_HARNESS_DEFAULTS, resolveModelHarness, mergeModelHarnessValues } from './zhin-agent/model-harness.js';
export type { ModelHarnessRow, ResolvedModelHarness, ModelHarnessConfig } from './zhin-agent/model-harness.js';
export {
  checkExecPolicy, applyExecPolicyToTools, resolveExecAllowlist, EXEC_PRESETS,
  isDangerousCommand, stripEnvVarPrefix, stripSafeWrappers, splitCompoundCommand, extractCommandName,
  type ExecPolicyResult,
} from './security/exec-policy.js';
export {
  ZHIN_NEEDS_OWNER_FIRST_LINE,
  OWNER_HARD_ORCHESTRATION_TOOLS,
  parseNeedsOwnerSignal,
  shouldHardOrchestrateOwnerConfirm,
  createOwnerOrchestratedToolResultTransform,
} from './orchestrator/owner-confirm-orchestration.js';
export type { OwnerOrchestrationOptions } from './orchestrator/owner-confirm-orchestration.js';
export {
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildContextHint,
  buildEnhancedPersona,
  buildUserMessageWithHistory,
  contentToText,
  describePromptSectionsForDebug,
} from './zhin-agent/prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './zhin-agent/prompt.js';
export {
  registerAgentPromptContributor,
  unregisterAgentPromptContributor,
  getAgentPromptContributor,
  clearAgentPromptContributors,
  resolveAgentPromptSections,
  resolveAgentPromptMarkdown,
  resolveDeferredToolsForPlatform,
  formatAgentPromptSectionsMarkdown,
} from './agent-prompt/index.js';
export type { ResolveAgentPromptOptions } from './agent-prompt/index.js';
export { createChatHistoryTool, createUserProfileTool, createSpawnTaskTool } from './zhin-agent/builtin-tools.js';

export { UserProfileStore, AI_USER_PROFILE_MODEL } from './user-profile.js';

export { SubagentManager } from './subagent.js';
export type {
  SubagentOrigin, SubagentResultSender, SpawnOptions, SubagentManagerOptions,
} from './subagent.js';
export { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from './reserved-tools.js';

export { BuiltinBaseTool } from './builtin/builtin-base-tool.js';
export {
  ReadFileBuiltinTool,
  createReadFileTool,
  READ_FILE_PARAMETERS,
} from './builtin/read-file-tool.js';
export {
  WriteFileBuiltinTool,
  createWriteFileTool,
  WRITE_FILE_PARAMETERS,
} from './builtin/write-file-tool.js';
export {
  EditFileBuiltinTool,
  createEditFileTool,
  EDIT_FILE_PARAMETERS,
} from './builtin/edit-file-tool.js';
export {
  ListDirBuiltinTool,
  createListDirTool,
  LIST_DIR_PARAMETERS,
} from './builtin/list-dir-tool.js';
export {
  GlobBuiltinTool,
  createGlobTool,
  GLOB_PARAMETERS,
  type GlobExecAsync,
} from './builtin/glob-tool.js';
export {
  GrepBuiltinTool,
  createGrepTool,
  GREP_PARAMETERS,
  type GrepExecAsync,
} from './builtin/grep-tool.js';
export {
  BashBuiltinTool,
  createBashTool,
  BASH_PARAMETERS,
  type BashExecAsync,
} from './builtin/bash-tool.js';
export {
  WebSearchBuiltinTool,
  createWebSearchTool,
  WEB_SEARCH_PARAMETERS,
  MAX_WEB_SEARCH_COUNT,
} from './builtin/web-search-tool.js';
export {
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  DEFAULT_WEB_SEARCH_MARKET,
  normalizeWebSearchLocaleHint,
  acceptLanguageForMarket,
  resolveWebSearchMarketFromContext,
} from './builtin/web-search-locale.js';
export { bingSearchFetchHeaders, buildBingSearchUrl } from './builtin/bing-search-html.js';
export {
  WebFetchBuiltinTool,
  createWebFetchTool,
  WEB_FETCH_PARAMETERS,
  WEB_FETCH_DEFAULT_MAX_LENGTH,
  stripFetchedHtmlToText,
} from './builtin/web-fetch-tool.js';
export {
  TodoReadBuiltinTool,
  createTodoReadTool,
  TODO_READ_PARAMETERS,
} from './builtin/todo-read-tool.js';
export {
  TodoWriteBuiltinTool,
  createTodoWriteTool,
  TODO_WRITE_PARAMETERS,
} from './builtin/todo-write-tool.js';
export {
  ActivateSkillBuiltinTool,
  createActivateSkillTool,
  ACTIVATE_SKILL_PARAMETERS,
  type ActivateSkillToolOptions,
} from './builtin/activate-skill-tool.js';
export {
  InstallSkillBuiltinTool,
  createInstallSkillTool,
  INSTALL_SKILL_PARAMETERS,
  type InstallSkillToolOptions,
} from './builtin/install-skill-tool.js';
export {
  AskUserBuiltinTool,
  createAskUserTool,
  ASK_USER_PARAMETERS,
  askViaPrompt,
  formatOwnerResponse,
} from './builtin/ask-user-tool.js';
export { createBuiltinTools, type BuiltinToolsOptions } from './builtin-tools.js';
export { ZHIN_WEB_USER_AGENT, WEB_TOOL_FETCH_TIMEOUT_MS } from './builtin/web-tool-utils.js';

export {
  PersistentCronEngine,
  readCronJobsFile, writeCronJobsFile, getCronJobsFilePath, generateCronJobId,
  createCronTools, setCronManager, getCronManager, CRON_JOBS_FILENAME,
} from './cron-engine.js';
export type {
  CronJobRecord, CronJobContext, CronRunner, AddCronFn,
  PersistentCronEngineOptions, CronManager, PromptOptimizer,
} from './cron-engine.js';

export {
  loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection,
  loadSoulPersona, loadToolsGuide, loadAgentsMemory, clearBootstrapCache,
} from './bootstrap.js';
export type { BootstrapFile, ContextFile } from './bootstrap.js';

export {
  registerAIHook, unregisterAIHook, triggerAIHook,
  createAIHookEvent as createLegacyAIHookEvent, clearAIHooks, getRegisteredAIHookKeys,
} from './hooks.js';
export type {
  AIHookEvent as LegacyAIHookEvent, AIHookEventType as LegacyAIHookEventType, AIHookHandler as LegacyAIHookHandler,
  MessageReceivedEvent, MessageSentEvent, SessionCompactEvent,
  SessionNewEvent, AgentBootstrapEvent, ToolCallEvent,
} from './hooks.js';

export {
  createAIHookBusPayload,
  isAISessionNewPayload,
  isAISessionCompactPayload,
  onAIHook,
  onAISessionNew,
  onAISessionCompact,
} from './ai-event-bus.js';
export type {
  AIEventPayload,
  AISessionNewPayload,
  AISessionCompactPayload,
} from './ai-event-bus.js';
export {
  AI_EVENT_NAMES,
  subscribeAIEvents,
} from './ai-event-subscriber.js';
export type {
  AIEventName,
  AIEventFilter,
  AIEventHandlers,
} from './ai-event-subscriber.js';

export { initAgentModule } from './init.js';

// ── Typing Indicator ──
export {
  TypingIndicatorManager,
  ReactionTypingIndicator,
  MessageTypingIndicator,
  NoneTypingIndicator,
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  getTypingIndicatorManager,
  initTypingIndicatorManager,
  startTypingIndicator,
  stopTypingIndicator,
} from './typing-indicator/index.js';
export type {
  TypingIndicatorType,
  TypingIndicatorConfig,
  TypingIndicatorOptions,
  TypingIndicator,
  TypingIndicatorAdapter,
} from './typing-indicator/index.js';

// ── Adapter Typing Indicator Integration ──
export {
  AdapterTypingIndicatorManager,
  PLATFORM_FEATURES,
  getAdapterTypingIndicatorManager,
  initAdapterTypingIndicatorManager,
  enableTypingIndicatorForBot,
  startTypingForBot,
  stopTypingForBot,
} from './typing-indicator/adapter-integration.js';
export type {
  AdapterTypingIndicatorConfig,
  PlatformFeatures,
  BotWithTypingIndicator,
} from './typing-indicator/adapter-integration.js';

// ── MCP Client ──
export { McpClientManager, McpClientConnection, mcpToolToAgentTool } from './mcp-client/index.js';
export type { McpClientConnectionState, McpToolDefinition } from './mcp-client/index.js';

// ── Common adapter tools (migrated from core) ──
export {
  createGroupManagementTools, buildMethodArgs,
  GROUP_METHOD_SPECS, GROUP_MANAGEMENT_SKILL_TAGS, GROUP_MANAGEMENT_SKILL_KEYWORDS,
} from './common-adapter-tools.js';
export type { IGroupManagement, GroupMethodSpec } from './common-adapter-tools.js';

// ── Orchestrator (AI resource hub) ──
export { AgentOrchestrator } from './orchestrator/index.js';
export {
  ResourceRegistry,
  ToolRegistry, ZhinTool, isZhinTool, defineTool, extractParamInfo,
  canAccessTool, inferPermissionLevel, hasPermissionLevel,
  normalizeTool, sharedToolSelection,
  SkillRegistry,
  SubAgentRegistry,
  McpRegistry,
  HookRegistry,
  createAIHookEvent,
} from './orchestrator/index.js';
export type {
  ToolInput, McpConnection,
  ResourceScope, ResourceEntry,
  Tool, ToolContext, IMToolContext, ToolPermissionLevel, ToolScope, FileRole,
  ToolParametersSchema, PropertySchema, ToolJsonSchema,
  Skill, SkillMetadata,
  SubAgentDef, AgentPreset,
  McpServerEntry, McpResource, McpPrompt,
  AIHook, AIHookEvent as OrchestratorHookEvent, AIHookEventType as OrchestratorHookEventType, AIHookHandler as OrchestratorHookHandler,
} from './orchestrator/index.js';
