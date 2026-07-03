import { describe, it, expect } from 'vitest';
import {
  isCeremonyGoal,
  isSubstantiveCeremonyPublicReply,
  resolveNextCeremonyEndpointId,
  resolveCeremonyRosterEndpointIds,
} from '../../src/collaboration/ceremony-round.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const cell: CollaborationCell = {
  id: 'cell-1',
  adapter: 'icqq',
  sceneId: '1',
  goal: '组织大家依次自我介绍',
  members: [
    { endpointId: 'planner', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'r', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: 'e', primary: 'evaluator', pipelineRole: 'evaluator' },
    { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
  ],
  pipelineState: {
    runId: 'run-1',
    stage: 'planner',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['researcher'],
    todo: [],
    ceremonySpoken: ['r'],
    updatedAt: 1,
  },
};

describe('ceremony-round', () => {
  it('detects ceremony goal', () => {
    expect(isCeremonyGoal(cell)).toBe(true);
  });

  it('roster order skips planner', () => {
    expect(resolveCeremonyRosterEndpointIds(cell)).toEqual(['r', 'e', 'x']);
  });

  it('next endpoint skips spoken', () => {
    expect(resolveNextCeremonyEndpointId(cell)).toBe('e');
    expect(resolveNextCeremonyEndpointId(cell, 'e')).toBe('x');
    expect(resolveNextCeremonyEndpointId(cell, 'x')).toBeUndefined();
  });

  it('substantive public reply gate', () => {
    expect(isSubstantiveCeremonyPublicReply('已完成自我介绍 ✅')).toBe(false);
    expect(isSubstantiveCeremonyPublicReply('大家好，我是 Researcher，擅长查资料和整理报告。')).toBe(true);
  });
});
