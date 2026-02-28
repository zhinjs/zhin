/**
 * @zhin.js/core — AI 模块
 *
 * 原 @zhin.js/ai 包已合并至此，所有 AI 能力内置在 core 中。
 */

// ── 类型定义 ──
export type {
  AIConfig,
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  OllamaProviderConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ContentPart,
  ToolCall,
  MessageRole,
  AgentTool,
  AgentConfig,
  AgentResult,
} from './types.js';

// ── AI Service ──
export { AIService } from './service.js';

// ── Agent ──
export { Agent, createAgent, formatToolTitle } from './agent.js';

// ── Session ──
export {
  SessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
} from './session.js';

// ── Context Manager ──
export {
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
} from './context-manager.js';
export type {
  ContextManager,
  ContextConfig,
  MessageRecord,
} from './context-manager.js';

// ── ZhinAgent ──
export { ZhinAgent } from './zhin-agent/index.js';
export type { ZhinAgentConfig, OnChunkCallback } from './zhin-agent/index.js';

// ── ZhinAgent sub-modules (for advanced consumers) ──
export { PERM_MAP, DEFAULT_CONFIG as ZHIN_AGENT_DEFAULT_CONFIG, SECTION_SEP } from './zhin-agent/config.js';
export { checkExecPolicy, applyExecPolicyToTools, resolveExecAllowlist, EXEC_PRESETS } from './zhin-agent/exec-policy.js';
export { collectRelevantTools, toAgentTool } from './zhin-agent/tool-collector.js';
export { buildRichSystemPrompt, buildContextHint, buildEnhancedPersona, buildUserMessageWithHistory, contentToText } from './zhin-agent/prompt.js';
export type { RichSystemPromptContext } from './zhin-agent/prompt.js';
export { createChatHistoryTool, createUserProfileTool, createScheduleFollowUpTool, createSpawnTaskTool } from './zhin-agent/builtin-tools.js';

// ── Conversation Memory ──
export {
  ConversationMemory,
  AI_MESSAGE_MODEL,
  AI_SUMMARY_MODEL,
} from './conversation-memory.js';
export type { ConversationMemoryConfig } from './conversation-memory.js';

// ── User Profile ──
export {
  UserProfileStore,
  AI_USER_PROFILE_MODEL,
} from './user-profile.js';

// ── Rate Limiter ──
export { RateLimiter } from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';

// ── Follow-Up ──
export { FollowUpManager, AI_FOLLOWUP_MODEL } from './follow-up.js';
export type { FollowUpRecord, FollowUpSender } from './follow-up.js';

// ── Subagent ──
export { SubagentManager } from './subagent.js';
export type {
  SubagentOrigin,
  SubagentResultSender,
  SpawnOptions,
  SubagentManagerOptions,
} from './subagent.js';

// ── 持久化定时任务引擎 ──
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
  CronRunner,
  AddCronFn,
  PersistentCronEngineOptions,
  CronManager,
} from './cron-engine.js';

// ── Tone Detector ──
export { detectTone } from './tone-detector.js';
export type { Tone } from './tone-detector.js';

// ── 多模态输出 ──
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

// ── 内置工具 ──
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

// ── 初始化 ──
export { initAIModule } from './init.js';

// ── Hook 系统 (借鉴 OpenClaw) ──
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

// ── 会话压缩 (借鉴 OpenClaw) ──
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
export type {
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
} from './compaction.js';

// ── 引导文件管理 (借鉴 OpenClaw) ──
export {
  loadBootstrapFiles,
  buildContextFiles,
  buildBootstrapContextSection,
  loadSoulPersona,
  loadToolsGuide,
  loadAgentsMemory,
  clearBootstrapCache,
} from './bootstrap.js';
export type {
  BootstrapFile,
  ContextFile,
} from './bootstrap.js';
