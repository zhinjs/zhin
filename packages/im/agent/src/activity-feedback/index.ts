export type {
  ActivityFeedbackType,
  ActivityFeedbackPhase,
  ActivitySceneType,
  ActivityFeedbackPhaseConfig,
  ActivityFeedbackScenePhases,
  ActivityFeedbackConfig,
  ResolvedActivityFeedbackPhaseConfig,
} from './types.js';
export { toTypingIndicatorConfig } from './types.js';

export {
  resolveActivityFeedbackPhaseConfig,
} from './config-resolver.js';
export { isActivityFeedbackEnabled } from './schedule-guard.js';
export type { ActivityFeedbackGatePhase } from './schedule-guard.js';

export {
  toActivityFeedbackEventContext,
  resolveActivitySceneType,
  resolveActivityEventTargets,
  type ActivityFeedbackEventContext,
} from './event-context.js';

export {
  ActivityFeedbackManager,
} from './manager.js';

export {
  buildTypingSendContent,
  createActivityFeedbackAdapter,
} from './adapter-integration.js';
export type {
  ActivityFeedbackKindCapabilities,
  ActivityFeedbackIO,
} from './adapter-integration.js';

export { activityFeedbackSource, bindActivityFeedbackSource } from './operation-source.js';
export type { ActivityFeedbackSource, ActivityFeedbackSourceCarrier } from './operation-source.js';
