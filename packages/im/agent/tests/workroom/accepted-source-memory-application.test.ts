import { describe, expect, it } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  AcceptedSourceMemoryApplication,
  MemoryProjectMemoryApplicationRepository,
  replayProjectMemoryApplication,
  type WorkroomAcceptedSourceApplicationEvent,
  type WorkroomAcceptedReportReader,
  type WorkroomProjectMemorySchemaReader,
} from '../../src/workroom/accepted-source-memory-application.js';
import {
  createWorkroomProjectMemorySchemaSnapshot,
  type WorkroomProjectMemorySchemaSnapshot,
  type WorkroomStructuredTaskReport,
} from '../../src/workroom/accepted-source-projector.js';
import type { WorkroomAcceptanceRecord } from '../../src/workroom/acceptance-policy.js';

describe('Accepted Source Memory application', () => {
  it('atomically makes accepted claims recallable and only then issues context-release eligibility', async () => {
    const fixture = await fixtureApplication();

    const receipt = await fixture.application.apply({
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      kernelSequence: 1,
      expectedStateRevision: 0,
      schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    });

    expect(receipt).toMatchObject({
      status: 'applied',
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      sourceSequence: 1,
      stateRevision: 1,
      contextRelease: {
        eligible: true,
        taskMemoryId: expect.stringMatching(/^task-memory:/u),
        statePatchId: expect.stringMatching(/^state-patch:/u),
      },
    });
    const recalled = await fixture.application.recall('project-1');
    expect(recalled.taskMemories).toHaveLength(1);
    expect(recalled.taskMemories[0]).toMatchObject({
      summary: 'Accepted build@1: runtime.node.support=22 (verified).',
      claimIds: ['node22'],
    });
    expect(recalled.facts).toEqual([expect.objectContaining({
      key: 'runtime.node.support',
      value: '22',
      status: 'verified',
      sourceAcceptanceId: fixture.acceptance.id,
    })]);
    expect(JSON.stringify(recalled)).not.toContain('direct_push');
    expect(JSON.stringify(recalled)).not.toContain('UNACCEPTED FREE TEXT');
  });

  it('replays the exact accepted source after a lost response without duplicating memory or release', async () => {
    const fixture = await fixtureApplication();
    const input = {
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 1,
      expectedStateRevision: 0, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    } as const;

    const first = await fixture.application.apply(input);
    const replayed = await fixture.application.apply(input);

    expect(replayed).toEqual(first);
    expect((await fixture.application.recall('project-1')).taskMemories).toHaveLength(1);
  });

  it('fails closed when an accepted Report drifts before a restart retry', async () => {
    const fixture = await fixtureApplication();
    const input = {
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 1,
      expectedStateRevision: 0, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    } as const;
    await fixture.application.apply(input);
    const original = fixture.reports.get('report://1')!;
    fixture.reports.set('report://1', {
      ...original,
      claims: original.claims.map(claim => claim.id === 'node22'
        ? { ...claim, value: '20' }
        : claim),
    });

    await expect(fixture.application.apply(input)).rejects.toThrow('identity payload drift');
    expect((await fixture.application.recall('project-1')).stateRevision).toBe(1);
  });

  it('rejects projection content drift replayed by a faulty repository', async () => {
    const fixture = await fixtureApplication();
    await fixture.application.apply({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 1,
      expectedStateRevision: 0, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    });
    const [stored] = await fixture.repository.read('project-1');
    const drift = JSON.parse(JSON.stringify(stored)) as WorkroomAcceptedSourceApplicationEvent;
    (drift.projection.memory as { summary: string }).summary = 'forged replay summary';

    expect(() => replayProjectMemoryApplication('project-1', [drift]))
      .toThrow('Invalid Accepted Source Project Memory application event');
  });

  it('cannot consume run creation in place of an accepted source', async () => {
    const fixture = await fixtureApplication();
    await expect(fixture.application.apply({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 0,
      expectedStateRevision: 0, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    })).rejects.toThrow('exact Kernel task.accepted');
    expect((await fixture.application.recall('project-1')).receipts).toEqual([]);
  });

  it('does not issue context-release eligibility when State projection fails', async () => {
    const fixture = await fixtureApplication();
    const incompatible = createWorkroomProjectMemorySchemaSnapshot({
      revision: 4,
      claimRules: [{
        key: 'release.mode', valueType: 'string',
        allowedStatuses: ['verified', 'assumed'], allowSupersedes: true,
      }],
    });
    const repository = new MemoryProjectMemoryApplicationRepository();
    const application = new AcceptedSourceMemoryApplication({
      kernel: fixture.kernel,
      repository,
      reports: { read: async input => fixture.reports.get(input.reportRef) },
      schemas: { read: async () => incompatible },
    });

    await expect(application.apply({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 1,
      expectedStateRevision: 0, schemaRevision: incompatible.revision,
      schemaDigest: incompatible.digest,
    })).rejects.toThrow('outside Project Memory schema');
    expect((await application.recall('project-1')).receipts).toEqual([]);
  });

  it('turns incompatible accepted values into disputed facts and fences stale state writers', async () => {
    const fixture = await fixtureApplication();
    await fixture.application.apply({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', kernelSequence: 1,
      expectedStateRevision: 0, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    });
    const secondReport: WorkroomStructuredTaskReport = {
      ...structuredReport(), ref: 'report://2', candidateHash: 'sha256:candidate-2',
      runId: 'run-2', taskKey: 'upgrade',
      claims: [{
        ...structuredReport().claims[0]!, id: 'node20', value: '20',
      }, structuredReport().claims[1]!],
    };
    const base = acceptedRecord();
    const secondCandidate = {
      ...base.candidate, id: 'candidate-2', taskKey: 'upgrade', reportRef: 'report://2',
      hash: 'sha256:candidate-2', claimIds: ['node20', 'release-mode'],
    };
    const secondAcceptance: WorkroomAcceptanceRecord = {
      ...base,
      id: 'acceptance:candidate-2:sha256:candidate-2',
      candidate: secondCandidate,
      contract: { ...base.contract, id: 'contract:upgrade:1', taskKey: 'upgrade' },
      riskAssessment: { ...base.riskAssessment, candidateHash: secondCandidate.hash },
      acceptedClaimIds: ['node20'],
      candidateHash: secondCandidate.hash,
      contractId: 'contract:upgrade:1',
    };
    fixture.reports.set(secondReport.ref, secondReport);
    await fixture.kernel.append('run-2', -1, [{
      eventId: 'event-run-2-created', occurredAt: 3, type: 'run.created',
      payload: { projectId: 'project-1', title: 'Upgrade' },
    }, {
      eventId: 'event-task-2-accepted', occurredAt: 4, type: 'task.accepted',
      payload: { taskKey: 'upgrade', reportRef: secondReport.ref, record: secondAcceptance },
    }]);
    const secondInput = {
      projectId: 'project-1', runId: 'run-2', taskKey: 'upgrade', kernelSequence: 1,
      schemaRevision: fixture.schema.revision, schemaDigest: fixture.schema.digest,
    } as const;

    await expect(fixture.application.apply({ ...secondInput, expectedStateRevision: 0 }))
      .rejects.toThrow('state revision conflict');
    expect((await fixture.application.recall('project-1')).receipts).toHaveLength(1);

    const receipt = await fixture.application.apply({ ...secondInput, expectedStateRevision: 1 });
    const recalled = await fixture.application.recall('project-1');
    expect(receipt.contextRelease.eligible).toBe(true);
    expect(recalled.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'runtime.node.support', value: '20', status: 'disputed' }),
      expect.objectContaining({ key: 'runtime.node.support', value: '22', status: 'disputed' }),
    ]));

    const supersededFactIds = recalled.facts.map(fact => fact.factId);
    const resolutionReport: WorkroomStructuredTaskReport = {
      ...structuredReport(), ref: 'report://3', candidateHash: 'sha256:candidate-3',
      runId: 'run-3', taskKey: 'resolve-node',
      claims: [{
        ...structuredReport().claims[0]!, id: 'node-resolution',
        supersedesFactIds: supersededFactIds,
      }],
    };
    const resolutionCandidate = {
      ...base.candidate, id: 'candidate-3', taskKey: 'resolve-node', reportRef: 'report://3',
      hash: 'sha256:candidate-3', claimIds: ['node-resolution'],
    };
    const resolutionAcceptance: WorkroomAcceptanceRecord = {
      ...base,
      id: 'acceptance:candidate-3:sha256:candidate-3',
      candidate: resolutionCandidate,
      contract: { ...base.contract, id: 'contract:resolve-node:1', taskKey: 'resolve-node' },
      riskAssessment: { ...base.riskAssessment, candidateHash: resolutionCandidate.hash },
      acceptedClaimIds: ['node-resolution'], rejectedClaimIds: [],
      candidateHash: resolutionCandidate.hash, contractId: 'contract:resolve-node:1',
    };
    fixture.reports.set(resolutionReport.ref, resolutionReport);
    await fixture.kernel.append('run-3', -1, [{
      eventId: 'event-run-3-created', occurredAt: 5, type: 'run.created',
      payload: { projectId: 'project-1', title: 'Resolve Node' },
    }, {
      eventId: 'event-task-3-accepted', occurredAt: 6, type: 'task.accepted',
      payload: {
        taskKey: 'resolve-node', reportRef: resolutionReport.ref, record: resolutionAcceptance,
      },
    }]);

    await fixture.application.apply({
      projectId: 'project-1', runId: 'run-3', taskKey: 'resolve-node', kernelSequence: 1,
      expectedStateRevision: 2, schemaRevision: fixture.schema.revision,
      schemaDigest: fixture.schema.digest,
    });
    const resolved = await fixture.application.recall('project-1');
    expect(resolved.facts.filter(fact => supersededFactIds.includes(fact.factId)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'stale' }),
        expect.objectContaining({ status: 'stale' }),
      ]));
    expect(resolved.facts).toContainEqual(expect.objectContaining({
      id: 'node-resolution', value: '22', status: 'verified',
    }));
  });
});

