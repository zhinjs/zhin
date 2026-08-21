import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkroomRemoteExecutorPort } from '../../src/plugin-runtime/workroom-remote-executor.js';
import {
  FileWorkroomRemoteDispatchOutboxRepository,
  MemoryWorkroomRemoteDispatchOutboxRepository,
  type WorkroomRemoteDispatchOutboxRepository,
} from '../../src/workroom/remote-dispatch-outbox.js';
import {
  runWorkroomRemoteDispatchOnce,
  type RunWorkroomRemoteDispatchOnceInput,
} from '../../src/workroom/remote-dispatch-worker.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchOutboxItem,
} from '../../src/workroom/remote-dispatch.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

describe('Workroom Remote Dispatch worker', () => {
  it('claims a pending item and persists the transport observation for the exact item', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const persisted = await repository.read(item.dispatchId);
    const signal = new AbortController().signal;
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'receipt:1',
      remoteTaskId: 'remote-task:1',
    }));
    const executor: WorkroomRemoteExecutorPort = { dispatch };

    const result = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, executor, { signal },
    ));

    expect(dispatch).toHaveBeenCalledWith(persisted!.item, signal);
    expect(result).toMatchObject({
      sequence: 2,
      status: 'delivered',
      attemptCount: 1,
      observations: [{
        observationId: 'send:1',
        observedAt: 1_100,
        leaseFence: 1,
        outcome: 'delivered',
        receiptId: 'receipt:1',
      }],
    });
    expect(result).not.toHaveProperty('taskStatus');
  });

  it('leaves outcome_unknown in reconciliation without automatically resending it', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const firstExecutor: WorkroomRemoteExecutorPort = {
      dispatch: async () => ({
        outcome: 'outcome_unknown',
        receiptId: 'receipt:unknown',
        reason: 'connection closed after request body',
      }),
    };
    const signal = new AbortController().signal;

    const first = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, firstExecutor, { signal },
    ));
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'must-not-be-sent',
    }));

    const replay = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, { dispatch }, {
        expectedSequence: 2,
        now: 1_200,
        ownerId: 'worker:2',
        leaseId: 'lease:2',
        leaseFence: 2,
        leaseExpiresAt: 1_600,
        observationId: 'send:2',
        signal,
      },
    ));

    expect(first).toMatchObject({ status: 'reconcile_required', sequence: 2 });
    expect(replay).toEqual(first);
    expect(dispatch).not.toHaveBeenCalled();
    expect(replay.observations).toHaveLength(1);
  });

  it('retries a transport failure only after recovering with a higher lease fence', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const signal = new AbortController().signal;
    await runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => ({
        outcome: 'failed', receiptId: 'receipt:failed', reason: 'upstream unavailable',
      }),
    }, { signal }));
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'receipt:delivered',
    }));

    const result = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, { dispatch }, {
        expectedSequence: 2,
        now: 1_200,
        ownerId: 'worker:2',
        leaseId: 'lease:2',
        leaseFence: 2,
        leaseExpiresAt: 1_600,
        observationId: 'send:2',
        signal,
      },
    ));

    expect(dispatch).toHaveBeenCalledWith(item, signal);
    expect(result).toMatchObject({
      status: 'delivered',
      sequence: 4,
      attemptCount: 2,
      lastLeaseFence: 2,
      observations: [
        { observationId: 'send:1', leaseFence: 1, outcome: 'failed' },
        { observationId: 'send:2', leaseFence: 2, outcome: 'delivered' },
      ],
    });
  });

  it('takes over an expired lease with a higher fence and rejects the old lease observation', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    await repository.claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'worker:old',
      leaseId: 'lease:old',
      leaseFence: 1,
      leaseExpiresAt: 1_150,
    });

    const result = await runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => ({ outcome: 'delivered', receiptId: 'receipt:new' }),
    }, {
      expectedSequence: 1,
      now: 1_200,
      ownerId: 'worker:new',
      leaseId: 'lease:new',
      leaseFence: 2,
      leaseExpiresAt: 1_600,
      observationId: 'send:new',
      signal: new AbortController().signal,
    }));

    expect(result).toMatchObject({
      status: 'delivered',
      sequence: 3,
      attemptCount: 2,
      lastLeaseFence: 2,
      lastRecoveryCause: 'lease_expired',
      observations: [{ observationId: 'send:new', leaseFence: 2 }],
    });
    await expect(repository.recordTransportObservation({
      dispatchId: item.dispatchId,
      expectedSequence: 3,
      now: 1_250,
      leaseId: 'lease:old',
      leaseFence: 1,
      observationId: 'send:late-old',
      observation: { outcome: 'delivered', receiptId: 'receipt:stale' },
    })).rejects.toThrow('lease/fence');
  });

  it('persists inflight cancellation as unknown before preserving Abort to the caller', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'workroom-remote-worker-abort-'));
    temporaryDirectories.push(parent);
    const directory = join(parent, 'outbox');
    let repository: WorkroomRemoteDispatchOutboxRepository =
      new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const controller = new AbortController();
    const cancelled = new DOMException('Sponsor cancelled remote dispatch', 'AbortError');
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const executor: WorkroomRemoteExecutorPort = {
      dispatch: async (_item, signal) => {
        expect(signal).toBe(controller.signal);
        markStarted();
        return await new Promise(() => {});
      },
    };
    const running = runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, executor, { signal: controller.signal },
    ));
    await started;

    controller.abort(cancelled);

    await expect(Promise.race([
      running,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Remote Dispatch worker did not cancel')),
        500,
      )),
    ])).rejects.toBe(cancelled);
    await expect(repository.read(item.dispatchId)).resolves.toMatchObject({
      status: 'reconcile_required',
      sequence: 2,
      observations: [{
        observationId: 'send:1',
        outcome: 'outcome_unknown',
        receiptId: 'workroom-transport-exception:v1:'
          + 'workroom-dispatch%3Av1%3Aproject-1%3Arun-1%3Aassignment-1%3A1%3A7:'
          + 'send%3A1',
        reason: 'transport_exception:AbortError',
      }],
    });

    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'must-not-be-sent-after-abort-restart',
    }));
    repository = new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const afterRestart = await runWorkroomRemoteDispatchOnce(workerInput(
      repository,
      item,
      { dispatch },
      {
        expectedSequence: 2,
        now: 1_600,
        ownerId: 'worker:restarted',
        leaseId: 'lease:restarted',
        leaseFence: 2,
        leaseExpiresAt: 2_000,
        observationId: 'send:restart',
      },
    ));
    expect(afterRestart).toMatchObject({ status: 'reconcile_required', sequence: 2 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists an Executor-thrown AbortError before rethrowing it', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const aborted = new DOMException('remote transport aborted', 'AbortError');

    await expect(runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => { throw aborted; },
    }))).rejects.toBe(aborted);

    await expect(repository.read(item.dispatchId)).resolves.toMatchObject({
      status: 'reconcile_required',
      sequence: 2,
      observations: [{
        outcome: 'outcome_unknown',
        reason: 'transport_exception:AbortError',
      }],
    });
  });

  it('treats an already delivered item as an idempotent no-op', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    const signal = new AbortController().signal;
    const first = await runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => ({ outcome: 'delivered', receiptId: 'receipt:1' }),
    }, { signal }));
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const, receiptId: 'receipt:duplicate',
    }));

    const replay = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, { dispatch }, {
        expectedSequence: 2,
        now: 1_200,
        ownerId: 'worker:2',
        leaseId: 'lease:2',
        leaseFence: 2,
        leaseExpiresAt: 1_600,
        observationId: 'send:2',
        signal,
      },
    ));

    expect(replay).toEqual(first);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not redispatch an active unexpired lease', async () => {
    const repository = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);
    await repository.claim({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'worker:active',
      leaseId: 'lease:active',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
    });
    const before = await repository.read(item.dispatchId);
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const, receiptId: 'must-not-be-sent',
    }));

    const result = await runWorkroomRemoteDispatchOnce(workerInput(
      repository, item, { dispatch }, {
        expectedSequence: 1,
        now: 1_499,
        ownerId: 'worker:other',
        leaseId: 'lease:other',
        leaseFence: 2,
        leaseExpiresAt: 1_900,
        observationId: 'send:other',
        signal: new AbortController().signal,
      },
    ));

    expect(result).toEqual(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists a transport rejection as outcome_unknown and never resends after worker restart', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'workroom-remote-worker-'));
    temporaryDirectories.push(parent);
    const directory = join(parent, 'outbox');
    let repository: WorkroomRemoteDispatchOutboxRepository =
      new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);

    const unknown = await runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => {
        throw new Error('socket closed after request body; token=must-not-persist');
      },
    }));

    expect(unknown).toMatchObject({
      status: 'reconcile_required',
      sequence: 2,
      observations: [{
        observationId: 'send:1',
        outcome: 'outcome_unknown',
        receiptId: 'workroom-transport-exception:v1:'
          + 'workroom-dispatch%3Av1%3Aproject-1%3Arun-1%3Aassignment-1%3A1%3A7:'
          + 'send%3A1',
        reason: 'transport_exception:Error',
      }],
    });
    expect(JSON.stringify(unknown)).not.toContain('must-not-persist');

    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'must-not-be-sent-after-restart',
    }));
    repository = new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const afterRestart = await runWorkroomRemoteDispatchOnce(workerInput(
      repository,
      item,
      { dispatch },
      {
        expectedSequence: 2,
        now: 1_600,
        ownerId: 'worker:restarted',
        leaseId: 'lease:restarted',
        leaseFence: 2,
        leaseExpiresAt: 2_000,
        observationId: 'send:restart',
      },
    ));

    expect(afterRestart).toEqual(unknown);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists a malformed resolved observation as outcome_unknown before restart', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'workroom-remote-worker-malformed-'));
    temporaryDirectories.push(parent);
    const directory = join(parent, 'outbox');
    let repository: WorkroomRemoteDispatchOutboxRepository =
      new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const item = dispatchItem();
    await repository.enqueue(item, -1, 1_000);

    const unknown = await runWorkroomRemoteDispatchOnce(workerInput(repository, item, {
      dispatch: async () => ({ outcome: 'delivered', receiptId: '' }),
    }));
    expect(unknown).toMatchObject({
      status: 'reconcile_required',
      sequence: 2,
      observations: [{ outcome: 'outcome_unknown', reason: 'transport_exception:Error' }],
    });

    const dispatch = vi.fn(async () => ({ outcome: 'delivered' as const, receiptId: 'must-not-send' }));
    repository = new FileWorkroomRemoteDispatchOutboxRepository(directory);
    const restarted = await runWorkroomRemoteDispatchOnce(workerInput(repository, item, { dispatch }, {
      expectedSequence: 2,
      now: 1_600,
      leaseFence: 2,
      observationId: 'send:restart',
    }));
    expect(restarted).toEqual(unknown);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function workerInput(
  repository: WorkroomRemoteDispatchOutboxRepository,
  item: WorkroomRemoteDispatchOutboxItem,
  executor: WorkroomRemoteExecutorPort,
  overrides: Partial<RunWorkroomRemoteDispatchOnceInput> = {},
): RunWorkroomRemoteDispatchOnceInput {
  return {
    repository,
    executor,
    dispatchId: item.dispatchId,
    expectedSequence: 0,
    now: 1_100,
    ownerId: 'worker:1',
    leaseId: 'lease:1',
    leaseFence: 1,
    leaseExpiresAt: 1_500,
    observationId: 'send:1',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function dispatchItem() {
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
    capabilitySnapshot: {
      ref: 'capability:1', hash: 'sha256:capability', grantRef: 'grant:1',
    },
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
  });
}
