/**
 * Canonical IM messages, Endpoints, rendering, and plugin-facing core types.
 * @module @zhin.js/core
 */
export { defineComponent, type ComponentDefinition, type ComponentContext } from '@zhin.js/component'
export { component, type ComponentCall, raw, type RawContent } from './plugin-runtime/im/contracts.js'
export type { MessageChannel, MessageType } from './message.js'
export { Message, type MessageBase } from './plugin-runtime/im/contracts.js'
export * from './im-scene.js'
export * from './notice.js'
export * from './request.js'
export * from './system-event.js'
export * from './side-event/index.js'
export type * from '@zhin.js/interaction'
export * from './types.js'
export * from './utils.js'
export * from './errors.js'
// Tool-free AI completion contract for plugins; provided by @zhin.js/agent when AI is configured (#877)
export * from './ai-completion-contract.js'

// ── Built 模块 ──────────────────────────────────────────────────────
// Models
export * from './models/system-log.js'
export * from './models/user.js'
export * from './built/message-enrich.js'
export type { AgentTurnMessage, SyntheticMessageInput } from './built/message-enrich.js'
export * from './built/tool-access.js'
export * from './built/common-adapter-tools.js'
export * from './built/roles.js'
export * from './im-session-id.js'
export * from './built/ai-trigger.js'
export * from './built/ai-access.js'
export * from './built/login-assist.js'
export * from './built/generated-qrcode.js'
export { markdownToPlainText } from './built/rich-segments/markdown-to-text.js'
export * from './built/interactive-segments/index.js'
export * from './built/user-interaction.js'
export * from './built/ai-outbound/index.js'
export * from './built/outbound-media-utils.js'
export * from './built/segment-contract/index.js'
export type { SegmentMediaRef } from './built/segment-contract/media.js'
export * from './built/generic-segment-mapper.js'
export * from './built/html-to-text.js'
export * from './built/html-segment-fallback.js'

// ── 外部库 re-export ──────────────────────────────────────────────────
export * from '@zhin.js/database'
export * from '@zhin.js/logger'
export { Schema } from '@zhin.js/schema'
export {
  ScheduleEngine,
  Scheduler,
} from '@zhin.js/kernel'
export type {
  Schedule,
  JobPayload,
  JobState,
  ScheduledJob,
  JobStore,
  JobCallback,
  AddJobOptions,
  IScheduler,
  SchedulerOptions,
  ScheduleFireCallback,
  MemoryScheduleRegistration,
  ScheduleEngineOptions,
  JobContext,
  ResolvedJob,
  ScheduleKind,
} from '@zhin.js/kernel'
// IM contract / capability types surfaced through `zhin.js` so toolkits (e.g. `@zhin.js/testing`)
// can type against the app's single core tree instead of pinning their own copies.
export type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract'
export { conversationRefKey } from '@zhin.js/im-contract'
export { readOperationSession } from '@zhin.js/feature-kit'
export type { CapabilityContext, OperationClientPort, OperationSession, OperationScene, OperationSender, OperationMessage, OperationMessageRef } from '@zhin.js/feature-kit'
