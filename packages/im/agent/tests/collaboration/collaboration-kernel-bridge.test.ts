import { describe, it, expect, beforeEach } from 'vitest';
import {
  isOrchestrationKernelReady,
  shouldUseLegacyCellDelegationHarness,
} from '../../src/collaboration/collaboration-kernel-bridge.js';
import { isSubstantiveGroupTaskReply } from '../../src/collaboration/collaboration-delegation.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'cell-1',
  adapter: 'icqq',
  sceneId: '1',
  members: [
    { endpointId: 'planner', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'r', primary: 'researcher', pipelineRole: 'researcher' },
  ],
  pipelineState: {
    runId: 'run-1',
    stage: 'planner',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['researcher'],
    todo: [],
    activeDelegations: [{
      targetEndpointId: 'r',
      targetRole: 'researcher',
      runId: 'run-1',
      requireArtifact: false,
      mode: 'legacy-handoff',
      delegateText: 'intro',
      updatedAt: 1,
    }],
    updatedAt: 1,
  },
};

describe('collaboration-kernel-bridge', () => {
  beforeEach(() => {
    initOrchestrationService(new MemoryOrchestrationRepository());
  });

  it('detects kernel readiness', () => {
    expect(isOrchestrationKernelReady()).toBe(true);
  });

  it('disables legacy cell delegation harness when kernel is ready', () => {
    expect(shouldUseLegacyCellDelegationHarness(cell)).toBe(false);
  });

  it('substantive reply gate rejects empty handback', () => {
    expect(isSubstantiveGroupTaskReply('已完成 ✅')).toBe(false);
    expect(isSubstantiveGroupTaskReply('Researcher 已完成调研，关键结论是可以继续推进。')).toBe(true);
  });
});
