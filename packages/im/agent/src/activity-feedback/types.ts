import type { TypingIndicatorConfig, TypingIndicatorType } from '../typing-indicator/index.js';

export type ActivityFeedbackType = TypingIndicatorType;
export type ActivityFeedbackPhase = 'queued' | 'active' | 'thinking';
export type ActivitySceneType = 'private' | 'group' | 'channel';

export interface ActivityFeedbackPhaseConfig {
  type?: ActivityFeedbackType;
  emoji?: string;
  message?: string;
  autoRemove?: boolean;
  removeDelay?: number;
  platformConfig?: Record<string, unknown>;
}

export interface ActivityFeedbackScenePhases {
  private?: ActivityFeedbackPhaseConfig;
  group?: ActivityFeedbackPhaseConfig;
  channel?: ActivityFeedbackPhaseConfig;
}

export interface ActivityFeedbackConfig {
  enabled?: boolean;
  phases?: Partial<Record<ActivityFeedbackPhase, ActivityFeedbackScenePhases>>;
}

export type ResolvedActivityFeedbackPhaseConfig = Required<
  Pick<ActivityFeedbackPhaseConfig, 'type'>
> & ActivityFeedbackPhaseConfig;

export function toTypingIndicatorConfig(
  phase: ResolvedActivityFeedbackPhaseConfig,
): Partial<TypingIndicatorConfig> {
  return {
    type: phase.type,
    emoji: phase.emoji,
    message: phase.message,
    autoRemove: phase.autoRemove,
    removeDelay: phase.removeDelay,
    platformConfig: phase.platformConfig,
  };
}
