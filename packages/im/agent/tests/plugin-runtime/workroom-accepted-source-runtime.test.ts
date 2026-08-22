import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import {
  FileWorkroomContextReleaseJournal,
  WorkroomAcceptedSourceRuntime,
} from '../../src/plugin-runtime/workroom-accepted-source-runtime.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { MemoryProjectMemoryApplicationRepository } from '../../src/workroom/accepted-source-memory-application.js';
import { createWorkroomProjectMemorySchemaSnapshot } from '../../src/workroom/accepted-source-projector.js';
import type { WorkroomAcceptanceRecord } from '../../src/workroom/acceptance-policy.js';

describe('Workroom Accepted Source production runtime', () => {
  it('recovers task.accepted into Project Memory and reconciles outcome_unknown Context release', async () => {
    const kernel = new MemoryWorkroomJournal();
    const acceptance = acceptedRecord();
    await kernel.append('run-1', -1, [{
      eventId: 'run-created', occurredAt: 1, type: 'run.created',
      payload: { projectId: 'project-1', title: 'Run' },
    }, {
      eventId: 'task-accepted', occurredAt: 2, type: 'task.accepted',
      payload: { taskKey: 'build', reportRef: 'workroom-report:1', record: acceptance },
    }]);
    const schema = createWorkroomProjectMemorySchemaSnapshot({
      revision: 1,
      claimRules: [{ key: 'build.result', valueType: 'string', allowedStatuses: ['verified'], allowSupersedes: true }],
    });
    const repository = new MemoryProjectMemoryApplicationRepository();
    const releases = new FileWorkroomContextReleaseJournal(
      await mkdtemp(join(tmpdir(), 'zhin-context-release-')),
    );
    let unknown = true;
    const release = vi.fn(async input => unknown
      ? { status: 'outcome_unknown' as const, operationId: input.operationId, receiptRef: 'release:unknown', digest: sha('a') }
      : { status: 'released' as const, operationId: input.operationId, receiptRef: 'release:done', digest: sha('b') });
    const options = {
      journal: kernel,
      repository,
      reports: { read: async input => {
        expect(input.purpose).toBe('accepted-source-memory-projector');
        return report();
      } },
      schemas: { resolve: async () => schema },
      release: { release },
      releases,
    };
    const first = new WorkroomAcceptedSourceRuntime(options);

    await expect(first.drain()).resolves.toEqual({ applied: 1, released: 0, reconciling: 1 });
    expect((await first.recall('project-1')).facts).toEqual([
      expect.objectContaining({ key: 'build.result', value: 'passed', status: 'verified' }),
    ]);
    expect(await releases.listReconciling()).toHaveLength(1);

    unknown = false;
    const restarted = new WorkroomAcceptedSourceRuntime(options);
    await expect(restarted.drain()).resolves.toEqual({ applied: 0, released: 1, reconciling: 0 });
    expect((await restarted.recall('project-1')).taskMemories).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[0]![0].operationId).toBe(release.mock.calls[1]![0].operationId);
    expect(await releases.listReconciling()).toEqual([]);
  });

  it('does not release Context when governed report/schema projection fails', async () => {
    const kernel = new MemoryWorkroomJournal();
    await kernel.append('run-1', -1, [{
      eventId: 'run-created', occurredAt: 1, type: 'run.created', payload: { projectId: 'project-1', title: 'Run' },
    }, {
      eventId: 'task-accepted', occurredAt: 2, type: 'task.accepted',
      payload: { taskKey: 'build', reportRef: 'workroom-report:1', record: acceptedRecord() },
    }]);
    const release = vi.fn();
    const runtime = new WorkroomAcceptedSourceRuntime({
      journal: kernel,
      repository: new MemoryProjectMemoryApplicationRepository(),
      reports: { read: async () => undefined },
      schemas: { resolve: async () => { throw new Error('Profile Memory Schema unavailable'); } },
      release: { release },
      releases: new FileWorkroomContextReleaseJournal(await mkdtemp(join(tmpdir(), 'zhin-context-release-fail-'))),
    });

    await expect(runtime.drain()).rejects.toThrow(/Report|Schema/u);
    expect(release).not.toHaveBeenCalled();
    expect((await runtime.recall('project-1')).stateRevision).toBe(0);
  });
});

function report() {
  return {
    ref: 'workroom-report:1', candidateHash: sha('c'), projectId: 'project-1', runId: 'run-1',
    planRef: 'plan:1', planRevision: 1, taskKey: 'build', taskRevision: 1,
    claims: [{
      id: 'claim-1', key: 'build.result', value: 'passed', status: 'verified' as const,
      evidenceRefs: ['evidence:1'], artifactRefs: [],
    }],
  };
}

function acceptedRecord(): WorkroomAcceptanceRecord {
  const candidate = {
    id: 'candidate:1', taskKey: 'build', taskRevision: 1,
    producerAssignmentId: 'assignment:1', producerPrincipalId: 'executor:1',
    reportRef: 'workroom-report:1', hash: sha('c'), claimIds: ['claim-1'], evidenceRefs: ['evidence:1'],
  };
  const policy = { id: 'policy:1', revision: 1, digest: sha('d') };
  return {
    id: `acceptance:${candidate.id}:${candidate.hash}`,
    version: 1, disposition: 'accepted', route: 'auto_accept', candidate,
    contract: {
      id: 'contract:1', revision: 1, digest: sha('e'), taskKey: 'build', taskRevision: 1,
      kind: 'task_result', policy,
      criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests' }],
      requiredEvidence: [],
    },
    riskAssessment: {
      id: 'risk:1', candidateHash: candidate.hash, tier: 'low', factsHash: sha('f'),
      assessor: 'kernel-risk-lattice:1', sourceRefs: ['plan:1'],
    },
    checkResults: [{
      id: 'check:1', criterionId: 'tests', status: 'passed', candidateHash: candidate.hash,
      runner: 'trusted-ci', runnerVersion: '1', evidenceRefs: ['evidence:1'],
    }],
    acceptedClaimIds: ['claim-1'], rejectedClaimIds: [], decidedBy: `acceptance-policy:${policy.id}`,
    sourceSequence: 0, acceptanceSequence: 1, candidateHash: candidate.hash,
    contractId: 'contract:1', policy,
  };
}

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
