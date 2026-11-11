/**
 * Turn module — IM turn pipeline, scheduling, metrics.
 */

export { processTextTurn } from './turn-pipeline.js';
export type { ProcessTextTurnOptions } from './turn-pipeline.js';

export { executeAgentTurn } from './execute-agent-turn.js';
export { createJournalFeed, journalFeedOf } from './journal-feed.js';
export type { JournalFeed } from './journal-feed.js';
export type { TurnEventObserver, TurnEventSource } from './execute-agent-turn.js';
export { streamTurnEvents } from './turn-event-source.js';
export type { TurnEventSink, TurnEventSourceInput } from './turn-event-source.js';

export {
  createTurnIngress,
  turnPermissionSubject,
} from './turn-ingress.js';
export type {
  ActivityPort,
  DeliveryIntent,
  DeliveryOutcome,
  DeliveryPort,
  FrozenCapabilityCatalog,
  ImTurnOrigin,
  ReplyAnswerContext,
  ReplyPort,
  TurnIdentity,
  TurnAccessContext,
  TurnContextState,
  TurnIngress,
  TurnIngressInput,
  TurnIntent,
  TurnIntentKind,
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

export { TriggerCancelledError, TriggerTimeoutError } from './trigger-cancelled-error.js';

export { isCancelIntent } from './cancel-intent.js';

export { SessionMessageQueue } from './session-message-queue.js';

export {
  addUsage,
  EMPTY_USAGE,
  formatAiHandlerTurnTable,
  formatOutputElementsPreview,
} from './turn-metrics.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';

export { TurnTracker } from './turn-tracker.js';

export {
  DEFAULT_MAILBOX_CONFIG,
  DEFAULT_MAILBOX_LIVE_CONFIG,
  DEFAULT_MAILBOX_MERGE_CONFIG,
  MAILBOX_MIGRATION_HINT,
  normalizeMailboxConfig,
  validateMailboxConfig,
} from './mailbox-config.js';
export type { ResolvedMailboxConfig, ResolvedMailboxLiveConfig, ResolvedMailboxMergeConfig } from './mailbox-config.js';

export {
  runPromptTurn,
  steerMessage,
  followUpMessage,
  assertMasterForPromptControl,
} from './prompt-api.js';

export { PromptAccessDeniedError } from './prompt-access.js';

export { normalizePromptMessages } from './prompt-input.js';

export { computeDeferredDelta } from './turn-deferred-delta.js';
export { DeferredTurnState } from './deferred-turn-state.js';

export {
  getTurnActiveSkills,
  runInTurnContext,
  appendActiveSkills,
} from './turn-context-bridge.js';
export type { TurnContextBridgeState } from './turn-context-bridge.js';

export { DEFAULT_MAX_QUEUED_TURNS, LIVE_WINDOW_MAX_MESSAGES } from './turn-admission.js';
// ADR 0048 H3: same-session admission is the host Mailbox (replaces TurnAdmissionGate).
export { HostMailbox, type HostMailboxOptions } from '../collaboration/host-mailbox.js';
export { MailboxTurnRejectedError } from './mail-turn-runtime.js';
export {
  intersectCapabilities,
  narrowMergedAccess,
  ON_BEHALF_OF_ARG,
  resolveOnBehalfOf,
  withMergeMembers,
  type OnBehalfOfResolution,
} from './merged-principal.js';
export { isActingTurnEvent } from './stale-reply.js';
export {
  answeredMergedSenders,
  formatMergedTurnBlock,
  mergedReplyAuditPayload,
  MERGED_TURN_HEADER,
  type TurnMergedSender,
} from './merged-turn-context.js';
export {
  formatLiveDanmakuBlock,
  LIVE_DANMAKU_HEADER,
  liveReplyAuditPayload,
  readOnlyCapabilities,
  type TurnLiveDanmaku,
  type TurnLiveDanmakuMode,
} from './live-turn-context.js';
export type {
  TurnAdmission,
  TurnAdmissionFacts,
  TurnAdmissionRejectReason,
  TurnAdmissionRequest,
  TurnLiveWindowSnapshot,
  TurnMergeWindowSnapshot,
  TurnParticipant,
  TurnStaleVerdict,
  TurnStopResult,
} from './turn-admission.js';

// Host-integration seam for external host packages.
export { getAgentTurnConfiguration, runWithAgentTurnConfiguration } from './agent-turn-context.js';

export {
  AGENT_TURN_CHECKPOINT_MODEL,
  AGENT_TURN_CHECKPOINT_TABLE,
  DEFAULT_TURN_CHECKPOINT_TTL_MS,
  DatabaseTurnCheckpointStorage,
  TurnCheckpointStore,
  extractCompletedToolRoundMessages,
  isCheckpointResumePrompt,
} from './turn-checkpoint-store.js';
export type {
  TurnCheckpointRecord,
  TurnCheckpointStorage,
  TurnCheckpointStoreOptions,
} from './turn-checkpoint-store.js';

