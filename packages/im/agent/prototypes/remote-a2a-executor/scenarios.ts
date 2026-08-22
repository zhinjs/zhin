/** Executable acceptance scenarios for decision-map ticket #8 (not production tests). */
import assert from 'node:assert/strict';
import {
  dispatchRemoteA2a,
  initialRemoteA2aJournal,
  replayRemoteA2a,
  type RemoteA2aCommand,
  type RemoteA2aEvent,
  type RemoteCallback,
  type RemoteCompletionEnvelope,
} from './remote-a2a.ts';

const kernel = { id: 'workroom:kernel', role: 'kernel' } as const;
const transport = { id: 'a2a:transport-worker', role: 'transport' } as const;
const gateway = { id: 'a2a:callback-gateway', role: 'callback_gateway' } as const;

function harness() {
  let journal: readonly RemoteA2aEvent[] = initialRemoteA2aJournal();
  return {
    dispatch(command: RemoteA2aCommand) { journal = dispatchRemoteA2a(journal, command); },
    journal: () => journal,
  };
}

function claimAndDispatch(
  dispatch: (command: RemoteA2aCommand) => void,
  assignmentId = 'assignment-1',
  attempt = 1,
  leaseExpiresAt = 100_000,
): void {
  dispatch({
    type: 'claim_remote', actor: kernel, assignmentId, leaseExpiresAt,
    baseSha: 'commit:base-1',
    branchRef: `refs/heads/zhin/run-a2a/implement-auth/attempt-${attempt}-${assignmentId}`,
    pathScope: ['packages/im/agent/**'],
  });
  dispatch({
    type: 'prepare_dispatch', actor: kernel, assignmentId,
    contextViewRef: `context://${assignmentId}`,
    contextViewHash: `sha256:context:${assignmentId}`,
    acceptanceContractRef: 'acceptance://implement-auth@1',
    acceptanceContractHash: 'sha256:acceptance-v1',
    capabilitySnapshotRef: 'capabilities://remote-dev@1',
    capabilityGrantRef: `grant://github/${assignmentId}`,
    disclosureManifestRef: `disclosure://${assignmentId}`,
  });
}

function attach(dispatch: (command: RemoteA2aCommand) => void, assignmentId = 'assignment-1'): void {
  dispatch({
    type: 'record_dispatch_receipt', actor: transport, assignmentId,
    receiptId: `receipt:dispatch:${assignmentId}`,
    outcome: 'delivered', remoteTaskId: `remote-task:${assignmentId}`, remoteContextId: `remote-context:${assignmentId}`,
  });
}

function callback(
  assignmentId: string,
  sequence: number,
  kind: RemoteCallback['kind'],
  overrides: Partial<RemoteCallback> = {},
): RemoteCallback {
  const attempt = assignmentId.endsWith('-2') ? 2 : 1;
  return {
    eventId: `event:${assignmentId}:${sequence}:${kind}`,
    payloadHash: `sha256:event:${assignmentId}:${sequence}:${kind}`,
    source: 'push',
    sequence,
    dispatchId: `dispatch:${assignmentId}:${attempt}:${attempt}`,
    assignmentId,
    attempt,
    fence: attempt,
    remoteTaskId: `remote-task:${assignmentId}`,
    kind,
    ...overrides,
  };
}

function completion(assignmentId: string, attempt = 1): RemoteCompletionEnvelope {
  return {
    version: 1,
    completionId: `completion:${assignmentId}`,
    reportRef: `report://${assignmentId}`,
    reportHash: `sha256:report:${assignmentId}`,
    candidateHash: `sha256:candidate:${assignmentId}`,
    claimIds: [`claim:${assignmentId}:tests`, `claim:${assignmentId}:implementation`],
    evidenceRefs: [`ci://${assignmentId}`],
    workspaceReceipt: {
      repositoryId: 'github:zhinjs/zhin',
      baseSha: attempt === 1 ? 'commit:base-1' : 'commit:checkpoint-1',
      branchRef: `refs/heads/zhin/run-a2a/implement-auth/attempt-${attempt}-${assignmentId}`,
      headSha: `commit:head:${assignmentId}`,
      prRef: `github:zhinjs/zhin#${40 + attempt}`,
      prHeadSha: `commit:head:${assignmentId}`,
    },
  };
}

