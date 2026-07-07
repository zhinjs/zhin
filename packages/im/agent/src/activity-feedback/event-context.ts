import type { TypingIndicatorOptions } from '../typing-indicator/index.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';
import type { ActivitySceneType } from './types.js';

/** 单次 activity phase 操作的归一化上下文（由 AI 事件 payload 解析） */
export interface ActivityFeedbackEventContext {
  platform: string;
  endpointId: string;
  sessionId: string;
  messageId?: string;
  sceneType: ActivitySceneType;
  userId?: string;
  groupId?: string;
  options: TypingIndicatorOptions;
}

const SYNTHETIC_SENDER_IDS = new Set(['system', 'cron', 'assistant']);

export function resolveActivitySceneType(payload: AIEventPayload): ActivitySceneType {
  const scope = payload.scope;
  if (scope === 'group' || scope === 'channel' || scope === 'private') return scope;
  const sceneId = payload.sceneId ?? '';
  if (sceneId.startsWith('group:')) return 'group';
  if (sceneId.startsWith('channel:')) return 'channel';
  return 'private';
}

export function resolveActivityEventTargets(
  payload: AIEventPayload,
  sceneType: ActivitySceneType,
): { userId?: string; groupId?: string } {
  const { sceneId, userId, sessionId } = payload;
  const parts = sessionId.split(':').filter((p) => p.length > 0);
  let resolvedUserId = userId;
  let groupId: string | undefined;

  if (sceneType === 'group' || sceneType === 'channel') {
    groupId = sceneId?.replace(/^(group|channel):/, '') || sceneId;
    if (!groupId && parts.length >= 3) groupId = parts[1];
    if (!resolvedUserId && parts.length >= 3) resolvedUserId = parts[parts.length - 1];
  } else {
    if (sceneId?.startsWith('private:')) resolvedUserId = sceneId.slice('private:'.length);
    else if (
      (!resolvedUserId || SYNTHETIC_SENDER_IDS.has(resolvedUserId))
      && sceneId
      && !SYNTHETIC_SENDER_IDS.has(sceneId)
    ) {
      resolvedUserId = sceneId;
    } else if (!resolvedUserId && parts.length >= 2) {
      resolvedUserId = parts.length >= 3 ? parts[parts.length - 1]! : parts[1];
    }
  }

  return { userId: resolvedUserId, groupId };
}

/** 将 AI 生命周期事件转为 activity 执行上下文 */
export function toActivityFeedbackEventContext(
  payload: AIEventPayload,
): ActivityFeedbackEventContext | null {
  const { platform, endpointId, sessionId } = payload;
  if (!platform || !endpointId) return null;

  const sceneType = resolveActivitySceneType(payload);
  const targets = resolveActivityEventTargets(payload, sceneType);

  return {
    platform,
    endpointId,
    sessionId,
    messageId: payload.messageId,
    sceneType,
    userId: targets.userId,
    groupId: targets.groupId,
    options: {
      platform,
      endpointId,
      sessionId,
      messageId: payload.messageId,
      sceneType,
      userId: targets.userId,
      groupId: targets.groupId,
    },
  };
}
