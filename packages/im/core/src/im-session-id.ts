/**
 * IM 会话 ID 解析（SSOT 在 @zhin.js/kernel + im-scene）
 *
 * 格式：`platform:endpointId:kind:sceneId`
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
  $adapter?: string;
  $endpoint?: string;
  $channel?: { type?: IMSceneKind; id?: string };
  $sender?: { id?: string };
}): string {
  const scene = sceneRefFromMessage(message as any);
  if (scene) return resolveIMSceneSessionId(scene);
  const kind = (message.$channel?.type || 'private') as IMSceneKind;
  return resolveIMSessionId({
    platform: String(message.$adapter || ''),
    endpointId: String(message.$endpoint || ''),
    kind,
    sceneId: resolveIMSceneIdForSession(kind, message.$channel?.id, message.$sender?.id),
  });
}

/** Canonical scene fields for transcript / session persistence (ADR 0028 SSOT). */
export function resolveSceneFieldsFromMessage(message: {
  $adapter?: string;
  $endpoint?: string;
  $channel?: { type?: IMSceneKind; id?: string };
  $sender?: { id?: string };
}): {
  platform: string;
  endpointId: string;
  sceneId: string;
  sceneType: IMSceneKind;
} {
  const scene = sceneRefFromMessage(message as any);
  if (scene) {
    return {
      platform: scene.platform,
      endpointId: scene.endpointId,
      sceneId: scene.sceneId,
      sceneType: scene.kind,
    };
  }
  const sceneType = (message.$channel?.type || 'private') as IMSceneKind;
  return {
    platform: String(message.$adapter || ''),
    endpointId: String(message.$endpoint || ''),
    sceneType,
    sceneId: resolveIMSceneIdForSession(sceneType, message.$channel?.id, message.$sender?.id),
  };
}
