import {
  appendFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileWorkroomRemoteDispatchOutboxRepository,
  MemoryWorkroomRemoteDispatchOutboxRepository,
  type WorkroomRemoteDispatchOutboxFileSystem,
  type WorkroomRemoteDispatchOutboxRepository,
} from '../../src/workroom/remote-dispatch-outbox.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchInput,
} from '../../src/workroom/remote-dispatch.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

interface RepositoryFixture {
  readonly repository: WorkroomRemoteDispatchOutboxRepository;
  readonly restart: () => WorkroomRemoteDispatchOutboxRepository;
}

const adapters: readonly Readonly<{
  name: string;
  create(): RepositoryFixture;
}>[] = [
  {
    name: 'memory',
    create: () => {
      const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
      return { repository, restart: () => repository };
    },
  },
  {
    name: 'file',
    create: () => {
      const directory = join(
        tmpdir(),
        `workroom-remote-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      temporaryDirectories.push(directory);
      return {
        repository: new FileWorkroomRemoteDispatchOutboxRepository(directory),
        restart: () => new FileWorkroomRemoteDispatchOutboxRepository(directory),
      };
    },
  },
];

describe.each(adapters)('$name Workroom Remote Dispatch Outbox contract', ({ create }) => {
  it('durably enqueues the exact immutable dispatch before transport I/O', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();

    const event = await repository.enqueue(item, -1, 1_000);

    expect(event).toMatchObject({
      version: 1,
      dispatchId: item.dispatchId,
      sequence: 0,
      eventId: `${item.dispatchId}:enqueued`,
      occurredAt: 1_000,
      type: 'dispatch.enqueued',
    });
    await expect(restart().read(item.dispatchId)).resolves.toEqual({
      version: 1,
      dispatchId: item.dispatchId,
      sequence: 0,
      status: 'pending',
      item,
      attemptCount: 0,
      observations: [],
    });
  });

  it('makes persisted dispatch and event identity payload-sensitive', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();
    const first = await repository.enqueue(item, -1, 1_000);

    await expect(restart().enqueue(item, -1, 1_000)).resolves.toEqual(first);
    await expect(restart().enqueue(dispatchItem({
      contextView: { ref: 'view:changed', hash: 'sha256:changed-view' },
    }), -1, 1_000)).rejects.toThrow('payload conflict');
    await expect(restart().read(item.dispatchId)).resolves.toMatchObject({ sequence: 0, item });
  });

  it('converges concurrent identical enqueue attempts to one persisted event', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();

    const [left, right] = await Promise.all([
      repository.enqueue(item, -1, 1_000),
      restart().enqueue(item, -1, 1_000),
    ]);

    expect(right).toEqual(left);
    await expect(restart().read(item.dispatchId)).resolves.toMatchObject({
      sequence: 0,
      item,
    });
  });

  it('claims one explicit lease/fence with expectedSequence CAS', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);

    const results = await Promise.allSettled([
      restart().claim({
        dispatchId: item.dispatchId,
        expectedSequence: 0,
        now: 1_100,
        ownerId: 'outbox-worker-a',
        leaseId: 'lease-a',
        leaseFence: 1,
        leaseExpiresAt: 1_500,
      }),
      repository.claim({
        dispatchId: item.dispatchId,
        expectedSequence: 0,
        now: 1_100,
        ownerId: 'outbox-worker-b',
        leaseId: 'lease-b',
        leaseFence: 1,
        leaseExpiresAt: 1_500,
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const projection = await restart().read(item.dispatchId);
    expect(projection).toMatchObject({
      sequence: 1,
      status: 'leased',
      attemptCount: 1,
      lease: {
        ownerId: expect.stringMatching(/^outbox-worker-/u),
        leaseId: expect.stringMatching(/^lease-/u),
        leaseFence: 1,
        claimedAt: 1_100,
        expiresAt: 1_500,
      },
    });
    await expect(restart().claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: projection!.lease!.claimedAt,
      ownerId: projection!.lease!.ownerId,
      leaseId: projection!.lease!.leaseId,
      leaseFence: projection!.lease!.leaseFence,
      leaseExpiresAt: projection!.lease!.expiresAt,
    })).resolves.toMatchObject({ sequence: 1, type: 'dispatch.claimed' });
  });

  it('persists outcome_unknown as recoverable transport state without completing a Task', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    await repository.claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'outbox-worker-a',
      leaseId: 'lease-a',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
    });

    const first = await repository.recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_200,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'send-attempt-1',
      observation: {
        outcome: 'outcome_unknown',
        receiptId: 'receipt-unknown-1',
        reason: 'connection reset after request body',
      },
    });
    const replay = await restart().recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_200,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'send-attempt-1',
      observation: {
        outcome: 'outcome_unknown',
        receiptId: 'receipt-unknown-1',
        reason: 'connection reset after request body',
      },
    });

    expect(replay).toEqual(first);
    const projection = await restart().read(item.dispatchId);
    expect(projection).toMatchObject({
      sequence: 2,
      status: 'reconcile_required',
      attemptCount: 1,
      lastLeaseFence: 1,
      observations: [{
        observationId: 'send-attempt-1',
        observedAt: 1_200,
        outcome: 'outcome_unknown',
        receiptId: 'receipt-unknown-1',
      }],
    });
    expect(projection).not.toHaveProperty('taskStatus');
    expect(projection).not.toHaveProperty('lease');

    await expect(restart().recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_200,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'send-attempt-1',
      observation: {
        outcome: 'outcome_unknown',
        receiptId: 'receipt-drifted',
        reason: 'connection reset after request body',
      },
    })).rejects.toThrow('payload conflict');
  });

  it('recovers after restart with a higher lease fence and rejects the old worker', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    await repository.claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'outbox-worker-a',
      leaseId: 'lease-a',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
    });
    await repository.recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_200,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'send-attempt-1',
      observation: { outcome: 'outcome_unknown', receiptId: 'receipt-unknown-1' },
    });

    const recovered = restart();
    await recovered.recover({
      dispatchId: item.dispatchId,
      expectedSequence: 2,
      now: 1_300,
      ownerId: 'outbox-worker-b',
      leaseId: 'lease-b',
      leaseFence: 2,
      leaseExpiresAt: 1_700,
    });

    await expect(recovered.recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 3,
      now: 1_350,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'late-old-worker',
      observation: { outcome: 'delivered', receiptId: 'stale-receipt' },
    })).rejects.toThrow('lease/fence');
    await recovered.recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 3,
      now: 1_350,
      leaseId: 'lease-b',
      leaseFence: 2,
      observationId: 'send-attempt-2',
      observation: {
        outcome: 'delivered',
        receiptId: 'receipt-delivered-2',
        remoteTaskId: 'remote-task-1',
        remoteContextId: 'remote-context-1',
      },
    });

    await expect(restart().read(item.dispatchId)).resolves.toMatchObject({
      sequence: 4,
      status: 'delivered',
      item: {
        dispatchId: item.dispatchId,
        messageId: item.messageId,
        envelopeDigest: item.envelopeDigest,
      },
      attemptCount: 2,
      lastLeaseFence: 2,
      observations: [
        { observationId: 'send-attempt-1', outcome: 'outcome_unknown' },
        { observationId: 'send-attempt-2', outcome: 'delivered' },
      ],
    });
  });

  it('uses only the supplied Kernel clock to recover an expired active lease', async () => {
    const { repository, restart } = create();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    await repository.claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'outbox-worker-a',
      leaseId: 'lease-a',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
    });

    await expect(restart().recover({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_499,
      ownerId: 'outbox-worker-b',
      leaseId: 'lease-b',
      leaseFence: 2,
      leaseExpiresAt: 1_900,
    })).rejects.toThrow('not eligible');
    await expect(restart().recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_500,
      leaseId: 'lease-a',
      leaseFence: 1,
      observationId: 'at-expiry',
      observation: { outcome: 'delivered', receiptId: 'too-late' },
    })).rejects.toThrow('after lease expiry');
    await restart().recover({
      dispatchId: item.dispatchId,
      expectedSequence: 1,
      now: 1_500,
      ownerId: 'outbox-worker-b',
      leaseId: 'lease-b',
      leaseFence: 2,
      leaseExpiresAt: 1_900,
    });

    await expect(restart().read(item.dispatchId)).resolves.toMatchObject({
      sequence: 2,
      status: 'leased',
      attemptCount: 2,
      lastLeaseFence: 2,
      lastRecoveryCause: 'lease_expired',
      lease: { leaseId: 'lease-b', claimedAt: 1_500, expiresAt: 1_900 },
    });
  });
});

describe('File Workroom Remote Dispatch Outbox durability', () => {
  it('syncs content and the committed directory entry before confirming append', async () => {
    const directory = temporaryDirectory('durability-order');
    const trace: string[] = [];
    const repository = new FileWorkroomRemoteDispatchOutboxRepository(
      directory,
      tracingFileSystem(trace),
    );
    const item = dispatchItem();

    await repository.enqueue(item, -1, 1_000);

    expect(trace.filter(entry => entry !== 'readdir')).toEqual([
      'mkdir',
      'open:r',
      'sync:r',
      'close:r',
      'open:wx',
      'write:wx',
      'sync:wx',
      'close:wx',
      'link',
      'unlink',
      'open:r',
      'sync:r',
      'close:r',
    ]);
    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory).read(item.dispatchId))
      .resolves.toMatchObject({ sequence: 0, item });
  });

  it('does not write or confirm an outbox item when the new leaf parent sync fails', async () => {
    const directory = temporaryDirectory('parent-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    let firstDirectorySync = true;
    const repository = new FileWorkroomRemoteDispatchOutboxRepository(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r' || !firstDirectorySync) return handle;
        firstDirectorySync = false;
        return {
          ...handle,
          async sync() {
            trace.push('injected-parent-sync-failure');
            throw new Error('injected parent sync failure');
          },
        };
      },
    });
    const item = dispatchItem();

    await expect(repository.enqueue(item, -1, 1_000)).rejects.toThrow('parent sync failure');
    expect(trace).not.toContain('open:wx');
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory).read(item.dispatchId))
      .resolves.toBeUndefined();
  });

  it('fails closed instead of recursively creating an unverified parent chain', async () => {
    const cleanupRoot = temporaryDirectory('missing-parent');
    const directory = join(cleanupRoot, 'not-created', 'outbox');
    const item = dispatchItem();

    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory)
      .enqueue(item, -1, 1_000)).rejects.toThrow('pre-existing durable parent');
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not publish or retain a temp file when content sync fails', async () => {
    const directory = temporaryDirectory('file-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    const repository = new FileWorkroomRemoteDispatchOutboxRepository(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'wx') return handle;
        return {
          ...handle,
          async sync() {
            trace.push('injected-file-sync-failure');
            throw new Error('injected file sync failure');
          },
        };
      },
    });
    const item = dispatchItem();

    await expect(repository.enqueue(item, -1, 1_000)).rejects.toThrow('file sync failure');
    expect(await readdir(directory)).toEqual([]);
    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory).read(item.dispatchId))
      .resolves.toBeUndefined();
    expect(trace).not.toContain('link');
  });

  it('does not confirm a link whose directory sync failed and re-syncs an exact retry', async () => {
    const directory = temporaryDirectory('directory-sync-failure');
    const failedTrace: string[] = [];
    const realFileSystem = tracingFileSystem(failedTrace);
    let directorySyncCount = 0;
    const repository = new FileWorkroomRemoteDispatchOutboxRepository(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r' || ++directorySyncCount !== 2) return handle;
        return {
          ...handle,
          async sync() {
            failedTrace.push('injected-directory-sync-failure');
            throw new Error('injected directory sync failure');
          },
        };
      },
    });
    const item = dispatchItem();

    await expect(repository.enqueue(item, -1, 1_000)).rejects.toThrow('directory sync failure');
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory).read(item.dispatchId))
      .resolves.toMatchObject({ sequence: 0, item });

    const retryTrace: string[] = [];
    await expect(new FileWorkroomRemoteDispatchOutboxRepository(
      directory,
      tracingFileSystem(retryTrace),
    ).enqueue(item, -1, 1_000)).resolves.toMatchObject({ sequence: 0 });
    expect(retryTrace.filter(entry => entry.startsWith('open:') || entry.startsWith('sync:')))
      .toEqual(['open:r', 'sync:r']);
  });

  it('fails closed instead of projecting a corrupt durable segment', async () => {
    const directory = temporaryDirectory('corrupt');
    const repository = new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const [segment] = await readdir(directory);
    await appendFile(join(directory, segment!), 'corrupt-tail', 'utf8');

    await expect(new FileWorkroomRemoteDispatchOutboxRepository(directory).read(item.dispatchId))
      .rejects.toThrow();
  });
});

function temporaryDirectory(label: string): string {
  const directory = join(
    tmpdir(),
    `workroom-remote-outbox-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  temporaryDirectories.push(directory);
  return directory;
}

function tracingFileSystem(trace: string[]): WorkroomRemoteDispatchOutboxFileSystem {
  return {
    async mkdir(path) {
      trace.push('mkdir');
      await mkdir(path);
    },
    async readdir(path) {
      trace.push('readdir');
      return await readdir(path);
    },
    readFile,
    async open(path, flags) {
      trace.push(`open:${flags}`);
      const handle = await open(path, flags);
      return {
        async writeFile(value, encoding) {
          trace.push(`write:${flags}`);
          await handle.writeFile(value, encoding);
        },
        async sync() {
          trace.push(`sync:${flags}`);
          await handle.sync();
        },
        async close() {
          trace.push(`close:${flags}`);
          await handle.close();
        },
      };
    },
    async link(existingPath, newPath) {
      trace.push('link');
      await link(existingPath, newPath);
    },
    async unlink(path) {
      trace.push('unlink');
      await unlink(path);
    },
  };
}

function dispatchItem(overrides: Partial<WorkroomRemoteDispatchInput> = {}) {
  return createWorkroomRemoteDispatchOutboxItem({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    attempt: 1,
    fence: 7,
    endpoint: {
      id: 'remote-main',
      owner: 'integration-plugin',
      cardDigest: 'sha256:card',
      authBindingId: 'auth:a2a',
      workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true,
      typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'view:1', hash: 'sha256:view' },
    acceptanceContract: { ref: 'acceptance:1', hash: 'sha256:acceptance' },
    capabilitySnapshot: { ref: 'capability:1', hash: 'sha256:capability', grantRef: 'grant:1' },
    disclosureManifest: { ref: 'disclosure:1', hash: 'sha256:disclosure' },
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:org/repo',
      integrationBindingId: 'github-app:1',
      baseSha: 'a'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/workroom/assignment-1',
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: 7,
    },
    ...overrides,
  });
}
