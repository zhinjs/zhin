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
  resolveSubagentActivityTag,
  formatSubagentActivityPrefix,
  withSubagentActivityPrefix,
  applySubagentActivityPrefixToConfig,
  resolveActivityFeedbackSessionId,
} from './subagent-prefix.js';

export {
  ActivityFeedbackManager,
} from './manager.js';

export {
  PLATFORM_FEATURES,
  buildTypingSendContent,
  createActivityFeedbackAdapter,
} from './adapter-integration.js';
export type {
  PlatformFeatures,
  ActivityFeedbackIO,
} from './adapter-integration.js';

export { activityFeedbackSource, bindActivityFeedbackSource } from './operation-source.js';
export type { ActivityFeedbackSource, ActivityFeedbackSourceCarrier } from './operation-source.js';
