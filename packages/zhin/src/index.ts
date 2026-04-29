// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

export * from '@zhin.js/core';
/**
 * Re-export @zhin.js/agent（会话、ZhinAgent、init、内置工具等）
 */
export {
  initAgentModule,
  initAgentModule as initAIModule,
  Agent,
  createAgent,
  formatToolTitle,
  AIService,
  SessionManager,
  createMemorySessionManager,
  createDatabaseSessionManager,
  ZhinAgent,
  createContextManager,
  ConversationMemory,
  UserProfileStore,
  RateLimiter,
  SubagentManager,
  PersistentCronEngine,
  registerAIHook,
  unregisterAIHook,
  triggerAIHook,
  createAIHookEvent,
  clearAIHooks,
  getRegisteredAIHookKeys,
  parseOutput,
  renderToPlainText,
  renderToSatori,
  loadBootstrapFiles,
  loadSoulPersona,
  loadToolsGuide,
  loadAgentsMemory,
  getBuiltinTools,
  getAllBuiltinTools,
  calculatorTool,
  timeTool,
  searchTool,
  codeRunnerTool,
  httpTool,
  memoryTool,
  detectTone,
  estimateTokens,
  estimateMessagesTokens,
  compactSession,
  DEFAULT_CONTEXT_TOKENS,
} from '@zhin.js/agent';

export type {
  ZhinAgentConfig,
  OnChunkCallback,
  ContextManager,
  ContextConfig,
  MessageRecord,
  ConversationMemoryConfig,
  RateLimitConfig,
  RateLimitResult,
  SubagentOrigin,
  SubagentResultSender,
  SpawnOptions,
  SubagentManagerOptions,
  CronJobRecord,
  CronJobContext,
  CronRunner,
  AddCronFn,
  PersistentCronEngineOptions,
  CronManager,
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
  PruneResult,
  BootstrapFile,
  ContextFile,
  LegacyAIHookEvent as AIHookEvent,
  LegacyAIHookEventType as AIHookEventType,
  LegacyAIHookHandler as AIHookHandler,
  MessageReceivedEvent,
  MessageSentEvent,
  SessionCompactEvent,
  SessionNewEvent,
  AgentBootstrapEvent,
  ToolCallEvent,
  Tone,
  OutputElement,
  TextElement,
  ImageElement,
  AudioElement,
  VideoElement,
  CardElement,
  FileElement,
  CardField,
  CardButton,
  AgentState,
  AgentEvents,
  RichSystemPromptContext,
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

export { default as logger } from '@zhin.js/logger';

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
    unified_inbox_message?: Record<string, unknown>;
    unified_inbox_request?: Record<string, unknown>;
    unified_inbox_notice?: Record<string, unknown>;
  }
}