async function fixtureApplication(): Promise<Readonly<{
  application: AcceptedSourceMemoryApplication;
  acceptance: WorkroomAcceptanceRecord;
  schema: WorkroomProjectMemorySchemaSnapshot;
  kernel: MemoryWorkroomJournal;
  reports: Map<string, WorkroomStructuredTaskReport>;
  repository: MemoryProjectMemoryApplicationRepository;
}>> {
  const acceptance = acceptedRecord();
  const report = { ...structuredReport(), summary: 'UNACCEPTED FREE TEXT' };
  const schema = createWorkroomProjectMemorySchemaSnapshot({
    revision: 3,
    claimRules: [{
      key: 'runtime.node.support',
      valueType: 'string',
      allowedStatuses: ['verified', 'assumed'],
      allowSupersedes: true,
    }],
  });
  const kernel = new MemoryWorkroomJournal();
  await kernel.append('run-1', -1, [{
    eventId: 'event-run-created', occurredAt: 1, type: 'run.created',
    payload: { projectId: 'project-1', title: 'Release' },
  }, {
    eventId: 'event-task-accepted', occurredAt: 2, type: 'task.accepted',
    payload: { taskKey: 'build', reportRef: report.ref, record: acceptance },
  }]);
  const reportValues = new Map([[report.ref, report]]);
  const reports: WorkroomAcceptedReportReader = {
    read: async input => reportValues.get(input.reportRef),
  };
  const schemas: WorkroomProjectMemorySchemaReader = {
    read: async input => input.revision === schema.revision && input.digest === schema.digest
      ? schema
      : undefined,
  };
  const repository = new MemoryProjectMemoryApplicationRepository();
  return {
    acceptance,
    schema,
    kernel,
    reports: reportValues,
    repository,
    application: new AcceptedSourceMemoryApplication({
      kernel,
      repository,
      reports,
      schemas,
    }),
  };
}

