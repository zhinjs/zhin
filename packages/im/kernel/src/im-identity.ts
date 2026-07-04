/**
 * IM scene/session identity primitives (no Message / IM framework concepts).
 * SSOT for four-segment session keys: platform:endpointId:kind:sceneId
 */

export type IMSceneKind = 'private' | 'group' | 'channel';

export interface IMSceneIdentity {
  platform: string;
  endpointId: string;
  sceneId: string;
  kind: IMSceneKind;
}

export interface ResolveIMSessionIdInput {
  platform: string;
  endpointId: string;
  kind: IMSceneKind;
  sceneId: string;
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

export function resolveIMSceneSessionId(scene: IMSceneIdentity): string {
  const platform = String(scene.platform || 'unknown');
  const endpointId = scene.endpointId != null && scene.endpointId !== ''
    ? String(scene.endpointId)
    : '';
  const kind: IMSceneKind = scene.kind || 'private';
  const sceneId = String(scene.sceneId || 'unknown');
  return `${platform}:${endpointId}:${kind}:${sceneId}`;
}

export function resolveIMSessionId(input: ResolveIMSessionIdInput): string {
  return resolveIMSceneSessionId({
    platform: input.platform,
    endpointId: input.endpointId,
    kind: input.kind,
    sceneId: input.sceneId,
  });
}
