import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProjectMemoryStateRevisionConflictError,
  replayProjectMemoryApplication,
  type WorkroomAcceptedSourceProjection,
} from '../../src/workroom/accepted-source-memory-application.js';
import { FileProjectMemoryApplicationRepository } from '../../src/workroom/file-accepted-source-memory-repository.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('File Project Memory application repository', () => {
  it('replays a committed projection after restart and confirms an exact lost-response retry', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhin-project-memory-'));
    temporaryDirectories.push(parent);
    const directory = join(parent, 'journal');
    await mkdir(parent, { recursive: true });
    const first = new FileProjectMemoryApplicationRepository(directory);
    const projection = acceptedProjection('acceptance-1', 'run-1', 3, 0, '22');

    const committed = await first.append('project-1', 0, projection);
    const restarted = new FileProjectMemoryApplicationRepository(directory);
    const replayed = await restarted.append('project-1', 0, projection);
    const recalled = replayProjectMemoryApplication('project-1', await restarted.read('project-1'));

    expect(replayed).toEqual(committed);
    expect(recalled).toMatchObject({
      stateRevision: 1,
      sourceSequencesByRun: { 'run-1': 3 },
      receipts: [{ contextRelease: { eligible: true } }],
    });
  });

  it('uses the state revision pathname as cross-instance CAS so only one divergent writer wins', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhin-project-memory-cas-'));
    temporaryDirectories.push(parent);
    const directory = join(parent, 'journal');
    const seed = new FileProjectMemoryApplicationRepository(directory);
    await seed.append('project-1', 0, acceptedProjection('acceptance-1', 'run-1', 3, 0, '22'));
    const left = new FileProjectMemoryApplicationRepository(directory);
    const right = new FileProjectMemoryApplicationRepository(directory);

    const outcomes = await Promise.allSettled([
      left.append('project-1', 1, acceptedProjection('acceptance-2', 'run-2', 4, 1, '20')),
      right.append('project-1', 1, acceptedProjection('acceptance-3', 'run-3', 5, 1, '24')),
    ]);

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(result => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: expect.any(ProjectMemoryStateRevisionConflictError) });
    expect(replayProjectMemoryApplication('project-1', await seed.read('project-1')).stateRevision).toBe(2);
  });
});

function acceptedProjection(
  acceptanceId: string,
  runId: string,
  sourceSequence: number,
  baseStateRevision: number,
  value: string,
): WorkroomAcceptedSourceProjection {
  const hashCharacter = acceptanceId.at(-1) ?? 'a';
  const sourceHash = `sha256:${hashCharacter.repeat(64)}`;
  const claimId = `claim-${acceptanceId}`;
  const factId = `project-fact:${acceptanceId}:${encodeURIComponent(claimId)}`;
  const reportRef = `report:${acceptanceId}`;
  return Object.freeze({
    sourceHash,
    memory: Object.freeze({
      id: `task-memory:${acceptanceId}:${sourceHash}`, projectId: 'project-1', runId,
      planRef: 'plan://1', planRevision: 1, taskKey: `task-${acceptanceId}`, taskRevision: 1,
      summary: `Accepted runtime.node.support=${value}.`, claimIds: [claimId],
      evidenceRefs: ['evidence://node'], artifactRefs: [],
      sourceReportRef: reportRef, sourceAcceptanceId: acceptanceId,
      schemaRevision: 1, sourceHash,
    }),
    statePatch: Object.freeze({
      id: `state-patch:${acceptanceId}:${sourceHash}`, projectId: 'project-1', runId,
      planRef: 'plan://1', planRevision: 1, taskKey: `task-${acceptanceId}`, taskRevision: 1,
      baseStateRevision, sourceSequence, acceptanceId,
      reportRef, candidateHash: `candidate:${acceptanceId}`,
      schemaRevision: 1, schemaDigest: `sha256:${'b'.repeat(64)}`,
      claims: [Object.freeze({
        id: claimId, factId, key: 'runtime.node.support', value,
        status: 'verified' as const, evidenceRefs: ['evidence://node'], artifactRefs: [],
        supersedesFactIds: [], sourceAcceptanceId: acceptanceId,
        sourceReportRef: reportRef,
      })],
    }),
  });
}
