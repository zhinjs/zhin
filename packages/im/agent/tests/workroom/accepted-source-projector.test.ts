import { describe, expect, it } from 'vitest';
import {
  projectAcceptedTaskMemory,
  createWorkroomProjectMemorySchemaSnapshot,
  type WorkroomProjectMemorySchemaSnapshot,
  type WorkroomStructuredTaskReport,
} from '../../src/workroom/accepted-source-projector.js';
import type { WorkroomAcceptanceRecord } from '../../src/workroom/acceptance-policy.js';

describe('accepted Workroom source projection', () => {
  it('projects only explicitly accepted structured claims into Task Memory and Project State', () => {
    const result = projectAcceptedTaskMemory({
      projectId: 'project-1',
      runId: 'run-1',
      report: report(),
      acceptance: acceptance(),
      schema: schema('runtime.node.support', 'release.mode'),
      baseStateRevision: 4,
      previousSourceSequence: 6,
    });

    expect(result.memory.summary).toBe('Accepted build@1: runtime.node.support=22 (verified).');
    expect(result.memory.claimIds).toEqual(['node22']);
    expect(result.memory.evidenceRefs).toEqual(['evidence://node22']);
    expect(result.memory.artifactRefs).toEqual(['artifact://node-support']);
    expect(result.statePatch.claims).toEqual([expect.objectContaining({
      id: 'node22', key: 'runtime.node.support', value: '22',
      sourceAcceptanceId: acceptance().id,
      supersedesFactIds: [],
    })]);
    expect(result.statePatch).toMatchObject({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan://1', planRevision: 2,
      baseStateRevision: 4, sourceSequence: 8, schemaRevision: 3,
    });
    expect(JSON.stringify(result)).not.toContain('direct_push');
    expect(Object.isFrozen(result.statePatch.claims)).toBe(true);
    expect(result.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects execution-completed or stale records and claims outside the Project Memory schema', () => {
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: report(),
      acceptance: { ...acceptance(), disposition: 'policy_blocked' },
      schema: schema('runtime.node.support'), baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('accepted Acceptance Record');
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1',
      report: { ...report(), candidateHash: 'sha256:stale' },
      acceptance: acceptance(),
      schema: schema('runtime.node.support'), baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('Candidate hash');
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: report(),
      acceptance: acceptance(),
      schema: schema('release.mode'), baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('outside Project Memory schema');
  });

  it('emits a content-free result when the Acceptance Record rejects every claim', () => {
    const rejectedOnlyReport: WorkroomStructuredTaskReport = {
      ...report(),
      claims: [report().claims[1]!],
    };
    const base = acceptance();
    const rejectedOnlyAcceptance: WorkroomAcceptanceRecord = {
      ...base,
      candidate: { ...base.candidate, claimIds: ['release-mode'] },
      acceptedClaimIds: [],
      rejectedClaimIds: ['release-mode'],
    };

    const result = projectAcceptedTaskMemory({
      projectId: 'project-1',
      runId: 'run-1',
      report: rejectedOnlyReport,
      acceptance: rejectedOnlyAcceptance,
      schema: schema('release.mode'),
      baseStateRevision: 4,
      previousSourceSequence: 6,
    });

    expect(result.memory.summary).toBe('Accepted build@1: no Project State claims.');
    expect(result.statePatch.claims).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('direct_push');
  });

  it('fails closed when accepted and rejected claim ids do not exactly partition the candidate', () => {
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1',
      runId: 'run-1',
      report: report(),
      acceptance: { ...acceptance(), rejectedClaimIds: [] },
      schema: schema('runtime.node.support'),
      baseStateRevision: 4,
      previousSourceSequence: 6,
    })).toThrow('Invalid Workroom Acceptance Record');
  });

  it('cannot transplant an accepted report into another Project or Run', () => {
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-other', runId: 'run-1', report: report(), acceptance: acceptance(),
      schema: schema('runtime.node.support'), baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('Report Project binding');
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-other', report: report(), acceptance: acceptance(),
      schema: schema('runtime.node.support'), baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('Report Run binding');
  });

  it('binds typed schema, base revision, source sequence and exact supersession', () => {
    const supersedingReport: WorkroomStructuredTaskReport = {
      ...report(),
      claims: [{
        ...report().claims[0]!,
        supersedesFactIds: ['project-fact:old-node'],
      }, report().claims[1]!],
    };
    const result = projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: supersedingReport,
      acceptance: acceptance(), schema: schema('runtime.node.support'),
      baseStateRevision: 11, previousSourceSequence: 7,
    });
    expect(result.statePatch.claims[0]).toMatchObject({
      supersedesFactIds: ['project-fact:old-node'],
      sourceReportRef: 'report://1',
    });
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: supersedingReport,
      acceptance: acceptance(), schema: schema('runtime.node.support', false),
      baseStateRevision: 11, previousSourceSequence: 7,
    })).toThrow('supersedes facts outside Project Memory schema');
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: report(), acceptance: acceptance(),
      schema: schema('runtime.node.support'), baseStateRevision: 11, previousSourceSequence: 8,
    })).toThrow('source sequence is stale');
  });

  it('rejects schema rule drift under a reused revision and digest', () => {
    const trusted = schema('runtime.node.support');
    expect(() => projectAcceptedTaskMemory({
      projectId: 'project-1', runId: 'run-1', report: report(), acceptance: acceptance(),
      schema: {
        ...trusted,
        claimRules: trusted.claimRules.map((rule) => ({ ...rule, allowSupersedes: false })),
      },
      baseStateRevision: 4, previousSourceSequence: 6,
    })).toThrow('schema digest does not match its rules');
  });
});

