// Core exports
export * from './endpoint.js'
export * from './endpoint-capabilities.js'
export * from './plugin.js'
export * from './command.js'
export * from './component.js'
export * from './adapter.js'
export * from './message.js'
export { quoteIdFromContent, quoteIdFromRaw, syncQuoteId, alignReplySegments } from './message-quote.js'
export { htmlToPlainText, htmlToPlainTextWithBlockBreaks, htmlToFallbackText } from './built/html-to-text.js'
export { registerHtmlSegmentFallback, coerceHtmlSegmentsToText } from './built/html-segment-fallback.js'
export {
  AGENT_MESH_TOOL_NAMES,
  setAgentMeshToolsRegistrar,
  applyAgentMeshTools,
} from './built/mcp-mesh-registrar.js'
export {
  prependQuoteContext,
  resolveQuotedMessagePayload,
  resolveQuoteContextBlock,
  buildUserTurnWithQuoteContext,
  formatQuoteContextBlock,
  QUOTED_MESSAGE_CONTEXT_MARKER,
  CURRENT_USER_MESSAGE_MARKER,
  QUOTE_CONTEXT_SYSTEM_HINT,
  QUOTE_CONTEXT_SYSTEM_EXTRA_KEY,
  QUOTE_CONTEXT_BLOCK_EXTRA_KEY,
  QUOTED_CONTENT_UNTRUSTED_NOTE,
  sanitizeQuotedBodyForPrompt,
} from './built/prepend-quote-context.js'
export * from './notice.js'
export * from './request.js'
export * from './prompt.js'
// Models
export * from './models/system-log.js'
export * from './models/user.js'
// Built-in Contexts
export * from './built/config.js'
export * from './built/command.js'
export * from './built/cron.js'
export * from './built/permission.js'
export * from './built/permit-parse.js'
export * from './built/permit-check.js'
export * from './built/platform-permit.js'
export * from './built/authorization.js'
export {
  enrichMessageForAgent,
  createSyntheticMessage,
  senderRolesFromMessage,
  resolveContextKey,
  commMessageFromHookContext,
} from './built/message-enrich.js'
export type { AgentTurnMessage, SyntheticMessageInput } from './built/message-enrich.js'
export * from './built/adapter-process.js'
export {
  isDenoDeploy,
  isInteractiveStdin,
  shouldBindProcessStdin,
  runtimePid,
  runtimeUser,
} from './built/runtime-io.js'
export * from './built/component.js'
export * from './built/database.js'
export * from './built/message-filter.js'
// Tool/Skill/AgentPreset Features (backward-compat; canonical source is @zhin.js/agent)
export * from './built/tool.js'
export * from './built/skill.js'
export * from './built/agent-preset.js'
export * from './built/common-adapter-tools.js'
// AI Trigger Service (纯工具，无副作用)
export * from './built/roles.js'
export * from './built/ai-trigger.js'
// MessageDispatcher (消息调度器)
export * from './built/dispatcher.js'
export { runInboundMessage } from './built/inbound-runner.js'
export type { RunInboundMessageOptions, InboundRunResult } from './built/inbound-runner.js'
export { connectEndpointInstance, disconnectEndpointInstance } from './built/connect-endpoint-instance.js'
export type { ConnectEndpointInstanceOptions } from './built/connect-endpoint-instance.js'
export { emitEndpointLifecycle } from './built/endpoint-lifecycle.js'
export type { EndpointLifecycleKind, EndpointLifecyclePayload } from './built/endpoint-lifecycle.js'
// Schema 注册表 (插件配置声明)
export * from './built/schema-feature.js'
// Login assist (producer-consumer for QR / SMS / slider etc.)
export * from './built/login-assist.js'

export * from './types.js'
export * from './agent-prompt.js'
export * from './utils.js'
export * from './errors.js'  // 导出错误处理系统
export * from '@zhin.js/database'
export * from '@zhin.js/logger'
// 只导出 Schema 类，避免与 utils.js 的 isEmpty 冲突
export { Schema } from '@zhin.js/schema'
// Re-export PluginLike from kernel (generic plugin interface)
export type { PluginLike } from '@zhin.js/kernel'
export {
  Feature,
  Cron,
  Scheduler,
  getScheduler,
  setScheduler,
} from '@zhin.js/kernel'
export type {
  FeatureJSON,
  FeatureListener,
  Schedule,
  JobPayload,
  JobState,
  ScheduledJob,
  JobStore,
  JobCallback,
  AddJobOptions,
  IScheduler,
  SchedulerOptions,
} from '@zhin.js/kernel'