/**
 * Turn module — IM turn pipeline, scheduling, metrics, multimodal helpers.
 */

export { processTextTurn, processMultimodalTurn } from './turn-pipeline.js';
export type { ProcessTextTurnOptions } from './turn-pipeline.js';

export { processTextTurnStream } from './process-stream.js';

export {
  PromptController,
  TurnSupersededError,
} from './prompt-controller.js';
export type { PromptTurnHooks, PromptTurnRequest } from './prompt-controller.js';

export { SessionMessageQueue } from './session-message-queue.js';

export {
  addUsage,
  EMPTY_USAGE,
  formatAiHandlerCompleteLog,
  formatZhinAgentTurnUsage,
} from './turn-metrics.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';

export { TurnTracker } from './turn-tracker.js';

export {
  summarizeMultimodalParts,
  buildVisionUserMessage,
} from './multimodal-message.js';

export {
  InboundTurnQueue,
  InboundTurnExpiredError,
} from './inbound-turn-queue.js';
export type { InboundQueueActivityEmitter } from './inbound-turn-queue.js';

export {
  DEFAULT_INBOUND_QUEUE_CONFIG,
  normalizeInboundQueueConfig,
  validateInboundQueueConfig,
  isGroupOrChannelMessage,
  shouldUseGroupFifoQueue,
} from './inbound-queue-config.js';
export type { ResolvedInboundQueueConfig } from './inbound-queue-config.js';

export { createInboundTurnQueue, runWithInboundQueue } from './inbound-queue-runtime.js';

export {
  continueAfterDeferredWorker,
  continueAfterSubagent,
} from './auto-continue.js';
export type { AutoContinueHost } from './auto-continue.js';

export {
  runPromptTurn,
  steerMessage,
  followUpMessage,
  assertMasterForPromptControl,
} from './prompt-api.js';

export { PromptAccessDeniedError } from './prompt-access.js';

export { normalizePromptMessages } from './prompt-input.js';

export { extractDeferredBody, deliverDeferredWorkerResult, deliverDeferredAutoContinueReply } from './deferred-delivery.js';

export {
  DEFERRED_AUTO_CONTINUE_MARKER,
  isDeferredAutoContinueEnabled,
  shouldDeferredAutoContinue,
  buildDeferredAutoContinueUserMessage,
} from './deferred-auto-continue.js';

export {
  SUBAGENT_AUTO_CONTINUE_MARKER,
  buildSubagentAutoContinueUserMessage,
} from './subagent-auto-continue.js';

export { persistDeferredWorkerResultToContext } from './persist-deferred-context.js';
export { persistSubagentResultToContext } from './persist-subagent-context.js';

export { computeDeferredDelta } from './turn-deferred-delta.js';

export {
  initScheduleTurnContext,
  initInboundTurnContext,
  getTurnActiveSkills,
  runInTurnContext,
  appendActiveSkills,
} from './turn-context-bridge.js';
export type { TurnContextBridgeState } from './turn-context-bridge.js';

export {
  TaskContinuationManager,
  decomposeTask,
  getContinuationManager,
  initContinuationManager,
} from './task-continuation.js';
export type {
  TaskStatus,
  TaskProgress,
  TaskDecomposition,
} from './task-continuation.js';
