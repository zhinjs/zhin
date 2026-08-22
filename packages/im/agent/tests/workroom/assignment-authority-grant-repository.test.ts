import { mkdir, mkdtemp, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssignmentAuthorityGrantSequenceConflictError,
  DatabaseAssignmentAuthorityGrantRepository,
  FileAssignmentAuthorityGrantRepository,
  MemoryAssignmentAuthorityGrantRepository,
  assignmentAuthorityGrantKey,
  createAssignmentAuthorityGrantRecord,
  createDurableWorkroomAssignmentAuthorityGrantProvider,
  type AssignmentAuthorityGrantRecordInput,
} from '../../src/workroom/assignment-authority-grant-repository.js';
import { createWorkroomAssignmentAuthorityGrant } from '../../src/plugin-runtime/workroom-assignment-authority-provider.js';
import { remoteDisclosureFixture } from './remote-disclosure-fixture.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Assignment Authority Grant repository', () => {
  it('persists a content-addressed blocker and promotes it with exact CAS across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-assignment-grants-'));
    const directory = join(root, 'records');
    await mkdir(directory);
    const first = new FileAssignmentAuthorityGrantRepository(directory);
    const blocked = createAssignmentAuthorityGrantRecord(recordInput({
      status: 'blocked',
      blocker: {
        kind: 'disclosure',
        owner: 'workroom-disclosure-authority',
        reason: 'manifest unavailable',
        deadline: 2_000,
      },
    }));
    expect((await first.append(blocked, undefined)).status).toBe('created');

    const restarted = new FileAssignmentAuthorityGrantRepository(directory);
    expect(await restarted.read(blocked.assignmentKey)).toEqual(blocked);
    const ready = createAssignmentAuthorityGrantRecord(recordInput({
      revision: 2,
      previousDigest: blocked.digest,
      status: 'ready',
      grant: grant(),
    }));
    expect((await restarted.append(ready, blocked.digest)).status).toBe('created');
    expect((await restarted.append(ready, blocked.digest)).status).toBe('replayed');
    expect(await first.read(blocked.assignmentKey)).toEqual(ready);

    const firstRevision = (await readdir(directory)).find(name => name.endsWith('.1.json'))!;
    await unlink(join(directory, firstRevision));
    await expect(restarted.read(blocked.assignmentKey))
      .rejects.toThrow('durable revision chain has a gap');
  });

  it('rejects a competing CAS child and fails closed for expired or stale generation grants', async () => {
    const repository = new MemoryAssignmentAuthorityGrantRepository();
    const blocked = createAssignmentAuthorityGrantRecord(recordInput({
      status: 'blocked',
      blocker: { kind: 'capability', owner: 'policy', reason: 'ceiling missing', deadline: 2_000 },
    }));
    await repository.append(blocked, undefined);
    const competing = createAssignmentAuthorityGrantRecord(recordInput({
      revision: 2,
      previousDigest: blocked.digest,
      status: 'blocked',
      blocker: { kind: 'capability', owner: 'policy', reason: 'different', deadline: 3_000 },
    }));
    await repository.append(competing, blocked.digest);
    const other = createAssignmentAuthorityGrantRecord(recordInput({
      revision: 2,
      previousDigest: blocked.digest,
      status: 'ready',
      grant: grant(),
    }));
    await expect(repository.append(other, blocked.digest))
      .rejects.toBeInstanceOf(AssignmentAuthorityGrantSequenceConflictError);

    const request = {
      projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
      assignmentId: 'assignment', assignmentRevision: 1, attempt: 1, fence: 7,
      requestedAgentDefinitionId: 'developer', requestedEndpointId: 'endpoint',
    };
    const provider = createDurableWorkroomAssignmentAuthorityGrantProvider({
      repository,
      generation: 8,
      now: () => 1_500,
    });
    expect(await provider.resolve(request)).toBeUndefined();

    const expiredRepository = new MemoryAssignmentAuthorityGrantRepository();
    await expiredRepository.append(createAssignmentAuthorityGrantRecord(recordInput({
      generation: 8,
      expiresAt: 1_000,
      status: 'ready',
      grant: grant(),
    })), undefined);
    expect(await createDurableWorkroomAssignmentAuthorityGrantProvider({
      repository: expiredRepository, generation: 8, now: () => 1_001,
    }).resolve(request)).toBeUndefined();
  });

  it('normalizes a multi-instance database CAS loser only after rereading the winner', async () => {
    const rows: Record<string, unknown>[] = [];
    const model = { select: () => ({ where: async (query: Record<string, unknown>) =>
      rows.filter(row => row.assignment_key === query.assignment_key) }) };
    let concurrentWinner: Record<string, unknown> | undefined;
    const database = {
      transaction: async <T>(operation: (transaction: any) => Promise<T>) => await operation({
        select: () => ({ where: async (query: Record<string, unknown>) =>
          rows.filter(row => row.assignment_key === query.assignment_key) }),
        insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
          if (concurrentWinner) {
            rows.push(concurrentWinner);
            const error = Object.assign(new Error('unique loser'), { code: '23505' });
            throw error;
          }
          rows.push(...inserted);
        },
      }),
    };
    const repository = new DatabaseAssignmentAuthorityGrantRepository(database, model);
    const candidate = createAssignmentAuthorityGrantRecord(recordInput({
      status: 'blocked',
      blocker: { kind: 'capability', owner: 'policy', reason: 'missing', deadline: 2_000 },
    }));
    concurrentWinner = databaseRow(candidate);
    expect((await repository.append(candidate, undefined)).status).toBe('replayed');

    rows.length = 0;
    const different = createAssignmentAuthorityGrantRecord(recordInput({
      status: 'blocked',
      blocker: { kind: 'capability', owner: 'policy', reason: 'different', deadline: 2_000 },
    }));
    concurrentWinner = databaseRow(different);
    await expect(repository.append(candidate, undefined))
      .rejects.toBeInstanceOf(AssignmentAuthorityGrantSequenceConflictError);
  });
});

