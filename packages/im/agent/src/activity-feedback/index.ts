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
  buildTypingSendContent,
  enableActivityFeedbackForBot,
  isGenericActivityFeedbackManager,
} from './adapter-integration.js';
export type {
  ActivityFeedbackKindCapabilities,
  EndpointWithActivityFeedback,
  ActivityFeedbackSendPort,
  PlatformActivityFeedbackManager,
  PlatformActivityFeedbackStartOptions,
  BotActivityFeedbackManager,
} from './adapter-integration.js';