// Generic A2A interoperability is not enough for mutable Workroom execution.
{
  let journal = initialRemoteA2aJournal(1_000, { idempotentDispatch: false });
  assert.throws(() => {
    journal = dispatchRemoteA2a(journal, {
      type: 'claim_remote', actor: kernel, assignmentId: 'assignment-incompatible', leaseExpiresAt: 100_000,
      baseSha: 'commit:base-1', branchRef: 'refs/heads/zhin/run-a2a/implement-auth/attempt-1-incompatible',
      pathScope: ['packages/im/agent/**'],
    });
  }, /not Workroom Assignment compatible/u);
}

// Unknown send outcome retries the same persisted A2A identity; discussion is non-authoritative;
// a callback gap reconciles through a full polled snapshot and only completes execution.
{
  const h = harness();
  claimAndDispatch(h.dispatch);
  let state = replayRemoteA2a(h.journal());
  const originalDispatch = state.links['assignment-1']!.dispatch;
  h.dispatch({
    type: 'record_dispatch_receipt', actor: transport, assignmentId: 'assignment-1',
    receiptId: 'receipt:unknown', outcome: 'outcome_unknown',
  });
  h.dispatch({ type: 'retry_dispatch', actor: kernel, assignmentId: 'assignment-1' });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.links['assignment-1']?.dispatch.dispatchId, originalDispatch.dispatchId);
  assert.equal(state.links['assignment-1']?.dispatch.messageId, originalDispatch.messageId);
  assert.equal(state.links['assignment-1']?.sendAttempts, 2);
  attach(h.dispatch);

  h.dispatch({ type: 'receive_callback', actor: gateway, callback: callback('assignment-1', 1, 'discussion', { note: 'Maybe rename the API.' }) });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.task.status, 'executing', 'A2A discussion must not mutate Task state');
  assert.equal(state.discussions.length, 1);

  const progress = callback('assignment-1', 2, 'progress', { note: 'tests running' });
  h.dispatch({ type: 'receive_callback', actor: gateway, callback: progress });
  const beforeDuplicate = h.journal().length;
  h.dispatch({ type: 'receive_callback', actor: gateway, callback: progress });
  assert.equal(h.journal().length, beforeDuplicate, 'same callback event/hash must be a no-op');

  const gapped = callback('assignment-1', 4, 'completed', { completion: completion('assignment-1') });
  h.dispatch({ type: 'receive_callback', actor: gateway, callback: gapped });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.links['assignment-1']?.status, 'reconcile_required');
  assert.equal(state.task.status, 'executing');

  h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: { ...gapped, eventId: 'poll:assignment-1:4', payloadHash: 'sha256:poll:assignment-1:4', source: 'poll_snapshot' },
  });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.assignments['assignment-1']?.status, 'execution_completed');
  assert.equal(state.task.status, 'awaiting_acceptance');
  assert.equal(state.task.candidateHash, 'sha256:candidate:assignment-1');
  assert.equal(h.journal().some(entry => entry.type === ('task.accepted' as never)), false, 'remote completion is never acceptance');
}

// Typed completion must bind the exact leased repo/base/branch/head/PR. Text or a moving PR is insufficient.
{
  const h = harness();
  claimAndDispatch(h.dispatch);
  attach(h.dispatch);
  assert.throws(() => h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-1', 1, 'completed', { note: 'done, trust me' }),
  }), /typed Completion Envelope/u);
  const movedPr = completion('assignment-1');
  assert.throws(() => h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-1', 1, 'completed', {
      eventId: 'event:moved-pr',
      completion: { ...movedPr, workspaceReceipt: { ...movedPr.workspaceReceipt, prHeadSha: 'commit:moved-after-report' } },
    }),
  }), /exact candidate head SHA/u);
  assert.equal(replayRemoteA2a(h.journal()).task.status, 'executing');
}

// A callback identity collision is fail-closed, but Kernel can revoke and take over on a new fence/branch.
{
  const h = harness();
  claimAndDispatch(h.dispatch);
  attach(h.dispatch);
  const first = callback('assignment-1', 1, 'progress', { eventId: 'event:collision', payloadHash: 'sha256:first' });
  h.dispatch({ type: 'receive_callback', actor: gateway, callback: first });
  h.dispatch({ type: 'receive_callback', actor: gateway, callback: { ...first, payloadHash: 'sha256:forged-second', note: 'different body' } });
  let state = replayRemoteA2a(h.journal());
  assert.equal(state.task.status, 'blocked');
  assert.equal(state.links['assignment-1']?.status, 'conflicted');
  h.dispatch({
    type: 'takeover', actor: kernel, priorAssignmentId: 'assignment-1', assignmentId: 'assignment-2',
    leaseExpiresAt: 150_000,
    branchRef: 'refs/heads/zhin/run-a2a/implement-auth/attempt-2-assignment-2',
  });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.assignments['assignment-1']?.status, 'lost');
  assert.equal(state.assignments['assignment-2']?.fence, 2);
  assert.equal(state.assignments['assignment-2']?.workspace.baseSha, 'commit:base-1');
  assert.notEqual(state.assignments['assignment-2']?.workspace.branchRef, state.assignments['assignment-1']?.workspace.branchRef);
  assert.equal(state.task.status, 'executing');
}

