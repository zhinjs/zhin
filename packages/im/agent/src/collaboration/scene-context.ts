/**
 * CellContext session key — cross-endpoint coordination projection layer.
 * Does not replace transport session keys (per ADR 0023 D4).
 */

import type { IMSceneKind } from '@zhin.js/core';
import { getSceneIdentityService } from './scene-identity-service.js';

export function resolveCollaborationSceneContextKey(adapter: string, sceneId: string): string {
  const svc = getSceneIdentityService();
  const cell = svc.resolveLogicalScene(adapter, sceneId);
  if (cell) return `collab-scene:${cell.id}`;
  return `collab-scene:${String(adapter || 'unknown')}:${String(sceneId || 'unknown')}`;
}

export function resolveCollaborationSceneContextKeyFromMessage(message: {
  $adapter?: string;
  $channel?: { type?: IMSceneKind; id?: string };
  $sender?: { id?: string };
}): string | undefined {
  const scope = message.$channel?.type || 'private';
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  return resolveCollaborationSceneContextKey(String(message.$adapter || ''), sceneId);
}
