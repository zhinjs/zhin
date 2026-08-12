/**
 * IM scene/session identity primitives (no Message / IM framework concepts).
 * SSOT for four-segment session keys: platform:endpointKey:kind:sceneId
 */

export type IMSceneKind = 'private' | 'group' | 'channel';

export interface IMSceneIdentity {
  platform: string;
  endpointKey: string;
  sceneId: string;
  kind: IMSceneKind;
}

export interface ResolveIMSessionIdInput {
  platform: string;
  endpointKey: string;
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
  const endpointKey = scene.endpointKey != null && scene.endpointKey !== ''
    ? String(scene.endpointKey)
    : '';
  const kind: IMSceneKind = scene.kind || 'private';
  const sceneId = String(scene.sceneId || 'unknown');
  return `${platform}:${endpointKey}:${kind}:${sceneId}`;
}

export function resolveIMSessionId(input: ResolveIMSessionIdInput): string {
  return resolveIMSceneSessionId({
    platform: input.platform,
    endpointKey: input.endpointKey,
    kind: input.kind,
    sceneId: input.sceneId,
  });
}
