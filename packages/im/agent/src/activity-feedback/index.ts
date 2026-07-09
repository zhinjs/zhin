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
  getActivityFeedbackManager,
  initActivityFeedbackManager,
} from './manager.js';

export {
  PLATFORM_FEATURES,
  buildTypingSendContent,
  enableActivityFeedbackForBot,
  getAdapterActivityFeedbackManager,
  initAdapterActivityFeedbackManager,
  isGenericActivityFeedbackManager,
} from './adapter-integration.js';
export type {
  PlatformFeatures,
  EndpointWithActivityFeedback,
  PlatformActivityFeedbackManager,
  PlatformActivityFeedbackStartOptions,
  BotActivityFeedbackManager,
} from './adapter-integration.js';
