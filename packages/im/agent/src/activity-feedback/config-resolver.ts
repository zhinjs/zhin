import { PLATFORM_FEATURES } from '../typing-indicator/adapter-integration.js';
import type {
  ActivityFeedbackConfig,
  ActivityFeedbackPhase,
  ActivityFeedbackPhaseConfig,
  ActivitySceneType,
  ResolvedActivityFeedbackPhaseConfig,
} from './types.js';

import type { Locale } from '@zhin.js/plugin-runtime';
import { activityMessages } from './messages.js';

function sceneKey(sceneType: ActivitySceneType): keyof ActivityFeedbackConfig['phases'] extends infer _ ? 'private' | 'group' | 'channel' : never {
  return sceneType;
}

function resolvePlatformPhaseDefault(
  platform: string,
  phase: ActivityFeedbackPhase,
  locale?: Locale,
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
      return { type: 'reaction', emoji: activityMessages(locale, 'queued'), autoRemove: true };
    }
    return { type: 'none' };
  }

  if (phase === 'thinking') {
    if (features.supportsEdit) {
      return { type: 'message', message: activityMessages(locale, 'thinking'), autoRemove: true };
    }
    if (features.supportsReaction) {
      return { type: 'reaction', emoji: activityMessages(locale, 'queued'), autoRemove: true };
    }
    if (features.supportsTyping) {
      return { type: 'typing', autoRemove: true };
    }
    return { type: 'message', message: activityMessages(locale, 'thinking'), autoRemove: true };
  }

  if (phase === 'schedule_start' || phase === 'schedule_finish' || phase === 'schedule_error') {
    return { type: 'message', message: activityMessages(locale, phase), autoRemove: true };
  }

  // active
  // Group-oriented reaction APIs (icqq GROUP_SET_REACTION, etc.) do not work in
  // private chats — fall back to a short status message (classic typingIndicator).
  if (features.defaultType === 'reaction') {
    return { type: 'reaction', emoji: activityMessages(locale, 'queued'), autoRemove: true };
  }
  if (features.defaultType === 'typing') {
    return { type: 'typing', autoRemove: true };
  }
  if (features.defaultType === 'none') {
    return { type: 'message', message: activityMessages(locale, 'active'), autoRemove: true };
  }
  return { type: 'message', message: activityMessages(locale, 'active'), autoRemove: true };
}

function resolvePrivateSceneDefault(
  platform: string,
  phase: ActivityFeedbackPhase,
  locale?: Locale,
): ResolvedActivityFeedbackPhaseConfig {
  const groupDefault = resolvePlatformPhaseDefault(platform, phase, locale);
  if (groupDefault.type !== 'reaction') return groupDefault;
  // Private: reaction → status message (icqq / napcat group-only emoji APIs).
  if (phase === 'queued' || phase === 'active' || phase === 'thinking') {
    return {
      type: 'message',
      message: phase === 'thinking'
        ? activityMessages(locale, 'thinking')
        : phase === 'queued'
          ? '⏳'
          : activityMessages(locale, 'active'),
      autoRemove: true,
    };
  }
  return groupDefault;
}

export function resolveActivityFeedbackPhaseConfig(
  platform: string,
  endpointConfig: ActivityFeedbackConfig | undefined,
  phase: ActivityFeedbackPhase,
  sceneType: ActivitySceneType,
  locale?: Locale,
): ResolvedActivityFeedbackPhaseConfig {
  if (endpointConfig?.enabled === false) {
    return { type: 'none' };
  }

  const sceneCfg = endpointConfig?.phases?.[phase]?.[sceneKey(sceneType)];
  const defaults = sceneType === 'private'
    ? resolvePrivateSceneDefault(platform, phase, locale)
    : resolvePlatformPhaseDefault(platform, phase, locale);
  const merged: ActivityFeedbackPhaseConfig = { ...defaults, ...sceneCfg };

  if (merged.type === 'none') {
    return { type: 'none' };
  }

  // Private + reaction only when the scene config explicitly asks for it.
  // Otherwise coerce to message (icqq GROUP_SET_REACTION is group-only).
  let type = merged.type ?? defaults.type;
  if (type === 'reaction' && sceneType === 'private' && sceneCfg?.type !== 'reaction') {
    type = 'message';
  }

  if (type === 'reaction') {
    return {
      type: 'reaction',
      emoji: merged.emoji ?? defaults.emoji ?? activityMessages(locale, 'queued'),
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
    message: merged.message ?? defaults.message ?? activityMessages(locale, phase),
    autoRemove: merged.autoRemove ?? true,
    removeDelay: merged.removeDelay,
    platformConfig: merged.platformConfig,
  };
}
