import { usageGroupId, type UsageSubject } from '@zhin.js/core';
import type { TurnRequest } from '../turn/turn-ingress.js';
import { resolveTurnTrustLevel } from './trust-level.js';

/** The same trusted user/group attribution for a main turn and its model-using tools. */
export function usageSubjectFromTurn(turn: Pick<TurnRequest, 'origin' | 'principal'>): UsageSubject {
  const origin = turn.origin;
  const shared = origin.kind === 'im' && (origin.scope === 'group' || origin.scope === 'channel');
  return Object.freeze({ userId: turn.principal.subjectId,
    ...(shared ? { groupId: usageGroupId(origin.platform, origin.endpoint, origin.sceneId) } : {}),
    owner: resolveTurnTrustLevel(turn) === 'owner' });
}
