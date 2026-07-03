/**
 * CellContext session key — cross-endpoint coordination projection layer.
 * Does not replace transport session keys (per ADR 0023 D4).
 */

import type { IMSceneKind } from '@zhin.js/core';
import { getSceneIdentityService } from './scene-identity-service.js';

export function resolveCellContextKey(adapter: string, sceneId: string): string {
  const svc = getSceneIdentityService();
  const cell = svc.resolveLogicalCell(adapter, sceneId);
  if (cell) return `cell:${cell.id}`;
  return `cell:${String(adapter || 'unknown')}:${String(sceneId || 'unknown')}`;
}

export function resolveCellContextKeyFromMessage(message: {
  $adapter?: string;
  $channel?: { type?: IMSceneKind; id?: string };
  $sender?: { id?: string };
}): string | undefined {
  const scope = message.$channel?.type || 'private';
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  return resolveCellContextKey(String(message.$adapter || ''), sceneId);
}