function report(): WorkroomStructuredTaskReport {
  return {
    ref: 'report://1',
    candidateHash: 'sha256:candidate-1',
    projectId: 'project-1',
    runId: 'run-1',
    planRef: 'plan://1',
    planRevision: 2,
    taskKey: 'build',
    taskRevision: 1,
    claims: [{
      id: 'node22', key: 'runtime.node.support', value: '22', status: 'verified',
      evidenceRefs: ['evidence://node22'], artifactRefs: ['artifact://node-support'],
    }, {
      id: 'release-mode', key: 'release.mode', value: 'direct_push', status: 'assumed',
      evidenceRefs: [], artifactRefs: [],
    }],
  };
}

function schema(
  firstKey: string,
  secondKeyOrAllowSupersedes?: string | boolean,
): WorkroomProjectMemorySchemaSnapshot {
  const keys = typeof secondKeyOrAllowSupersedes === 'string'
    ? [firstKey, secondKeyOrAllowSupersedes]
    : [firstKey];
  const allowSupersedes = typeof secondKeyOrAllowSupersedes === 'boolean'
    ? secondKeyOrAllowSupersedes
    : true;
  return createWorkroomProjectMemorySchemaSnapshot({
    revision: 3,
    claimRules: keys.map((key) => ({
      key,
      valueType: 'string',
      allowedStatuses: ['verified', 'assumed'],
      allowSupersedes,
    })),
  });
}

function acceptance(): WorkroomAcceptanceRecord {
  const policy = { id: 'policy-1', revision: 1, digest: 'sha256:policy-1' };
  const candidate = {
    id: 'candidate-1', taskKey: 'build', taskRevision: 1,
    producerAssignmentId: 'assignment-1', producerPrincipalId: 'builder',
    reportRef: 'report://1', hash: 'sha256:candidate-1',
    claimIds: ['node22', 'release-mode'], evidenceRefs: ['evidence://node22'],
  };
  return {
    id: 'acceptance:candidate-1:sha256:candidate-1',
    version: 1,
    disposition: 'accepted',
    route: 'reviewer_required',
    candidate,
    contract: {
      id: 'contract:build:1', revision: 1, digest: 'sha256:contract',
      taskKey: 'build', taskRevision: 1, kind: 'task_result', policy,
      criteria: [{ id: 'criterion-1', kind: 'judgment', description: 'correct' }],
      requiredEvidence: [],
    },
    riskAssessment: {
      id: 'risk-1', candidateHash: candidate.hash, tier: 'medium',
      factsHash: 'sha256:facts', assessor: 'kernel-risk', sourceRefs: ['plan://1'],
    },
    checkResults: [],
    acceptedClaimIds: ['node22'],
    rejectedClaimIds: ['release-mode'],
    decidedBy: 'acceptance-policy:policy-1',
    sourceSequence: 7,
    acceptanceSequence: 8,
    candidateHash: candidate.hash,
    contractId: 'contract:build:1',
    policy,
    reviewerAssignmentId: 'review-1',
    reviewerPrincipalId: 'reviewer-1',
  };
}
