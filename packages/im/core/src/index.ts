/**
 * Canonical IM messages, Endpoints, rendering, and plugin-facing core types.
 * @module @zhin.js/core
 */
export * from './plugin.js'
export * from './component.js'
export * from './message.js'
export * from './im-scene.js'
export * from './notice.js'
export * from './request.js'
export * from './system-event.js'
export * from './side-event/index.js'
export type * from '@zhin.js/interaction'
export * from './types.js'
export * from './utils.js'
export * from './errors.js'

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
export * from './built/dispatcher.js'
export * from './built/login-assist.js'
export * from './built/generated-qrcode.js'
export * from './built/rich-segments/index.js'
export * from './built/interactive-segments/index.js'
export * from './built/user-interaction.js'
export * from './built/ai-outbound/index.js'
export { loadHtmlRenderer, seedHtmlRenderer, HTML_RENDERER_PACKAGE } from './built/html-renderer-loader.js'
export { loadSpeechPipeline, seedSpeechPipeline, SPEECH_PACKAGE } from './built/speech-loader.js'
export * from './built/outbound-media-utils.js'
export * from './built/outbound-media-contract.js'
export * from './built/segment-contract/index.js'
export type { SegmentMediaRef } from './built/segment-contract/media.js'
export * from './built/generic-segment-mapper.js'
export * from './built/inbound-runner.js'
export type { RunInboundMessageOptions, InboundRunResult } from './built/inbound-runner.js'
export * from './built/management-command-guard.js'
export * from './built/html-to-text.js'
export * from './built/html-segment-fallback.js'

// ── 外部库 re-export ──────────────────────────────────────────────────
export * from '@zhin.js/database'
export * from '@zhin.js/logger'
export { Schema } from '@zhin.js/schema'
export type { PluginLike } from '@zhin.js/kernel'
export {
  Feature,
  ScheduleEngine,
  getScheduleEngine,
  setScheduleEngine,
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
  ScheduleFireCallback,
  MemoryScheduleRegistration,
  ScheduleEngineOptions,
  JobContext,
  ResolvedJob,
  ScheduleKind,
} from '@zhin.js/kernel'
