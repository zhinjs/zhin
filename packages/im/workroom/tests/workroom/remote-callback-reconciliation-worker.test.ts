import { describe, expect, it, vi } from 'vitest';
import {
  MemoryRemoteCallbackInboxRepository,
  RemoteCallbackInbox,
  createRemoteExecutionLink,
  digestRemoteCallbackMessage,
  type RemoteCallbackEnvelope,
  type RemoteCallbackMessage,
  type RemoteExecutionLink,
} from '../../src/workroom/remote-callback-inbox.js';
import {
  digestRemoteCallbackPollSnapshot,
  runRemoteCallbackReconciliationOnce,
  type RemoteCallbackPollPort,
  type RemoteCallbackPollSnapshot,
  type RemoteCallbackPollSnapshotInput,
} from '../../src/workroom/remote-callback-reconciliation-worker.js';

const SHA = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

describe('Remote Callback Reconciliation Worker', () => {
  it('polls an exact frozen Link request and durably reconciles a trusted snapshot', async () => {
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 2, 'event-2'), -1);
    const missing = callback(link, 1, 'event-1', 'poll');
    const snapshot = pollSnapshot(link, 0, 2, 3_000, [missing]);
    const poll = vi.fn<RemoteCallbackPollPort['poll']>(async (request, signal) => {
      expect(request).toEqual({
        version: 1,
        linkId: link.id,
        endpointId: link.endpoint.id,
        cardDigest: link.endpoint.cardDigest,
        authBindingId: link.endpoint.authBindingId,
        remoteTaskId: link.remoteTaskId,
        remoteContextId: link.remoteContextId,
        fromCursor: 0,
        reconcileDeadline: link.reconcileDeadline,
      });
      expect(Object.isFrozen(request)).toBe(true);
      expect(signal.aborted).toBe(false);
      return snapshot;
    });

    const outcome = await runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: { now: () => 2_500 },
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      status: 'reconciled',
      snapshotDigest: snapshot.digest,
      projection: {
        status: 'open',
        callbackCursor: 2,
        accepted: [
          { eventId: 'event-1', observation: { type: 'heartbeat' } },
          { eventId: 'event-2', observation: { type: 'heartbeat' } },
        ],
      },
    });
    expect(poll).toHaveBeenCalledOnce();
  });

  it('returns typed noop or expired outcomes without polling or changing durable facts', async () => {
    const link = remoteLink();
    const repository = new MemoryRemoteCallbackInboxRepository();
    const inbox = new RemoteCallbackInbox(repository, link, { maxSequenceGap: 4 });
    const poll = vi.fn<RemoteCallbackPollPort['poll']>();
    const signal = new AbortController().signal;

    await expect(runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: { now: () => 2_500 },
      signal,
    })).resolves.toEqual({ status: 'noop', reason: 'not_registered' });

    await inbox.receive(callback(link, 1, 'event-open'), -1);
    await expect(runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: { now: () => 2_500 },
      signal,
    })).resolves.toMatchObject({ status: 'noop', reason: 'not_required' });

    const gapLink = remoteLink('assignment-gap');
    const gapInbox = new RemoteCallbackInbox(repository, gapLink, { maxSequenceGap: 4 });
    const before = await gapInbox.receive(callback(gapLink, 2, 'event-gap'), -1);
    const expired = await runRemoteCallbackReconciliationOnce({
      inbox: gapInbox,
      pollPort: { poll },
      clock: { now: () => gapLink.reconcileDeadline + 1 },
      signal,
    });

    expect(expired).toEqual({
      status: 'expired',
      deadline: gapLink.reconcileDeadline,
      observedAt: gapLink.reconcileDeadline + 1,
      projection: before.projection,
    });
    expect(expired).not.toHaveProperty('taskStatus');
    expect(poll).not.toHaveBeenCalled();
    await expect(gapInbox.read()).resolves.toEqual(before.projection);
  });

  it.each([
    {
      name: 'canonical digest',
      mutate: (snapshot: RemoteCallbackPollSnapshot): RemoteCallbackPollSnapshot => ({
        ...snapshot,
        digest: SHA,
      }),
      error: 'canonical digest',
    },
    {
      name: 'exact schema',
      mutate: (snapshot: RemoteCallbackPollSnapshot): RemoteCallbackPollSnapshot => ({
        ...snapshot,
        unexpectedAuthority: 'forbidden',
      } as RemoteCallbackPollSnapshot),
      error: 'forbidden field unexpectedAuthority',
    },
  ])('rejects a poll snapshot with an invalid $name before reconciliation', async ({
    mutate,
    error,
  }) => {
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    const before = await inbox.receive(callback(link, 2, 'event-2'), -1);
    const missing = callback(link, 1, 'event-1', 'poll');
    const snapshot = mutate(pollSnapshot(link, 0, 2, 3_000, [missing]));

    await expect(runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll: async () => snapshot },
      clock: { now: () => 2_500 },
      signal: new AbortController().signal,
    })).rejects.toThrow(error);
    await expect(inbox.read()).resolves.toEqual(before.projection);
  });

  it.each([
    {
      name: 'endpoint scope',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        endpointId: 'a2a-attacker',
      }),
      error: 'endpointId does not match',
    },
    {
      name: 'Card binding',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({ ...snapshot, cardDigest: SHA_B }),
      error: 'cardDigest does not match',
    },
    {
      name: 'authentication binding',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        authBindingId: 'auth-attacker',
      }),
      error: 'authBindingId does not match',
    },
    {
      name: 'Link scope',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({ ...snapshot, linkId: 'other-link' }),
      error: 'linkId does not match',
    },
    {
      name: 'durable cursor',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        fromCursor: snapshot.fromCursor + 1,
      }),
      error: 'fromCursor does not match',
    },
    {
      name: 'snapshot cursor',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        snapshotCursor: snapshot.snapshotCursor + 1,
      }),
      error: 'snapshotCursor does not match',
    },
    {
      name: 'poll Gateway source',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({
          ...item,
          gatewayReceipt: { ...item.gatewayReceipt, source: 'push' as const },
        })),
      }),
      error: 'Gateway source',
    },
    {
      name: 'poll Gateway authority',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({
          ...item,
          gatewayReceipt: { ...item.gatewayReceipt, authBindingId: 'auth-attacker' },
        })),
      }),
      error: 'Gateway authBindingId does not match',
    },
    {
      name: 'poll Gateway exact schema',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({
          ...item,
          gatewayReceipt: {
            ...item.gatewayReceipt,
            selfReportedRole: 'orchestrator',
          } as RemoteCallbackEnvelope['gatewayReceipt'],
        })),
      }),
      error: 'Gateway receipt contains forbidden field selfReportedRole',
    },
    {
      name: 'poll Gateway receipt identity',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({
          ...item,
          gatewayReceipt: { ...item.gatewayReceipt, receiptId: '' },
        })),
      }),
      error: 'Gateway receiptId',
    },
    {
      name: 'poll Gateway trusted time',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({
          ...item,
          gatewayReceipt: { ...item.gatewayReceipt, receivedAt: -1 },
        })),
      }),
      error: 'Gateway receivedAt',
    },
    {
      name: 'full callback digest',
      mutate: (snapshot: RemoteCallbackPollSnapshot) => ({
        ...snapshot,
        callbacks: snapshot.callbacks.map(item => ({ ...item, eventId: 'event-tampered' })),
      }),
      error: 'full callback digest',
    },
  ])('validates $name before calling the durable Inbox', async ({ mutate, error }) => {
    const link = remoteLink();
    const durableInbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    await durableInbox.receive(callback(link, 2, 'event-2'), -1);
    const trusted = pollSnapshot(link, 0, 2, 3_000, [callback(link, 1, 'event-1', 'poll')]);
    const snapshot = redigestSnapshot(mutate(trusted));
    const reconcile = vi.fn(durableInbox.reconcile.bind(durableInbox));

    await expect(runRemoteCallbackReconciliationOnce({
      inbox: {
        link,
        read: durableInbox.read.bind(durableInbox),
        reconcile,
      },
      pollPort: { poll: async () => snapshot },
      clock: { now: () => 2_500 },
      signal: new AbortController().signal,
    })).rejects.toThrow(error);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('fails closed on an invalid trusted clock without starting a poll', async () => {
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 2, 'event-2'), -1);
    const poll = vi.fn<RemoteCallbackPollPort['poll']>();

    await expect(runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: { now: () => Number.NaN },
      signal: new AbortController().signal,
    })).rejects.toThrow('clock.now');
    expect(poll).not.toHaveBeenCalled();
  });

  it('does not start polling when cancellation wins after the durable read', async () => {
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 2, 'event-2'), -1);
    const controller = new AbortController();
    const abortReason = new Error('cancel before poll');
    const poll = vi.fn<RemoteCallbackPollPort['poll']>();

    await expect(runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: {
        now: () => {
          controller.abort(abortReason);
          return 2_500;
        },
      },
      signal: controller.signal,
    })).rejects.toBe(abortReason);
    expect(poll).not.toHaveBeenCalled();
  });

  it('treats a trusted snapshot observed after the Link deadline as expired', async () => {
    const link = remoteLink();
    const durableInbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    const before = await durableInbox.receive(callback(link, 2, 'event-2'), -1);
    const missing = callback(link, 1, 'event-1', 'poll');
    const snapshot = pollSnapshot(
      link,
      0,
      2,
      link.reconcileDeadline + 1,
      [missing],
    );
    const reconcile = vi.fn(durableInbox.reconcile.bind(durableInbox));

    await expect(runRemoteCallbackReconciliationOnce({
      inbox: {
        link,
        read: durableInbox.read.bind(durableInbox),
        reconcile,
      },
      pollPort: { poll: async () => snapshot },
      clock: { now: () => link.reconcileDeadline },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      status: 'expired',
      deadline: link.reconcileDeadline,
      observedAt: snapshot.polledAt,
      projection: before.projection,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('races AbortSignal against a poll adapter that never cooperates', async () => {
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    const before = await inbox.receive(callback(link, 2, 'event-2'), -1);
    const controller = new AbortController();
    let startPoll: (() => void) | undefined;
    const started = new Promise<void>(resolve => { startPoll = resolve; });
    const poll = vi.fn<RemoteCallbackPollPort['poll']>(async (_request, signal) => {
      expect(signal).toBe(controller.signal);
      startPoll!();
      return await new Promise<RemoteCallbackPollSnapshot>(() => {});
    });
    const running = runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: { poll },
      clock: { now: () => 2_500 },
      signal: controller.signal,
    });
    await started;
    const abortReason = new Error('cancel reconciliation worker');
    controller.abort(abortReason);

    const observed = await Promise.race([
      running.then(
        () => 'unexpected resolution',
        error => error,
      ),
      new Promise(resolve => setTimeout(() => { resolve('abort race timed out'); }, 25)),
    ]);
    expect(observed).toBe(abortReason);
    expect(poll).toHaveBeenCalledOnce();
    await expect(inbox.read()).resolves.toEqual(before.projection);
  });

  it('uses durable Inbox state to make a lost-response restart idempotent', async () => {
    const link = remoteLink();
    const repository = new MemoryRemoteCallbackInboxRepository();
    const durableInbox = new RemoteCallbackInbox(repository, link, { maxSequenceGap: 4 });
    await durableInbox.receive(callback(link, 2, 'event-2'), -1);
    const missing = callback(link, 1, 'event-1', 'poll');
    const snapshot = pollSnapshot(link, 0, 2, 3_000, [missing]);
    const poll = vi.fn<RemoteCallbackPollPort['poll']>(async () => snapshot);
    let loseResponse = true;

    await expect(runRemoteCallbackReconciliationOnce({
      inbox: {
        link,
        read: durableInbox.read.bind(durableInbox),
        reconcile: async (...args) => {
          const projection = await durableInbox.reconcile(...args);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('injected lost response after durable commit');
          }
          return projection;
        },
      },
      pollPort: { poll },
      clock: { now: () => 2_500 },
      signal: new AbortController().signal,
    })).rejects.toThrow('lost response');

    const restarted = new RemoteCallbackInbox(repository, link, { maxSequenceGap: 4 });
    await expect(runRemoteCallbackReconciliationOnce({
      inbox: restarted,
      pollPort: { poll },
      clock: { now: () => 3_500 },
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'noop',
      reason: 'not_required',
      projection: { status: 'open', callbackCursor: 2 },
    });
    expect(poll).toHaveBeenCalledOnce();
  });
});

function remoteLink(assignmentId = 'assignment-1'): RemoteExecutionLink {
  return createRemoteExecutionLink({
    linkedAt: 1_000,
    reconcileDeadline: 10_000,
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'implement-callback-inbox',
    taskRevision: 2,
    assignmentId,
    assignmentRevision: 3,
    attempt: 1,
    fence: 7,
    assignmentEnvelopeDigest: SHA,
    dispatchId: 'dispatch-1',
    messageId: 'message-1',
    dispatchEnvelopeDigest: SHA_B,
    endpoint: {
      id: 'a2a-primary',
      cardDigest: SHA,
      authBindingId: 'auth-binding-1',
    },
    remoteTaskId: 'remote-task-1',
    remoteContextId: 'remote-context-1',
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:zhinjs/zhin',
      integrationBindingId: 'github-app-1',
      baseSha: '1'.repeat(40),
      checkpointSha: '3'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/workroom/assignment-1/attempt-1-fence-7',
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: 7,
    },
  });
}

