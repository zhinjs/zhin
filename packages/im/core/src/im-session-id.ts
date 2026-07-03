/**
 * IM 会话 ID 解析（无 AI 依赖）
 *
 * 格式：`platform:endpointId:kind:sceneId`
 */

import {
  resolveIMSceneSessionId,
  sceneRefFromMessage,
  type IMSceneKind,
  type IMSceneRef,
} from './im-scene.js';

export type { IMSceneKind };

export interface ResolveIMSessionIdInput {
  platform: string;
  endpointId: string;
  kind: IMSceneKind;
  sceneId: string;
}

export function resolveIMSessionId(input: ResolveIMSessionIdInput): string {
  return resolveIMSceneSessionId({
    platform: input.platform,
    endpointId: input.endpointId,
    kind: input.kind,
    sceneId: input.sceneId,
  });
}

export function resolveIMSessionIdFromScene(scene: IMSceneRef): string {
  return resolveIMSceneSessionId(scene);
}

export function resolveIMSceneIdForSession(
  kind: IMSceneKind,
  sceneId?: string,
  senderId?: string,
): string {
  if (kind === 'group' || kind === 'channel') {
    return sceneId || senderId || 'unknown';
  }
  return senderId || sceneId || 'unknown';
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
