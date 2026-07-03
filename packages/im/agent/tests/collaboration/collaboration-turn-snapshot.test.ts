import { describe, it, expect } from 'vitest';
import {
  attachCollaborationTurnSnapshot,
  buildCollaborationTurnSnapshot,
  readCollaborationTurnSnapshot,
} from '../../src/collaboration/collaboration-turn-snapshot.js';
import type { AgentTurnMessage } from '@zhin.js/core';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'cell-1',
  adapter: 'icqq',
  sceneId: '1',
  version: 3,
  members: [
    { endpointId: 'planner', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'researcher', primary: 'researcher', pipelineRole: 'researcher' },
  ],
  pipelineState: {
    runId: 'run-abc-111',
    stage: 'researcher',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['evaluator'],
    todo: [],
    activeDelegations: [{
      targetEndpointId: 'researcher',
      targetRole: 'researcher',
      runId: 'run-abc-111',
      requireArtifact: true,
      artifactKinds: ['report'],
      delegateText: '调研',
      updatedAt: 1,
    }],
    updatedAt: 1,
  },
};

describe('collaboration-turn-snapshot', () => {
  it('builds snapshot with delegationRunId for delegatee', () => {
    const snap = buildCollaborationTurnSnapshot(cell, 'researcher');
    expect(snap?.runId).toBe('run-abc-111');
    expect(snap?.delegationRunId).toBe('run-abc-111');
    expect(snap?.cellVersion).toBe(3);
  });

  it('attach and read round-trip on commMessage.extra', () => {
    const msg = { extra: {} } as AgentTurnMessage;
    attachCollaborationTurnSnapshot(msg, cell, 'researcher');
    const read = readCollaborationTurnSnapshot(msg);
    expect(read?.collaborationSceneId).toBe('cell-1');
    expect(read?.delegationRunId).toBe('run-abc-111');
  });

  it('planner snapshot has no delegationRunId', () => {
    const snap = buildCollaborationTurnSnapshot(cell, 'planner');
    expect(snap?.runId).toBe('run-abc-111');
    expect(snap?.delegationRunId).toBeUndefined();
  });
});
