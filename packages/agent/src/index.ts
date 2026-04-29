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
export {
  checkExecPolicy, applyExecPolicyToTools, resolveExecAllowlist, EXEC_PRESETS,
  isDangerousCommand, stripEnvVarPrefix, stripSafeWrappers, splitCompoundCommand, extractCommandName,
  type ExecPolicyResult,
} from './security/exec-policy.js';
export { collectRelevantTools, toAgentTool } from './zhin-agent/tool-collector.js';
export {
  buildRichSystemPrompt,
  buildContextHint,
  buildEnhancedPersona,
  buildUserMessageWithHistory,
  contentToText,
  describePromptSectionsForDebug,
} from './zhin-agent/prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './zhin-agent/prompt.js';
export { createChatHistoryTool, createUserProfileTool, createSpawnTaskTool } from './zhin-agent/builtin-tools.js';

export { UserProfileStore, AI_USER_PROFILE_MODEL } from './user-profile.js';

export { SubagentManager } from './subagent.js';
export type {
  SubagentOrigin, SubagentResultSender, SpawnOptions, SubagentManagerOptions,
} from './subagent.js';

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
  calculatorTool, timeTool, searchTool, codeRunnerTool,
  httpTool, memoryTool, getBuiltinTools, getAllBuiltinTools,
} from './tools.js';

export { initAgentModule } from './init.js';

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
  SkillRegistry,
  SubAgentRegistry,
  McpRegistry,
  HookRegistry,
  createAIHookEvent,
} from './orchestrator/index.js';
export type {
  ToolInput, McpConnection,
  ResourceScope, ResourceEntry,
  Tool, ToolContext, IMToolContext, ToolPermissionLevel, ToolScope,
  ToolParametersSchema, PropertySchema, ToolJsonSchema,
  Skill, SkillMetadata,
  SubAgentDef, AgentPreset,
  McpServerEntry, McpResource, McpPrompt,
  AIHook, AIHookEvent as OrchestratorHookEvent, AIHookEventType as OrchestratorHookEventType, AIHookHandler as OrchestratorHookHandler,
} from './orchestrator/index.js';
