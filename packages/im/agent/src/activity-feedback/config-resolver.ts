import { PLATFORM_FEATURES } from '../typing-indicator/adapter-integration.js';
import type {
  ActivityFeedbackConfig,
  ActivityFeedbackPhase,
  ActivityFeedbackPhaseConfig,
  ActivitySceneType,
  ResolvedActivityFeedbackPhaseConfig,
} from './types.js';

const PHASE_DEFAULT_MESSAGE: Record<ActivityFeedbackPhase, string> = {
  queued: '⏳',
  active: '正在处理中...',
  thinking: '思考中...',
};

function sceneKey(sceneType: ActivitySceneType): keyof ActivityFeedbackConfig['phases'] extends infer _ ? 'private' | 'group' | 'channel' : never {
  return sceneType;
}

function resolvePlatformPhaseDefault(
  platform: string,
  phase: ActivityFeedbackPhase,
): ResolvedActivityFeedbackPhaseConfig {
  const features = PLATFORM_FEATURES[platform] ?? {
    platform,
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message' as const,
  };

  if (phase === 'queued') {
    if (features.supportsReaction) {
      return { type: 'reaction', emoji: PHASE_DEFAULT_MESSAGE.queued, autoRemove: true };
    }
    return { type: 'none' };
  }

  if (phase === 'thinking') {
    if (features.supportsEdit) {
      return { type: 'message', message: PHASE_DEFAULT_MESSAGE.thinking, autoRemove: true };
    }
    if (features.supportsReaction) {
      return { type: 'reaction', emoji: PHASE_DEFAULT_MESSAGE.queued, autoRemove: true };
    }
    if (features.supportsTyping) {
      return { type: 'typing', autoRemove: true };
    }
    return { type: 'message', message: PHASE_DEFAULT_MESSAGE.thinking, autoRemove: true };
  }

  // active
  const type = features.defaultType === 'none' ? 'message' : features.defaultType;
  if (type === 'reaction') {
    return { type: 'reaction', emoji: PHASE_DEFAULT_MESSAGE.queued, autoRemove: true };
  }
  if (type === 'typing') {
    return { type: 'typing', autoRemove: true };
  }
  return { type: 'message', message: PHASE_DEFAULT_MESSAGE.active, autoRemove: true };
}

export function resolveActivityFeedbackPhaseConfig(
  platform: string,
  endpointConfig: ActivityFeedbackConfig | undefined,
  phase: ActivityFeedbackPhase,
  sceneType: ActivitySceneType,
): ResolvedActivityFeedbackPhaseConfig {
  if (endpointConfig?.enabled === false) {
    return { type: 'none' };
  }

  const sceneCfg = endpointConfig?.phases?.[phase]?.[sceneKey(sceneType)];
  const defaults = resolvePlatformPhaseDefault(platform, phase);
  const merged: ActivityFeedbackPhaseConfig = { ...defaults, ...sceneCfg };

  if (merged.type === 'none') {
    return { type: 'none' };
  }

  const type = merged.type ?? defaults.type;
  if (type === 'reaction') {
    return {
      type: 'reaction',
      emoji: merged.emoji ?? defaults.emoji ?? PHASE_DEFAULT_MESSAGE.queued,
      autoRemove: merged.autoRemove ?? true,
      removeDelay: merged.removeDelay,
      platformConfig: merged.platformConfig,
    };
  }
  if (type === 'typing') {
    return {
      type: 'typing',
      autoRemove: merged.autoRemove ?? true,
      removeDelay: merged.removeDelay,
      platformConfig: merged.platformConfig,
    };
  }
  return {
    type: 'message',
    message: merged.message ?? defaults.message ?? PHASE_DEFAULT_MESSAGE[phase],
    autoRemove: merged.autoRemove ?? true,
    removeDelay: merged.removeDelay,
    platformConfig: merged.platformConfig,
  };
}
