import { describe, expect, it, vi } from 'vitest';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import {
  bindRemoteExecutionLinkTransportReceipt,
  MemoryRemoteExecutionLinkRegistryRepository,
} from '../../src/workroom/remote-callback-application.js';
import {
  RemoteAssignmentDispatchService,
} from '../../src/workroom/remote-dispatch-admission.js';
import { remoteDisclosureFixture } from './remote-disclosure-fixture.js';
import {
  MemoryWorkroomRemoteDispatchOutboxRepository,
} from '../../src/workroom/remote-dispatch-outbox.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  type WorkroomRemoteDispatchInput,
} from '../../src/workroom/remote-dispatch.js';
import type { WorkroomRunState } from '../../src/workroom/kernel-contracts.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;
const SHA_F = `sha256:${'f'.repeat(64)}`;
const GIT_SHA = '1'.repeat(40);
const readyGovernance = Object.freeze({
  revalidate: async (input: ReturnType<typeof remoteDisclosureFixture>) => Object.freeze({
    status: 'ready' as const,
    manifest: input.manifest,
    body: new TextEncoder().encode('governed remote context'),
  }),
});

describe('Remote Assignment Dispatch production seam', () => {
  it('preregisters exact Link authority before durable enqueue and binds A2A receipt before observation', async () => {
    const envelope = assignmentEnvelope();
    const runState = claimedRun(envelope);
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const order: string[] = [];
    const preregisterPending = vi.spyOn(registry, 'preregisterPending').mockImplementation(async (...args) => {
      order.push('link.preregistered');
      return await MemoryRemoteExecutionLinkRegistryRepository.prototype.preregisterPending
        .apply(registry, args);
    });
    const enqueue = vi.spyOn(outbox, 'enqueue').mockImplementation(async (...args) => {
      order.push('outbox.enqueued');
      return await MemoryWorkroomRemoteDispatchOutboxRepository.prototype.enqueue
        .apply(outbox, args);
    });
    const bindTransportReceipt = vi.spyOn(registry, 'bindTransportReceipt')
      .mockImplementation(async (...args) => {
        order.push('link.receipt_bound');
        return await MemoryRemoteExecutionLinkRegistryRepository.prototype.bindTransportReceipt
          .apply(registry, args);
      });
    let deliveredBody: Uint8Array | undefined;
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => runState },
      linkRegistry: registry,
      outbox,
      executor: {
        dispatch: async (_item, _signal, governedBody) => {
          deliveredBody = governedBody;
          order.push('a2a.sent');
          return {
            outcome: 'delivered',
            receiptId: 'receipt-1',
            remoteTaskId: 'remote-task-1',
            remoteContextId: 'remote-context-1',
          };
        },
      },
      clock: { now: () => 1_100 },
    });

    const admitted = await service.admit({
      envelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    });
    expect(order).toEqual(['link.preregistered', 'outbox.enqueued']);
    expect(preregisterPending).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    await expect(registry.read(admitted.linkId)).resolves.toBeUndefined();

    const result = await service.runOnce({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'generation-7:worker-1',
      leaseId: 'generation-7:lease-1',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
      observationId: 'transport-attempt-1',
      signal: new AbortController().signal,
    });

    expect(order).toEqual([
      'link.preregistered',
      'outbox.enqueued',
      'a2a.sent',
      'link.receipt_bound',
    ]);
    expect(bindTransportReceipt).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(deliveredBody)).toBe('governed remote context');
    expect(result).toMatchObject({ status: 'delivered' });
    await expect(registry.read(admitted.linkId)).resolves.toMatchObject({
      link: {
        remoteTaskId: 'remote-task-1',
        remoteContextId: 'remote-context-1',
        dispatchId: admitted.item.dispatchId,
      },
      assignmentEnvelope: { digest: envelope.digest },
    });

    const terminalService = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => { throw new Error('terminal replay must not require live lease'); } },
      linkRegistry: registry,
      outbox,
      executor: { dispatch: vi.fn() },
      clock: { now: () => 9_000 },
    });
    await expect(terminalService.runOnce({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 2,
      now: 9_000,
      ownerId: 'generation-8:worker',
      leaseId: 'generation-8:lease',
      leaseFence: 2,
      leaseExpiresAt: 9_500,
      observationId: 'terminal-replay',
      signal: new AbortController().signal,
    })).resolves.toEqual(result);
  });

  it('durably blocks revoked disclosure before the A2A executor sees any body', async () => {
    const envelope = assignmentEnvelope();
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    let sends = 0;
    const service = new RemoteAssignmentDispatchService({
      governance: {
        revalidate: async () => ({ status: 'blocked', reason: 'disclosure_recipient_revoked' }),
      },
      runState: { read: async () => claimedRun(envelope) },
      linkRegistry: new MemoryRemoteExecutionLinkRegistryRepository(),
      outbox,
      executor: {
        dispatch: async () => { sends += 1; throw new Error('must not send'); },
      },
      clock: { now: () => 1_100 },
    });
    const admitted = await service.admit({
      envelope, dispatch: dispatchInput(), linkedAt: 1_000,
      reconcileDeadline: 10_000, enqueuedAt: 1_000,
    });

    const result = await service.runOnce({
      dispatchId: admitted.item.dispatchId, expectedSequence: 0, now: 1_100,
      ownerId: 'generation-7:worker-block', leaseId: 'generation-7:lease-block',
      leaseFence: 1, leaseExpiresAt: 1_500, observationId: 'governance-block-1',
      signal: new AbortController().signal,
    });
    expect(sends).toBe(0);
    expect(result).toMatchObject({
      status: 'blocked',
      observations: [],
      governanceBlock: {
        reason: 'disclosure_recipient_revoked', attempt: 1, assignmentFence: 7,
      },
    });
    expect(JSON.stringify(result)).not.toContain('governed remote context');
    await expect(outbox.listRunnable(9_999)).resolves.toEqual([]);
    const restarted = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => { throw new Error('blocked replay must not read live Assignment'); } },
      linkRegistry: new MemoryRemoteExecutionLinkRegistryRepository(),
      outbox,
      executor: { dispatch: async () => { sends += 1; throw new Error('must not revive'); } },
      clock: { now: () => 2_000 },
    });
    await expect(restarted.runOnce({
      dispatchId: admitted.item.dispatchId, expectedSequence: result.sequence, now: 2_000,
      ownerId: 'generation-8:worker', leaseId: 'generation-8:lease', leaseFence: 2,
      leaseExpiresAt: 2_500, observationId: 'must-not-retry',
      signal: new AbortController().signal,
    })).resolves.toEqual(result);
    expect(sends).toBe(0);
  });

  it('requires a new attempt/fence with exact supersedes after governance block', async () => {
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    let currentEnvelope = assignmentEnvelope();
    let currentState = claimedRun(currentEnvelope);
    let governanceReady = false;
    const service = new RemoteAssignmentDispatchService({
      governance: {
        revalidate: async (snapshot) => governanceReady
          ? { status: 'ready', manifest: snapshot.manifest, body: new Uint8Array() }
          : { status: 'blocked', reason: 'disclosure_recipient_revoked' },
      },
      runState: { read: async () => currentState },
      linkRegistry: registry,
      outbox,
      executor: {
        dispatch: async () => ({
          outcome: 'delivered', receiptId: 'successor-receipt',
          remoteTaskId: 'remote-task-2', remoteContextId: 'remote-context-2',
        }),
      },
      clock: { now: () => 1_100 },
    });
    const predecessor = await service.admit({
      envelope: currentEnvelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    });
    const blocked = await service.runOnce({
      dispatchId: predecessor.item.dispatchId, expectedSequence: 0, now: 1_100,
      ownerId: 'generation-7:worker-block', leaseId: 'generation-7:lease-block',
      leaseFence: 1, leaseExpiresAt: 1_500, observationId: 'governance-block-1',
      signal: new AbortController().signal,
    });
    expect(blocked.status).toBe('blocked');

    currentEnvelope = assignmentEnvelope({
      assignmentId: 'assignment-2', assignmentRevision: 2, attempt: 2, fence: 8,
    });
    currentState = claimedRun(currentEnvelope);
    governanceReady = true;
    const successorBase = dispatchInput();
    const successor = {
      ...successorBase,
      assignmentId: currentEnvelope.assignmentId,
      attempt: currentEnvelope.attempt,
      fence: currentEnvelope.fence,
      capabilitySnapshot: {
        ref: 'capabilities:assignment-2:2', hash: SHA_E, grantRef: 'grant:2',
      },
      disclosureManifest: remoteDisclosureFixture({
        assignmentId: currentEnvelope.assignmentId,
        endpointId: successorBase.endpoint.id,
        sourceRef: successorBase.contextView.ref,
        sourceDigest: successorBase.contextView.hash,
      }),
      workspace: {
        ...successorBase.workspace,
        branchRef: 'refs/heads/zhin/assignment-2-8',
        fence: currentEnvelope.fence,
      },
    } satisfies WorkroomRemoteDispatchInput;

    await expect(service.admit({
      envelope: currentEnvelope,
      dispatch: successor,
      linkedAt: 1_200,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_200,
    })).rejects.toThrow('supersedes authority');

    const admitted = await service.admit({
      envelope: currentEnvelope,
      dispatch: {
        ...successor,
        supersedes: {
          dispatchId: predecessor.item.dispatchId,
          manifestDigest: predecessor.item.envelope.disclosureManifest.manifest.digest,
        },
      },
      linkedAt: 1_200,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_200,
    });
    expect(admitted.item.dispatchId).not.toBe(predecessor.item.dispatchId);
    expect(admitted.item.messageId).not.toBe(predecessor.item.messageId);
    expect(admitted.item.envelope.supersedes).toEqual({
      dispatchId: predecessor.item.dispatchId,
      manifestDigest: predecessor.item.envelope.disclosureManifest.manifest.digest,
    });
    await expect(outbox.read(predecessor.item.dispatchId)).resolves.toEqual(blocked);
  });

  it('fails closed before transport when the claimed Assignment authority is stale', async () => {
    const envelope = assignmentEnvelope();
    const dispatch = vi.fn();
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: {
        read: async () => ({
          ...claimedRun(envelope),
          assignments: {
            'assignment-1': {
              ...claimedRun(envelope).assignments['assignment-1']!,
              fence: envelope.fence + 1,
            },
          },
        }),
      },
      linkRegistry: new MemoryRemoteExecutionLinkRegistryRepository(),
      outbox: new MemoryWorkroomRemoteDispatchOutboxRepository(),
      executor: { dispatch },
      clock: { now: () => 1_100 },
    });

    await expect(service.admit({
      envelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    })).rejects.toThrow('stale');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('caps the worker lease at the trusted Assignment lease instead of rejecting scheduler work', async () => {
    const envelope = assignmentEnvelope();
    const state = claimedRun(envelope);
    const runState = {
      ...state,
      assignments: {
        ...state.assignments,
        [envelope.assignmentId]: {
          ...state.assignments[envelope.assignmentId]!,
          leaseExpiresAt: 1_300,
        },
      },
    };
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => runState },
      linkRegistry: new MemoryRemoteExecutionLinkRegistryRepository(),
      outbox,
      executor: {
        dispatch: async () => ({
          outcome: 'delivered', receiptId: 'receipt-1',
          remoteTaskId: 'remote-task-1', remoteContextId: 'remote-context-1',
        }),
      },
      clock: { now: () => 1_100 },
    });
    const admitted = await service.admit({
      envelope, dispatch: dispatchInput(), linkedAt: 1_000,
      reconcileDeadline: 10_000, enqueuedAt: 1_000,
    });

    await expect(service.runOnce({
      dispatchId: admitted.item.dispatchId, expectedSequence: 0, now: 1_100,
      ownerId: 'generation-7', leaseId: 'lease-1', leaseFence: 1,
      leaseExpiresAt: 11_100, observationId: 'send-1',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'delivered',
      observations: [{ observedAt: 1_100 }],
    });
    await expect(outbox.read(admitted.item.dispatchId)).resolves.toMatchObject({
      observations: [{ leaseFence: 1 }],
    });
  });

  it('does not bind a delivered receipt after the Assignment lease expires during I/O', async () => {
    const envelope = assignmentEnvelope();
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const state = claimedRun(envelope);
    const runState = {
      ...state,
      assignments: {
        ...state.assignments,
        [envelope.assignmentId]: {
          ...state.assignments[envelope.assignmentId]!,
          leaseExpiresAt: 1_500,
        },
      },
    };
    const times = [1_100, 1_100, 1_600, 1_600];
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => runState },
      linkRegistry: registry,
      outbox: new MemoryWorkroomRemoteDispatchOutboxRepository(),
      executor: {
        dispatch: async () => ({
          outcome: 'delivered', receiptId: 'late-receipt',
          remoteTaskId: 'late-task', remoteContextId: 'late-context',
        }),
      },
      clock: { now: () => times.shift() ?? 1_600 },
    });
    const admitted = await service.admit({
      envelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    });

    await expect(service.runOnce({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'generation-7:worker-1',
      leaseId: 'generation-7:lease-1',
      leaseFence: 1,
      leaseExpiresAt: 1_400,
      observationId: 'late-attempt',
      signal: new AbortController().signal,
    })).rejects.toThrow('lease expiry');
    await expect(registry.read(admitted.linkId)).resolves.toBeUndefined();
  });

  it('records missing remote receipt identity as outcome_unknown without binding a Link', async () => {
    const envelope = assignmentEnvelope();
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => claimedRun(envelope) },
      linkRegistry: registry,
      outbox: new MemoryWorkroomRemoteDispatchOutboxRepository(),
      executor: {
        dispatch: async () => ({ outcome: 'delivered', receiptId: 'receipt-without-task' }),
      },
      clock: { now: () => 1_100 },
    });
    const admitted = await service.admit({
      envelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    });

    await expect(service.runOnce({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'generation-7:worker-1',
      leaseId: 'generation-7:lease-1',
      leaseFence: 1,
      leaseExpiresAt: 1_500,
      observationId: 'transport-attempt-1',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'reconcile_required' });
    await expect(registry.read(admitted.linkId)).resolves.toBeUndefined();
  });

  it('converges an already-bound receipt into Outbox after restart without resending', async () => {
    const envelope = assignmentEnvelope();
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const outbox = new MemoryWorkroomRemoteDispatchOutboxRepository();
    const dispatch = vi.fn(async () => ({
      outcome: 'delivered' as const,
      receiptId: 'must-not-resend',
      remoteTaskId: 'wrong-task',
      remoteContextId: 'wrong-context',
    }));
    const service = new RemoteAssignmentDispatchService({
      governance: readyGovernance,
      runState: { read: async () => claimedRun(envelope) },
      linkRegistry: registry,
      outbox,
      executor: { dispatch },
      clock: { now: () => 1_200 },
    });
    const admitted = await service.admit({
      envelope,
      dispatch: dispatchInput(),
      linkedAt: 1_000,
      reconcileDeadline: 10_000,
      enqueuedAt: 1_000,
    });
    await outbox.claim({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 0,
      now: 1_100,
      ownerId: 'generation-6:worker',
      leaseId: 'generation-6:lease',
      leaseFence: 1,
      leaseExpiresAt: 1_200,
    });
    const pending = await registry.readPending(admitted.linkId);
    expect(pending).toBeDefined();
    await registry.bindTransportReceipt(bindRemoteExecutionLinkTransportReceipt(
      pending!,
      'remote-task-before-crash',
      'remote-context-before-crash',
    ), 1);
    // Simulates a crash here: Link receipt is durable, Outbox observation is not.

    await expect(service.runOnce({
      dispatchId: admitted.item.dispatchId,
      expectedSequence: 1,
      now: 1_200,
      ownerId: 'generation-7:worker',
      leaseId: 'generation-7:lease',
      leaseFence: 2,
      leaseExpiresAt: 1_600,
      observationId: 'restart-convergence',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'delivered',
      observations: [{
        observationId: 'restart-convergence',
        remoteTaskId: 'remote-task-before-crash',
        remoteContextId: 'remote-context-before-crash',
      }],
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function assignmentEnvelope(overrides: Readonly<{
  assignmentId?: string;
  assignmentRevision?: number;
  attempt?: number;
  fence?: number;
}> = {}) {
  const assignmentId = overrides.assignmentId ?? 'assignment-1';
  const assignmentRevision = overrides.assignmentRevision ?? 1;
  const attempt = overrides.attempt ?? 1;
  const fence = overrides.fence ?? 7;
  return createAssignmentExecutionEnvelope({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'task-1',
    taskRevision: 1,
    assignmentId,
    assignmentRevision,
    attempt,
    fence,
    principalId: 'agent:remote-developer',
    role: 'executor',
    agentDefinition: { ref: 'agent:remote-developer:1', revision: 1, digest: SHA_A },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA_C },
    factAnchor: { ref: 'run:run-1', sequence: 4, digest: SHA_D },
    capabilitySnapshot: {
      ref: `capabilities:${assignmentId}:${assignmentRevision}`,
      revision: assignmentRevision,
      digest: SHA_E,
    },
    policySnapshot: {
      ref: `policy:${assignmentId}:${assignmentRevision}`,
      revision: assignmentRevision,
      digest: SHA_F,
    },
    workspace: {
      leaseRef: `workspace-lease:${assignmentId}:${fence}`,
      mountRef: `github:repo-1:refs/heads/zhin/${assignmentId}-${fence}`,
      baseRevision: GIT_SHA,
      fence,
    },
  });
}

function claimedRun(envelope: ReturnType<typeof assignmentEnvelope>): WorkroomRunState {
  return {
    runId: envelope.runId,
    projectId: envelope.projectId,
    title: 'Remote execution',
    status: 'active',
    sequence: 5,
    now: 1_000,
    cancelRequested: false,
    tasks: {
      [envelope.taskKey]: {
        key: envelope.taskKey, title: 'Task', status: 'executing',
        revision: envelope.taskRevision,
        attempt: envelope.attempt, maxAttempts: 3, required: true, blockers: [],
        currentAssignmentId: envelope.assignmentId,
      },
    },
    assignments: {
      [envelope.assignmentId]: {
        id: envelope.assignmentId, taskKey: envelope.taskKey,
        taskRevision: envelope.taskRevision, revision: envelope.assignmentRevision,
        attempt: envelope.attempt, fence: envelope.fence,
        envelopeDigest: envelope.digest, role: envelope.role,
        status: 'running', owner: envelope.principalId, leaseExpiresAt: 5_000,
        observationDigests: {},
      },
    },
    reviewerAssignments: {},
    sponsorGates: {},
  };
}

function dispatchInput(): WorkroomRemoteDispatchInput {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'task-1',
    taskRevision: 1,
    assignmentId: 'assignment-1',
    attempt: 1,
    fence: 7,
    endpoint: {
      id: 'endpoint-1', owner: 'remote-owner', cardDigest: SHA_A,
      authBindingId: 'auth-1', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true, typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'context-view:1', hash: SHA_B },
    acceptanceContract: { ref: 'acceptance:1', hash: SHA_C },
    capabilitySnapshot: {
      ref: 'capabilities:assignment-1:1', hash: SHA_E, grantRef: 'grant:1',
    },
    disclosureManifest: remoteDisclosureFixture({
      endpointId: 'endpoint-1', sourceRef: 'context-view:1', sourceDigest: SHA_B,
    }),
    workspace: {
      provider: 'github_pull_request', repositoryId: 'repo-1',
      integrationBindingId: 'github-integration-1', baseSha: GIT_SHA,
      targetRef: 'refs/heads/main', branchRef: 'refs/heads/zhin/assignment-1-7',
      pathScope: ['packages/im/agent'], mode: 'branch_and_pr', fence: 7,
    },
  };
}
