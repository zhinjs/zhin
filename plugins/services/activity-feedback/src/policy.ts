import {
  resolveActivityFeedbackPhaseConfig,
  type ActivityFeedbackPhase,
  type ActivitySceneType,
  type ResolvedActivityFeedbackPhaseConfig,
} from '@zhin.js/agent';
import {
  type ActivityFeedbackServiceConfig,
  mergeActivityFeedbackLayers,
  loadActivityFeedbackServiceConfig,
} from './config.js';

export type { ActivityFeedbackServiceConfig } from './config.js';
export { loadActivityFeedbackServiceConfig, resolveActivityFeedbackForTarget } from './config.js';

export type PhaseResolution =
  | { kind: 'disabled' }
  | { kind: 'none' }
  | { kind: 'active'; config: ResolvedActivityFeedbackPhaseConfig };

export class ActivityFeedbackPolicy {
  constructor(private readonly service: ActivityFeedbackServiceConfig) {}

  resolvePhase(
    platform: string,
    endpointId: string,
    phase: ActivityFeedbackPhase,
    sceneType: ActivitySceneType,
  ): PhaseResolution {
    if (this.service.enabled === false) {
      return { kind: 'disabled' };
    }

    const policy = mergeActivityFeedbackLayers(
      this.service.defaults,
      this.service.platforms?.[platform],
      this.service.endpoints?.[`${platform}:${endpointId}`],
    );

    if (policy?.enabled === false) {
      return { kind: 'disabled' };
    }

    const config = resolveActivityFeedbackPhaseConfig(platform, policy, phase, sceneType);
    if (config.type === 'none') {
      return { kind: 'none' };
    }

    return { kind: 'active', config };
  }
}
