import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { DurableFileStore, nodeDurableFileSystem } from '../../src/workroom/durable-file-store.js';
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
  it('reads committed facts while a real durable publication is paused before linking', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-journal-publication-'));
    try {
      const journal = new FileProjectMemoryApplicationRepository(directory);
      await journal.append('project-1', 0, acceptedProjection('acceptance-1', 'run-1', 3, 0, '22'));
      const [name] = await readdir(directory);
      const target = join(directory, name!);
      let entered!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>(resolve => { entered = resolve; });
      const released = new Promise<void>(resolve => { resume = resolve; });
      const publisher = new DurableFileStore(directory, { ...nodeDurableFileSystem, link: async (from, to) => {
        entered(); await released; await nodeDurableFileSystem.link(from, to);
      } });
      const pending = publisher.publishCreateOnly({ target, content: await readFile(target, 'utf8'), createdValue: null, onConflict: async () => null });
      await paused;
      try { expect(await journal.read('project-1')).toHaveLength(1); }
      finally { resume(); await pending; }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('ignores only canonical orphan temporary files and still rejects corrupt segments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-journal-orphan-'));
    try {
      const journal = new FileProjectMemoryApplicationRepository(directory);
      await journal.append('project-1', 0, acceptedProjection('acceptance-1', 'run-1', 3, 0, '22'));
      const [name] = await readdir(directory);
      await writeFile(join(directory, `${name}.${randomUUID()}.tmp`), '{');
      expect(await new FileProjectMemoryApplicationRepository(directory).read('project-1')).toHaveLength(1);
      const unexpected = join(directory, `${name}.unexpected.tmp`);
      await writeFile(unexpected, '{');
      await expect(journal.read('project-1')).rejects.toThrow('segment name');
      await rm(unexpected);
      await writeFile(join(directory, name!), '{');
      await expect(journal.read('project-1')).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

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
