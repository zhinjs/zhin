import type { ActivityFeedbackKindCapabilities } from '../typing-indicator/adapter-integration.js';
import type {
  ActivityFeedbackConfig,
  ActivityFeedbackPhase,
  ActivityFeedbackPhaseConfig,
  ActivitySceneType,
  ResolvedActivityFeedbackPhaseConfig,
} from './types.js';

import type { Locale } from '@zhin.js/plugin-runtime';
import { activityMessages } from './messages.js';

function sceneKey(sceneType: ActivitySceneType): 'private' | 'group' | 'channel' {
  return sceneType;
}

/**
 * How to show "working on it" (ADR 0044). Driven by the Endpoint's declared capabilities for this
 * conversation kind: `feedback.mode` picks the way, `feedback.emoji` / `feedback.text` its content,
 * and what the Bot cannot do here (reaction, edit, recall) is never chosen. Nothing declared = the
 * conservative status message.
 */
function resolvePlatformPhaseDefault(
  kind: ActivityFeedbackKindCapabilities | undefined,
  phase: ActivityFeedbackPhase,
  locale?: Locale,
): ResolvedActivityFeedbackPhaseConfig {
  const feedback = kind?.feedback;
  const supportsReaction = kind?.reaction === true;
  const supportsEdit = kind?.edit === true;
  const supportsTyping = feedback?.mode === 'typing';
  const emoji = feedback?.emoji ?? activityMessages(locale, 'queued');
  const statusText = feedback?.text ?? activityMessages(locale, 'active');
  const platformConfig = feedback?.refreshSeconds
    ? { platformConfig: { keepaliveIntervalMs: feedback.refreshSeconds * 1000 } }
    : {};

  if (phase === 'queued') {
    if (supportsReaction) {
      return { type: 'reaction', emoji, autoRemove: true };
    }
    // The Endpoint prefers reactions but cannot react in this conversation kind: show the marker as text.
    if (feedback?.mode === 'reaction') {
      return { type: 'message', message: emoji, autoRemove: true };
    }
    return { type: 'none' };
  }

  if (phase === 'thinking') {
    if (supportsEdit) {
      return { type: 'message', message: activityMessages(locale, 'thinking'), autoRemove: true };
    }
    if (supportsReaction) {
      return { type: 'reaction', emoji, autoRemove: true };
    }
    if (supportsTyping) {
      return { type: 'typing', autoRemove: true, ...platformConfig };
    }
    return { type: 'message', message: activityMessages(locale, 'thinking'), autoRemove: true };
  }

  if (phase === 'schedule_start' || phase === 'schedule_finish' || phase === 'schedule_error') {
    return { type: 'message', message: activityMessages(locale, phase), autoRemove: true };
  }

  // active
  if (feedback?.mode === 'reaction' && supportsReaction) {
    return { type: 'reaction', emoji, autoRemove: true };
  }
  if (feedback?.mode === 'typing') {
    return { type: 'typing', autoRemove: true, ...platformConfig };
  }
  if (feedback?.mode === 'none') {
    return { type: 'none' };
  }
  return { type: 'message', message: statusText, autoRemove: true };
}

export function resolveActivityFeedbackPhaseConfig(
  kind: ActivityFeedbackKindCapabilities | undefined,
  endpointConfig: ActivityFeedbackConfig | undefined,
  phase: ActivityFeedbackPhase,
  sceneType: ActivitySceneType,
  locale?: Locale,
): ResolvedActivityFeedbackPhaseConfig {
  if (endpointConfig?.enabled === false) {
    return { type: 'none' };
  }

  const sceneCfg = endpointConfig?.phases?.[phase]?.[sceneKey(sceneType)];
  const defaults = resolvePlatformPhaseDefault(kind, phase, locale);
  const merged: ActivityFeedbackPhaseConfig = { ...defaults, ...sceneCfg };

  if (merged.type === 'none') {
    return { type: 'none' };
  }

  // A reaction the Endpoint cannot make in this conversation kind is only used when the operator's
  // scene config explicitly asks for it; otherwise it degrades to a status message.
  let type = merged.type ?? defaults.type;
  if (type === 'reaction' && kind?.reaction !== true && sceneCfg?.type !== 'reaction') {
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
