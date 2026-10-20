import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkroomRemoteDispatchOutboxRepository } from '../../src/workroom/remote-dispatch-outbox.js';
import { RemoteAssignmentDispatchScheduler } from '../../src/workroom/remote-dispatch-scheduler.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  createWorkroomRemoteDispatchOutboxItem,
} from '../../src/workroom/remote-dispatch.js';
import { remoteDisclosureFixture } from './remote-disclosure-fixture.js';

describe('Remote Assignment Dispatch Scheduler', () => {
  it('discovers restart-persisted work and consumes it with a fenced generation lease', async () => {
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await outbox.enqueue(item, -1, 1_000);
    const runOnce = vi.fn(async () => (await outbox.read(item.dispatchId))!);
    const scheduler = new RemoteAssignmentDispatchScheduler({
      outbox,
      dispatch: { runOnce },
      ownerId: 'generation:7',
      clock: { now: () => 1_100 },
      leaseMs: 400,
      pollIntervalMs: 5_000,
    });

    await scheduler.drain();

    expect(runOnce).toHaveBeenCalledOnce();
    expect(runOnce).toHaveBeenCalledWith(expect.objectContaining({
      dispatchId: item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'generation:7',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
      signal: expect.any(AbortSignal),
    }));
    expect(runOnce.mock.calls[0]![0].leaseId).toContain(encodeURIComponent(item.dispatchId));
  });

  it('aborts local transport on operator cancel without claiming that the remote stopped', async () => {
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const item = dispatchItem();
    await outbox.enqueue(item, -1, 1_000);
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    const runOnce = vi.fn(async (input: { signal: AbortSignal }) => {
      started();
      await new Promise((_, reject) => input.signal.addEventListener(
        'abort', () => reject(input.signal.reason), { once: true },
      ));
      return (await outbox.read(item.dispatchId))!;
    });
    const scheduler = new RemoteAssignmentDispatchScheduler({
      outbox,
      dispatch: { runOnce },
      ownerId: 'generation:7',
      clock: { now: () => 1_100 },
    });
    const draining = scheduler.drain();
    await dispatched;

    const receipt = scheduler.requestOperatorCancel(item.dispatchId, 'Sponsor requested cancel');

    expect(receipt).toEqual({
      dispatchId: item.dispatchId,
      localDispatchAborted: true,
      remoteStopConfirmed: false,
      nextAction: 'reconcile_or_replan',
    });
    await expect(draining).resolves.toBeUndefined();
  });
});

function dispatchItem() {
  return createWorkroomRemoteDispatchOutboxItem({
    projectId: 'project-1', runId: 'run-1', taskKey: 'task-1', taskRevision: 1,
    assignmentId: 'assignment-1', attempt: 1, fence: 7,
    endpoint: {
      id: 'endpoint-1', owner: 'remote-owner', cardDigest: `sha256:${'a'.repeat(64)}`,
      authBindingId: 'auth-1', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true, typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'context:1', hash: `sha256:${'b'.repeat(64)}` },
    acceptanceContract: { ref: 'acceptance:1', hash: `sha256:${'c'.repeat(64)}` },
    capabilitySnapshot: {
      ref: 'capabilities:1', hash: `sha256:${'d'.repeat(64)}`, grantRef: 'grant:1',
    },
    disclosureManifest: remoteDisclosureFixture({
      endpointId: 'endpoint-1', sourceRef: 'context:1', sourceDigest: `sha256:${'b'.repeat(64)}`,
    }),
    workspace: {
      provider: 'github_pull_request', repositoryId: 'repo-1', integrationBindingId: 'github-1',
      baseSha: '1'.repeat(40), targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/zhin/assignment-1-7', pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr', fence: 7,
    },
  });
}