function callback(
  link: RemoteExecutionLink,
  callbackSequence: number,
  eventId: string,
  source: 'push' | 'poll' = 'push',
): RemoteCallbackEnvelope {
  const message: RemoteCallbackMessage = {
    version: 1,
    callbackSequence,
    eventId,
    linkId: link.id,
    projectId: link.projectId,
    runId: link.runId,
    taskKey: link.taskKey,
    taskRevision: link.taskRevision,
    assignmentId: link.assignmentId,
    assignmentRevision: link.assignmentRevision,
    attempt: link.attempt,
    fence: link.fence,
    assignmentEnvelopeDigest: link.assignmentEnvelopeDigest,
    dispatchId: link.dispatchId,
    messageId: link.messageId,
    dispatchEnvelopeDigest: link.dispatchEnvelopeDigest,
    claimedEndpoint: {
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
    },
    remoteTaskId: link.remoteTaskId,
    remoteContextId: link.remoteContextId,
    payload: { type: 'heartbeat' },
  };
  return {
    ...message,
    gatewayReceipt: {
      receiptId: `gateway-receipt-${eventId}`,
      source,
      receivedAt: 2_000 + callbackSequence,
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
      callbackDigest: digestRemoteCallbackMessage(message),
    },
  };
}

function pollSnapshot(
  link: RemoteExecutionLink,
  fromCursor: number,
  snapshotCursor: number,
  polledAt: number,
  callbacks: readonly RemoteCallbackEnvelope[],
): RemoteCallbackPollSnapshot {
  const input: RemoteCallbackPollSnapshotInput = {
    version: 1,
    endpointId: link.endpoint.id,
    cardDigest: link.endpoint.cardDigest,
    authBindingId: link.endpoint.authBindingId,
    linkId: link.id,
    fromCursor,
    snapshotCursor,
    polledAt,
    callbacks,
  };
  return { ...input, digest: digestRemoteCallbackPollSnapshot(input) };
}

function redigestSnapshot(snapshot: RemoteCallbackPollSnapshot): RemoteCallbackPollSnapshot {
  const { digest: _digest, ...input } = snapshot;
  return { ...input, digest: digestRemoteCallbackPollSnapshot(input) };
}