function databaseRow(record: ReturnType<typeof createAssignmentAuthorityGrantRecord>) {
  return {
    id: `id:${record.revision}`,
    assignment_key: record.assignmentKey,
    revision: record.revision,
    digest: record.digest,
    record_json: JSON.stringify(record),
    created_at: record.createdAt,
  };
}

function recordInput(overrides: Partial<AssignmentAuthorityGrantRecordInput>): AssignmentAuthorityGrantRecordInput {
  const merged = {
    revision: 1,
    generation: 7,
    projectId: 'project',
    runId: 'run',
    taskKey: 'task',
    taskRevision: 1,
    assignmentId: 'assignment',
    assignmentRevision: 1,
    attempt: 1,
    fence: 7,
    operationId: 'decision',
    agentDefinitionId: 'developer',
    endpointId: 'endpoint',
    profileRevisionId: 'profile:1',
    profileDigest: SHA,
    factAnchor: { ref: 'workroom-journal:run:4', sequence: 4, digest: SHA },
    createdAt: 100,
    expiresAt: 10_000,
    ...overrides,
  };
  const scope = {
    generation: merged.generation,
    projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
    assignmentId: 'assignment', assignmentRevision: 1, attempt: 1, fence: 7,
    requestedAgentDefinitionId: 'developer', requestedEndpointId: 'endpoint',
  };
  return {
    assignmentKey: assignmentAuthorityGrantKey(scope),
    ...merged,
  } as AssignmentAuthorityGrantRecordInput;
}

function grant() {
  return createWorkroomAssignmentAuthorityGrant({
    generation: 7,
    projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
    assignmentId: 'assignment', assignmentRevision: 1, attempt: 1, fence: 7,
    agentDefinitionId: 'developer', endpointId: 'endpoint', endpointAuthorityDigest: SHA,
    catalogRevision: 'a'.repeat(64), catalogBindingDigest: SHA,
    profileRevisionId: 'profile:1', profileDigest: SHA,
    principalId: 'agent:developer', role: 'executor',
    capabilitySnapshotRef: 'capability:1', capabilitySnapshotRevision: 1,
    roleCapabilities: ceiling('role'), taskCapabilities: ceiling('task'),
    policyCapabilities: ceiling('policy'),
    plan: { ref: 'plan:1', revision: 1, digest: SHA },
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA },
    policySnapshot: { ref: 'policy:1', revision: 1, digest: SHA },
    workspace: { leaseRef: 'lease:1', mountRef: '/workspace', baseRevision: 'base', fence: 7 },
    contextView: { ref: 'context:1', hash: SHA }, capabilityGrantRef: 'grant:1',
    disclosureManifest: remoteDisclosureFixture({
      endpointId: 'endpoint', principalId: 'agent:developer',
      sourceRef: 'context:1', sourceDigest: SHA,
    }),
    remoteWorkspace: {
      provider: 'github', repositoryId: 'repo', integrationBindingId: 'integration',
      worktreeRef: 'worktree:1', baseSha: 'base', fence: 7,
    },
  });
}

function ceiling(id: string) {
  return { id, revision: 1, tools: [], skills: [] };
}
