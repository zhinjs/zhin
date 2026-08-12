/**
 * 入站 turn 起始快照 — 绑定 runId/delegation，防 reset 与 session/ handback 竞态。
 */
import type { AgentTurnMessage, Message } from '@zhin.js/core';
import type { CollaborationScene } from './types.js';
import { findActiveDelegation } from './delegation-state.js';

export const COLLABORATION_TURN_SNAPSHOT_EXTRA_KEY = 'collaborationTurnSnapshot';

export interface CollaborationTurnSnapshot {
  collaborationSceneId: string;
  runId: string;
  cellVersion?: number;
  endpointKey: string;
  /** 本 turn 开始时该 endpoint 的委派 runId（若有） */
  delegationRunId?: string;
}

export function buildCollaborationTurnSnapshot(
  cell: CollaborationScene,
  endpointKey: string,
): CollaborationTurnSnapshot | undefined {
  const runId = cell.pipelineState?.runId;
  if (!runId) return undefined;
  const delegation = findActiveDelegation(cell, endpointKey);
  return {
    collaborationSceneId: cell.id,
    runId,
    cellVersion: cell.version,
    endpointKey,
    delegationRunId: delegation?.runId,
  };
}

export function attachCollaborationTurnSnapshot(
  message: AgentTurnMessage,
  cell: CollaborationScene,
  endpointKey: string,
): CollaborationTurnSnapshot | undefined {
  const snap = buildCollaborationTurnSnapshot(cell, endpointKey);
  if (!snap) return undefined;
  message.extra = {
    ...(message.extra ?? {}),
    [COLLABORATION_TURN_SNAPSHOT_EXTRA_KEY]: snap,
  };
  return snap;
}

export function readCollaborationTurnSnapshot(
  message: Message | undefined,
): CollaborationTurnSnapshot | undefined {
  const raw = (message as AgentTurnMessage | undefined)?.extra?.[COLLABORATION_TURN_SNAPSHOT_EXTRA_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as CollaborationTurnSnapshot;
  if (!rec.collaborationSceneId || !rec.runId || !rec.endpointKey) return undefined;
  return rec;
}