function structuredReport(): WorkroomStructuredTaskReport {
  return {
    ref: 'report://1', candidateHash: 'sha256:candidate-1',
    projectId: 'project-1', runId: 'run-1', planRef: 'plan://1', planRevision: 2,
    taskKey: 'build', taskRevision: 1,
    claims: [{
      id: 'node22', key: 'runtime.node.support', value: '22', status: 'verified',
      evidenceRefs: ['evidence://node22'], artifactRefs: ['artifact://node-support'],
    }, {
      id: 'release-mode', key: 'release.mode', value: 'direct_push', status: 'assumed',
      evidenceRefs: [], artifactRefs: [],
    }],
  };
}

function acceptedRecord(): WorkroomAcceptanceRecord {
  const policy = { id: 'policy-1', revision: 1, digest: 'sha256:policy-1' };
  const candidate = {
    id: 'candidate-1', taskKey: 'build', taskRevision: 1,
    producerAssignmentId: 'assignment-1', producerPrincipalId: 'builder',
    reportRef: 'report://1', hash: 'sha256:candidate-1',
    claimIds: ['node22', 'release-mode'], evidenceRefs: ['evidence://node22'],
  };
  return {
    id: 'acceptance:candidate-1:sha256:candidate-1', version: 1,
    disposition: 'accepted', route: 'reviewer_required', candidate,
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
    checkResults: [], acceptedClaimIds: ['node22'], rejectedClaimIds: ['release-mode'],
    decidedBy: 'acceptance-policy:policy-1', sourceSequence: 0, acceptanceSequence: 1,
    candidateHash: candidate.hash, contractId: 'contract:build:1', policy,
    reviewerAssignmentId: 'review-1', reviewerPrincipalId: 'reviewer-1',
  };
}
