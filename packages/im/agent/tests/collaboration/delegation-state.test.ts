import { describe, it, expect } from 'vitest';
import {
  findActiveDelegation,
  isActiveDelegatee,
  upsertActiveDelegation,
  removeActiveDelegationForEndpoint,
  resolveArtifactSubmitRunId,
  findInFlightArchivedRunId,
} from '../../src/collaboration/delegation-state.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'cell-1',
  adapter: 'icqq',
  sceneId: '1',
  members: [
    { endpointId: 'planner', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'researcher', primary: 'researcher', pipelineRole: 'researcher' },
  ],
  pipelineState: {
    runId: 'run-1',
    stage: 'researcher',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['evaluator'],
    todo: [],
    activeDelegations: [{
      targetEndpointId: 'researcher',
      targetRole: 'researcher',
      runId: 'run-1',
      requireArtifact: true,
      artifactKinds: ['report'],
      delegateText: '调研',
      updatedAt: 1,
    }],
    updatedAt: 1,
  },
};

describe('delegation-state', () => {
  it('findActiveDelegation returns entry by endpoint', () => {
    const d = findActiveDelegation(cell, 'researcher');
    expect(d?.delegateText).toBe('调研');
    expect(d?.requireArtifact).toBe(true);
  });

  it('isActiveDelegatee excludes planner', () => {
    expect(isActiveDelegatee(cell, 'researcher')).toBe(true);
    expect(isActiveDelegatee(cell, 'planner')).toBe(false);
  });

  it('upsert and remove active delegations', () => {
    let list = upsertActiveDelegation(cell.pipelineState!.activeDelegations, {
      targetEndpointId: 'evaluator',
      targetRole: 'evaluator',
      runId: 'run-1',
      requireArtifact: false,
      delegateText: '评估',
      updatedAt: 2,
    });
    expect(list).toHaveLength(2);
    list = removeActiveDelegationForEndpoint(list, 'researcher');
    expect(list).toHaveLength(1);
    expect(list[0]?.targetEndpointId).toBe('evaluator');
  });

  it('resolveArtifactSubmitRunId uses active delegation runId', () => {
    const r = resolveArtifactSubmitRunId(cell, 'researcher');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.runId).toBe('run-1');
      expect(r.reason).toBe('active_delegation');
    }
  });

  it('routes in-flight submit to archived run after reset cleared delegation', () => {
    const afterReset: CollaborationScene = {
      ...cell,
      pipelineState: {
        ...cell.pipelineState!,
        runId: 'run-2',
        activeDelegations: undefined,
        runHistory: [{
          runId: 'run-1',
          stage: 'researcher',
          reviewCycles: 0,
          todo: [],
          activeDelegationsAtArchive: [{
            targetEndpointId: 'researcher',
            targetRole: 'researcher',
            runId: 'run-1',
            requireArtifact: true,
            artifactKinds: ['report'],
            delegateText: '调研',
            updatedAt: 1,
          }],
          createdAt: 1,
          archivedAt: 2,
        }],
      },
    };
    expect(findInFlightArchivedRunId(afterReset, 'researcher')).toBe('run-1');
    const r = resolveArtifactSubmitRunId(afterReset, 'researcher');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.runId).toBe('run-1');
      expect(r.reason).toBe('in_flight_archive');
    }
  });

  it('turn snapshot delegationRunId wins over current active run', () => {
    const afterReset: CollaborationScene = {
      ...cell,
      pipelineState: {
        ...cell.pipelineState!,
        runId: 'run-2',
        activeDelegations: undefined,
      },
    };
    const r = resolveArtifactSubmitRunId(afterReset, 'researcher', {
      turnDelegationRunId: 'run-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.runId).toBe('run-1');
      expect(r.reason).toBe('turn_snapshot_delegation');
    }
  });

  it('removeActiveDelegationForEndpoint respects runId filter', () => {
    const list = removeActiveDelegationForEndpoint(
      cell.pipelineState!.activeDelegations,
      'researcher',
      'run-other',
    );
    expect(list).toHaveLength(1);
    const cleared = removeActiveDelegationForEndpoint(
      cell.pipelineState!.activeDelegations,
      'researcher',
      'run-1',
    );
    expect(cleared).toHaveLength(0);
  });
});