// Lease loss makes late remote completion stale. A replacement can complete from an immutable checkpoint.
{
  const h = harness();
  claimAndDispatch(h.dispatch, 'assignment-1', 1, 10_000);
  attach(h.dispatch);
  h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-1', 1, 'checkpoint', {
      checkpoint: {
        checkpointId: 'checkpoint://assignment-1/1', repositoryId: 'github:zhinjs/zhin',
        baseSha: 'commit:base-1', branchRef: 'refs/heads/zhin/run-a2a/implement-auth/attempt-1-assignment-1',
        headSha: 'commit:checkpoint-1',
      },
    }),
  });
  h.dispatch({ type: 'advance_clock', actor: kernel, now: 10_001 });
  let state = replayRemoteA2a(h.journal());
  assert.equal(state.assignments['assignment-1']?.status, 'lost');
  assert.equal(state.task.status, 'ready');
  h.dispatch({
    type: 'takeover', actor: kernel, priorAssignmentId: 'assignment-1', assignmentId: 'assignment-2',
    leaseExpiresAt: 100_000,
    branchRef: 'refs/heads/zhin/run-a2a/implement-auth/attempt-2-assignment-2',
  });
  claimPreparedSecond(h.dispatch);

  h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-1', 2, 'completed', { completion: completion('assignment-1') }),
  });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.task.currentAssignmentId, 'assignment-2');
  assert.equal(state.task.status, 'executing');
  assert.equal(state.callbacks['remote:review-lab:event:assignment-1:2:completed']?.disposition, 'stale');

  h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-2', 1, 'completed', { source: 'poll_snapshot', completion: completion('assignment-2', 2) }),
  });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.task.status, 'awaiting_acceptance');
  assert.equal(state.task.reportRef, 'report://assignment-2');
}

// Cancellation never waits forever and never lies that an unreachable remote stopped.
{
  const h = harness();
  claimAndDispatch(h.dispatch);
  attach(h.dispatch);
  h.dispatch({ type: 'request_cancel', actor: kernel, assignmentId: 'assignment-1', controlDeadline: 12_000, reason: 'Sponsor cancelled Run' });
  h.dispatch({
    type: 'record_cancel_receipt', actor: transport, assignmentId: 'assignment-1',
    receiptId: 'receipt:cancel:unknown', outcome: 'outcome_unknown',
  });
  h.dispatch({ type: 'advance_clock', actor: kernel, now: 12_001 });
  let state = replayRemoteA2a(h.journal());
  assert.equal(state.task.status, 'cancelled');
  assert.equal(state.assignments['assignment-1']?.outcome, 'outcome_unknown');
  h.dispatch({
    type: 'receive_callback', actor: gateway,
    callback: callback('assignment-1', 1, 'completed', { completion: completion('assignment-1') }),
  });
  state = replayRemoteA2a(h.journal());
  assert.equal(state.task.status, 'cancelled');
}

function claimPreparedSecond(dispatch: (command: RemoteA2aCommand) => void): void {
  dispatch({
    type: 'prepare_dispatch', actor: kernel, assignmentId: 'assignment-2',
    contextViewRef: 'context://assignment-2', contextViewHash: 'sha256:context:assignment-2',
    acceptanceContractRef: 'acceptance://implement-auth@1', acceptanceContractHash: 'sha256:acceptance-v1',
    capabilitySnapshotRef: 'capabilities://remote-dev@1', capabilityGrantRef: 'grant://github/assignment-2',
    disclosureManifestRef: 'disclosure://assignment-2',
  });
  dispatch({
    type: 'record_dispatch_receipt', actor: transport, assignmentId: 'assignment-2',
    receiptId: 'receipt:dispatch:assignment-2', outcome: 'delivered',
    remoteTaskId: 'remote-task:assignment-2', remoteContextId: 'remote-context:assignment-2',
  });
}

console.log('Remote A2A scenarios passed: stable dispatch identity, callback dedupe/gap reconciliation, non-authoritative discussion, typed GitHub completion, lease fencing/takeover, stale late result, bounded cancellation, and execution-completed without acceptance.');
