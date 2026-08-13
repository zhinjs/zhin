/**
 * Turn module — IM turn pipeline, scheduling, metrics.
 */

export { processTextTurn } from './turn-pipeline.js';
export type { ProcessTextTurnOptions } from './turn-pipeline.js';

export { executeAgentTurn } from './execute-agent-turn.js';
export type { TurnEventObserver, TurnEventSource } from './execute-agent-turn.js';
export { streamTurnEvents } from './turn-event-source.js';
export type { TurnEventSink, TurnEventSourceInput } from './turn-event-source.js';

export {
  createTurnIngress,
  resolveTurnContextValue,
  turnPermissionSubject,
} from './turn-ingress.js';
export type {
  ActivityPort,
  DeliveryIntent,
  DeliveryOutcome,
  DeliveryPort,
  FrozenCapabilityCatalog,
  ReplyPort,
  TurnIdentity,
  TurnAccessContext,
  TurnIngress,
  TurnIngressInput,
  TurnJournalPort,
  TurnInput,
  TurnMedia,
  TurnOrigin,
  TurnOutcome,
  TurnPolicyContext,
  TurnPorts,
  TurnPrincipal,
  TurnRequest,
  TurnRequestPorts,
  TurnScope,
  TurnSessionAddress,
} from './turn-ingress.js';

export { processTextTurnStream } from './process-stream.js';

export {
  PromptController,
  TurnCancelledError,
  TurnSupersededError,
} from './prompt-controller.js';
export type { PromptTurnHooks, PromptTurnRequest } from './prompt-controller.js';

export { SessionMessageQueue } from './session-message-queue.js';

export {
  addUsage,
  EMPTY_USAGE,
  formatAiHandlerCompleteLog,
  formatAiHandlerTurnTable,
  formatOutputElementsPreview,
  formatZhinAgentTurnUsage,
} from './turn-metrics.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';

export { TurnTracker } from './turn-tracker.js';

export {
  InboundTurnQueue,
  InboundTurnCancelledError,
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
export { DeferredTurnState } from './deferred-turn-state.js';

export {
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
