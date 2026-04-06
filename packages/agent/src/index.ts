/**
 * @zhin.js/agent — AI Agent composition
 * Composes providers, tools, skills from @zhin.js/core into session, ZhinAgent, init.
 */

// Re-export types from core for convenience
export type {
  AIConfig,
  AIProvider,
  ChatMessage,
  ContentPart,
  AgentTool,
  AgentConfig,
  AgentResult,
} from '@zhin.js/core';

export { Agent, createAgent, formatToolTitle } from './agent.js';
export type { AgentState, AgentEvents } from './agent.js';

export { AIService } from './service.js';

export {
  SessionManager,
  MemorySessionManager,
  DatabaseSessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
} from './session.js';

export {
  ContextManager,
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from './context-manager.js';
export type { ContextConfig, MessageRecord } from './context-manager.js';

export { ZhinAgent } from './zhin-agent/index.js';
export type { ZhinAgentConfig, OnChunkCallback } from './zhin-agent/index.js';

export { PERM_MAP, DEFAULT_CONFIG as ZHIN_AGENT_DEFAULT_CONFIG, SECTION_SEP } from './zhin-agent/config.js';
export {
  checkExecPolicy, applyExecPolicyToTools, resolveExecAllowlist, EXEC_PRESETS,
  isDangerousCommand, stripEnvVarPrefix, stripSafeWrappers, splitCompoundCommand, extractCommandName,
  type ExecPolicyResult,
} from './zhin-agent/exec-policy.js';
export { collectRelevantTools, toAgentTool } from './zhin-agent/tool-collector.js';
export { buildRichSystemPrompt, buildContextHint, buildEnhancedPersona, buildUserMessageWithHistory, contentToText } from './zhin-agent/prompt.js';
export type { RichSystemPromptContext } from './zhin-agent/prompt.js';
export { createChatHistoryTool, createUserProfileTool, createScheduleFollowUpTool, createSpawnTaskTool } from './zhin-agent/builtin-tools.js';

export {
  ConversationMemory,
  AI_MESSAGE_MODEL,
  AI_SUMMARY_MODEL,
} from './conversation-memory.js';
export type { ConversationMemoryConfig } from './conversation-memory.js';

export { UserProfileStore, AI_USER_PROFILE_MODEL } from './user-profile.js';

export { RateLimiter } from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';

export { FollowUpManager, AI_FOLLOWUP_MODEL } from './follow-up.js';
export type { FollowUpRecord, FollowUpSender } from './follow-up.js';

export { SubagentManager } from './subagent.js';
export type {
  SubagentOrigin,
  SubagentResultSender,
  SpawnOptions,
  SubagentManagerOptions,
} from './subagent.js';

export {
  PersistentCronEngine,
  readCronJobsFile,
  writeCronJobsFile,
  getCronJobsFilePath,
  generateCronJobId,
  createCronTools,
  setCronManager,
  getCronManager,
  CRON_JOBS_FILENAME,
} from './cron-engine.js';
export type {
  CronJobRecord,
  CronJobContext,
  CronRunner,
  AddCronFn,
  PersistentCronEngineOptions,
  CronManager,
} from './cron-engine.js';

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
} from './compaction.js';
export type { ContextWindowSource, ContextWindowInfo, ContextWindowGuardResult, PruneResult } from './compaction.js';

export {
  loadBootstrapFiles,
  buildContextFiles,
  buildBootstrapContextSection,
  loadSoulPersona,
  loadToolsGuide,
  loadAgentsMemory,
  clearBootstrapCache,
} from './bootstrap.js';
export type { BootstrapFile, ContextFile } from './bootstrap.js';

export {
  registerAIHook,
  unregisterAIHook,
  triggerAIHook,
  createAIHookEvent,
  clearAIHooks,
  getRegisteredAIHookKeys,
} from './hooks.js';
export type {
  AIHookEvent,
  AIHookEventType,
  AIHookHandler,
  MessageReceivedEvent,
  MessageSentEvent,
  SessionCompactEvent,
  SessionNewEvent,
  AgentBootstrapEvent,
  ToolCallEvent,
} from './hooks.js';

export { detectTone } from './tone-detector.js';
export type { Tone } from './tone-detector.js';

export {
  parseOutput,
  renderToPlainText,
  renderToSatori,
} from './output.js';
export type {
  OutputElement,
  TextElement,
  ImageElement,
  AudioElement,
  VideoElement,
  CardElement,
  FileElement,
  CardField,
  CardButton,
} from './output.js';

export {
  calculatorTool,
  timeTool,
  searchTool,
  codeRunnerTool,
  httpTool,
  memoryTool,
  getBuiltinTools,
  getAllBuiltinTools,
} from './tools.js';

export { initAgentModule } from './init.js';

export {
  MemoryStorageBackend,
  DatabaseStorageBackend,
  createSwappableBackend,
} from './storage.js';
export type {
  StorageBackend,
  DbModel,
} from './storage.js';
