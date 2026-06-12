// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

export * from '@zhin.js/core';
/**
 * Re-export @zhin.js/agent（会话、ZhinAgent、init、内置工具等）
 */
export {
  SessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  createContextManager,
  ConversationMemory,
  RateLimiter,
  parseOutput,
  renderToPlainText,
  renderToSatori,
  detectTone,
  estimateTokens,
  estimateMessagesTokens,
  compactSession,
  DEFAULT_CONTEXT_TOKENS,
  filterTools,
  ModelRegistry,
  extractModelRoot,
  computeTierScore
} from '@zhin.js/ai';
export {
  initAgentModule,
  initAgentModule as initAIModule,
  AIService,
  ZhinAgent,
  UserProfileStore,
  SubagentManager,
  PersistentCronEngine,
  registerAIHook,
  unregisterAIHook,
  triggerAIHook,
  createAIHookEvent,
  clearAIHooks,
  getRegisteredAIHookKeys,
  registerAgentPromptContributor,
  unregisterAgentPromptContributor,
  clearAgentPromptContributors,
  resolveAgentPromptSections,
  resolveAgentPromptMarkdown,
  loadBootstrapFiles,
  loadSoulPersona,
  loadToolsGuide,
  loadAgentsMemory
} from '@zhin.js/agent';

export type {
  AIConfig,
  AIProvider,
  AgentTool,
  ChatMessage,
  ContentPart,
  ProviderConfig,
  ProviderCapabilities,
  ContextManager,
  ContextConfig,
  MessageRecord,
  ConversationMemoryConfig,
  RateLimitConfig,
  RateLimitResult,
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
  Tone,
  OutputElement,
  TextElement,
  ImageElement,
  AudioElement,
  VideoElement,
  CardElement,
  FileElement,
  CardField,
  CardButton
} from '@zhin.js/ai';
export type {
  ZhinAgentConfig,
  OnChunkCallback,
  SubagentOrigin,
  SubagentResultSender,
  SpawnOptions,
  SubagentManagerOptions,
  CronJobRecord,
  CronRunner,
  AddCronFn,
  PersistentCronEngineOptions,
  CronManager,
  BootstrapFile,
  ContextFile,
  MessageReceivedEvent,
  MessageSentEvent,
  SessionCompactEvent,
  SessionNewEvent,
  AgentBootstrapEvent,
  ToolCallEvent,
  RichSystemPromptContext
} from '@zhin.js/agent';

/**
 * Re-export 多 Agent 编排 API（runPipeline / runParallel / route）
 */
export {
  runPipeline,
  runParallel,
  route,
} from './agent-orchestrator.js';

export type {
  AgentStepOptions,
  PipelineStep,
  ParallelTask,
  RouteRule,
} from './agent-orchestrator.js';

export { default as logger, formatCompact, formatCompactLog, formatCompactUsage, truncatePreview } from '@zhin.js/logger';

// ================================================================================================
// 模块声明 - 允许插件通过 declare module "zhin.js" 扩展类型
// ================================================================================================
import type { AIService as AIServiceType } from '@zhin.js/agent';

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      ai: AIServiceType;
    }
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  interface RegisteredAdapters {}
  interface Models {
    unified_inbox_message?: object;
    unified_inbox_request?: object;
    unified_inbox_notice?: object;
  }
}
