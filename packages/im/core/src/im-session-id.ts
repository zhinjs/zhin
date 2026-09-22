/**
 * IM 会话 ID 解析（SSOT 在 @zhin.js/kernel + im-scene）
 *
 * 格式：`platform:endpointKey:kind:sceneId`
 */

import {
  resolveIMSceneIdForSession as resolveIMSceneIdForSessionKernel,
  resolveIMSessionId as resolveIMSessionIdKernel,
  type ResolveIMSessionIdInput,
} from '@zhin.js/kernel';
import {
  resolveIMSceneSessionId,
  sceneRefFromMessage,
  type IMSceneKind,
  type IMSceneRef,
} from './im-scene.js';

export type { IMSceneKind, ResolveIMSessionIdInput };

export function resolveIMSessionId(input: ResolveIMSessionIdInput): string {
  return resolveIMSessionIdKernel(input);
}

export function resolveIMSessionIdFromScene(scene: IMSceneRef): string {
  return resolveIMSceneSessionId(scene);
}

export function resolveIMSceneIdForSession(
  kind: IMSceneKind,
  sceneId?: string,
  senderId?: string,
): string {
  return resolveIMSceneIdForSessionKernel(kind, sceneId, senderId);
}

export function resolveIMSessionIdFromMessage(message: {
  clientAdapter?: string;
  endpointId?: string;
  conversation?: { endpoint: { adapter: string; id: string }; kind: IMSceneKind; id: string };
  sender?: { id?: string };
}): string {
  const scene = sceneRefFromMessage(message as any);
  if (scene) return resolveIMSceneSessionId(scene);
  const kind = (message.conversation?.kind || 'private') as IMSceneKind;
  return resolveIMSessionId({
    platform: String(message.clientAdapter || message.conversation?.endpoint.adapter || ''),
    endpointKey: String(message.endpointId || message.conversation?.endpoint.id || ''),
    kind,
    sceneId: resolveIMSceneIdForSession(kind, message.conversation?.id, message.sender?.id),
  });
}

/** Canonical scene fields for transcript / session persistence (ADR 0028 SSOT). */
export function resolveSceneFieldsFromMessage(message: {
  clientAdapter?: string;
  endpointId?: string;
  conversation?: { endpoint: { adapter: string; id: string }; kind: IMSceneKind; id: string };
  sender?: { id?: string };
}): {
  platform: string;
  endpointKey: string;
  sceneId: string;
  sceneType: IMSceneKind;
} {
  const scene = sceneRefFromMessage(message as any);
  if (scene) {
    return {
      platform: scene.platform,
      endpointKey: scene.endpointKey,
      sceneId: scene.sceneId,
      sceneType: scene.kind,
    };
  }
  const sceneType = (message.conversation?.kind || 'private') as IMSceneKind;
  return {
    platform: String(message.clientAdapter || message.conversation?.endpoint.adapter || ''),
    endpointKey: String(message.endpointId || message.conversation?.endpoint.id || ''),
    sceneType,
    sceneId: resolveIMSceneIdForSession(sceneType, message.conversation?.id, message.sender?.id),
  };
}
