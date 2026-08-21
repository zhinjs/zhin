#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #8. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  dispatchRemoteA2a,
  initialRemoteA2aJournal,
  replayRemoteA2a,
  type RemoteA2aCommand,
  type RemoteA2aEvent,
  type RemoteAssignment,
  type RemoteCallback,
  type RemoteCompletionEnvelope,
} from './remote-a2a.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const kernel = { id: 'workroom:kernel', role: 'kernel' } as const;
const transport = { id: 'a2a:transport-worker', role: 'transport' } as const;
const gateway = { id: 'a2a:callback-gateway', role: 'callback_gateway' } as const;
const rl = createInterface({ input, output });
let journal: readonly RemoteA2aEvent[] = initialRemoteA2aJournal();
let lastMessage = 'Create a remote Assignment. No A2A message is Task authority.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === 'n') createAssignment();
    else if (answer === 'u') unknownDispatch();
    else if (answer === 'r') retryDispatch();
    else if (answer === 'a') attach();
    else if (answer === 'd') discussion();
    else if (answer === 'p') progress();
    else if (answer === 'k') checkpoint();
    else if (answer === 'g') gappedCompletion();
    else if (answer === 's') snapshotCompletion();
    else if (answer === 'f') callbackConflict();
    else if (answer === 'e') expireLease();
    else if (answer === 't') takeover();
    else if (answer === 'l') lateOldCompletion();
    else if (answer === 'c') cancel();
    else if (answer === 'x') expireControl();
    else lastMessage = `Unknown action: ${answer || '(empty)'}`;
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function dispatch(command: RemoteA2aCommand): void {
  journal = dispatchRemoteA2a(journal, command);
}

function createAssignment(): void {
  journal = initialRemoteA2aJournal();
  dispatch({
    type: 'claim_remote', actor: kernel, assignmentId: 'assignment-1', leaseExpiresAt: 100_000,
    baseSha: 'commit:base-1', branchRef: 'refs/heads/zhin/run-a2a/implement-auth/attempt-1-assignment-1',
    pathScope: ['packages/im/agent/**'],
  });
  prepare('assignment-1');
  lastMessage = 'Kernel leased a unique GitHub branch and persisted one typed dispatch identity; no secret or host path crossed A2A.';
}

function prepare(assignmentId: string): void {
  dispatch({
    type: 'prepare_dispatch', actor: kernel, assignmentId,
    contextViewRef: `context://${assignmentId}`, contextViewHash: `sha256:context:${assignmentId}`,
    acceptanceContractRef: 'acceptance://implement-auth@1', acceptanceContractHash: 'sha256:acceptance-v1',
    capabilitySnapshotRef: 'capabilities://remote-dev@1', capabilityGrantRef: `grant://github/${assignmentId}`,
    disclosureManifestRef: `disclosure://${assignmentId}`,
  });
}

function active(): RemoteAssignment {
  const state = replayRemoteA2a(journal);
  const id = state.task.currentAssignmentId;
  const assignment = id ? state.assignments[id] : undefined;
  if (!assignment) throw new Error('no active Assignment');
  return assignment;
}

function unknownDispatch(): void {
  const assignment = active();
  dispatch({ type: 'record_dispatch_receipt', actor: transport, assignmentId: assignment.id, receiptId: `receipt:unknown:${assignment.id}`, outcome: 'outcome_unknown' });
  lastMessage = 'Send outcome is unknown. The Assignment waits for reconciliation instead of spawning a duplicate remote task.';
}

function retryDispatch(): void {
  const assignment = active();
  dispatch({ type: 'retry_dispatch', actor: kernel, assignmentId: assignment.id });
  lastMessage = 'Retry uses the exact persisted dispatchId/messageId; the compatible remote endpoint must deduplicate it.';
}

function attach(): void {
  const assignment = active();
  dispatch({
    type: 'record_dispatch_receipt', actor: transport, assignmentId: assignment.id,
    receiptId: `receipt:delivered:${assignment.id}`, outcome: 'delivered',
    remoteTaskId: `remote-task:${assignment.id}`, remoteContextId: `remote-context:${assignment.id}`,
  });
  lastMessage = 'A2A remote task ID is stored as an external receipt; local Assignment ID remains canonical.';
}

function discussion(): void {
  const assignment = active();
  dispatch({ type: 'receive_callback', actor: gateway, callback: makeCallback(assignment, nextSequence(assignment), 'discussion', { note: 'Could we rename this API?' }) });
  lastMessage = 'Discussion was recorded for context/audit and changed no Task or Assignment status.';
}

function progress(): void {
  const assignment = active();
  dispatch({ type: 'receive_callback', actor: gateway, callback: makeCallback(assignment, nextSequence(assignment), 'progress', { note: 'remote CI is running' }) });
  lastMessage = 'Authenticated progress advanced only the Assignment observation cursor.';
}

function checkpoint(): void {
  const assignment = active();
  dispatch({
    type: 'receive_callback', actor: gateway,
    callback: makeCallback(assignment, nextSequence(assignment), 'checkpoint', {
      checkpoint: {
        checkpointId: `checkpoint://${assignment.id}/${assignment.attempt}`,
        repositoryId: assignment.workspace.repositoryId,
        baseSha: assignment.workspace.baseSha,
        branchRef: assignment.workspace.branchRef,
        headSha: `commit:checkpoint:${assignment.id}`,
      },
    }),
  });
  lastMessage = 'Typed checkpoint sealed an exact commit; only this immutable SHA may seed a replacement.';
}

function gappedCompletion(): void {
  const assignment = active();
  const sequence = nextSequence(assignment) + 1;
  dispatch({ type: 'receive_callback', actor: gateway, callback: makeCallback(assignment, sequence, 'completed', { completion: makeCompletion(assignment) }) });
  lastMessage = 'Push sequence gap prevented completion and opened bounded reconciliation.';
}

function snapshotCompletion(): void {
  const assignment = active();
  const sequence = nextSequence(assignment) + 1;
  dispatch({
    type: 'receive_callback', actor: gateway,
    callback: makeCallback(assignment, sequence, 'completed', {
      eventId: `poll:${assignment.id}:${sequence}`, payloadHash: `sha256:poll:${assignment.id}:${sequence}`,
      source: 'poll_snapshot', completion: makeCompletion(assignment),
    }),
  });
  lastMessage = 'Polled typed snapshot sealed execution_completed. Task still awaits #7 acceptance; PR is not merged.';
}

function callbackConflict(): void {
  const assignment = active();
  const sequence = nextSequence(assignment);
  const first = makeCallback(assignment, sequence, 'progress', { eventId: `event:collision:${assignment.id}`, payloadHash: 'sha256:first' });
  dispatch({ type: 'receive_callback', actor: gateway, callback: first });
  dispatch({ type: 'receive_callback', actor: gateway, callback: { ...first, payloadHash: 'sha256:different', note: 'conflicting payload' } });
  lastMessage = 'Same authenticated event ID with two hashes failed closed; takeover/cancel remains available.';
}

function expireLease(): void {
  const assignment = active();
  dispatch({ type: 'advance_clock', actor: kernel, now: assignment.leaseExpiresAt + 1 });
  lastMessage = 'Lease expired to lost/outcome_unknown. Kernel released the Task without claiming the remote stopped.';
}

function takeover(): void {
  const state = replayRemoteA2a(journal);
  const prior = Object.values(state.assignments).filter(item => item.status === 'lost' || item.status === 'blocked').sort((a, b) => b.attempt - a.attempt)[0];
  if (!prior) throw new Error('no lost/blocked Assignment to replace');
  const attempt = state.task.attempt + 1;
  const id = `assignment-${attempt}`;
  const resumedFrom = prior.checkpointSha ? `sealed checkpoint ${prior.checkpointSha}` : `original base ${prior.workspace.baseSha}`;
  dispatch({
    type: 'takeover', actor: kernel, priorAssignmentId: prior.id, assignmentId: id,
    leaseExpiresAt: state.now + 90_000,
    branchRef: `refs/heads/zhin/run-a2a/implement-auth/attempt-${attempt}-${id}`,
  });
  prepare(id);
  attach();
  lastMessage = `Replacement uses a higher fence/new branch from ${resumedFrom}; the old mutable branch is never reused.`;
}

function lateOldCompletion(): void {
  const state = replayRemoteA2a(journal);
  const old = Object.values(state.assignments).filter(item => item.status === 'lost').sort((a, b) => a.attempt - b.attempt)[0];
  if (!old) throw new Error('no stale Assignment');
  dispatch({ type: 'receive_callback', actor: gateway, callback: makeCallback(old, nextSequence(old), 'completed', { completion: makeCompletion(old) }) });
  lastMessage = 'Late completion from the old fence was recorded as stale and could not replace the current Assignment.';
}

function cancel(): void {
  const assignment = active();
  dispatch({ type: 'request_cancel', actor: kernel, assignmentId: assignment.id, controlDeadline: replayRemoteA2a(journal).now + 10_000, reason: 'Sponsor cancelled Run' });
  dispatch({ type: 'record_cancel_receipt', actor: transport, assignmentId: assignment.id, receiptId: `receipt:cancel:${assignment.id}`, outcome: 'outcome_unknown' });
  lastMessage = 'Remote cancel outcome is unknown; local control has a fixed deadline and does not wait forever.';
}

function expireControl(): void {
  const assignment = active();
  if (!assignment.controlDeadline) throw new Error('no cancel control deadline');
  dispatch({ type: 'advance_clock', actor: kernel, now: assignment.controlDeadline + 1 });
  lastMessage = 'Control deadline released local cancellation with outcome_unknown; reconciliation/audit remains explicit.';
}

function nextSequence(assignment: RemoteAssignment): number {
  return (replayRemoteA2a(journal).links[assignment.id]?.lastRemoteSequence ?? 0) + 1;
}

function makeCallback(
  assignment: RemoteAssignment,
  sequence: number,
  kind: RemoteCallback['kind'],
  overrides: Partial<RemoteCallback> = {},
): RemoteCallback {
  const dispatchId = replayRemoteA2a(journal).links[assignment.id]?.dispatch.dispatchId
    ?? `dispatch:${assignment.id}:${assignment.attempt}:${assignment.fence}`;
  return {
    eventId: `event:${assignment.id}:${sequence}:${kind}`,
    payloadHash: `sha256:event:${assignment.id}:${sequence}:${kind}`,
    source: 'push', sequence, dispatchId, assignmentId: assignment.id,
    attempt: assignment.attempt, fence: assignment.fence,
    remoteTaskId: `remote-task:${assignment.id}`, kind, ...overrides,
  };
}

function makeCompletion(assignment: RemoteAssignment): RemoteCompletionEnvelope {
  return {
    version: 1,
    completionId: `completion:${assignment.id}`,
    reportRef: `report://${assignment.id}`,
    reportHash: `sha256:report:${assignment.id}`,
    candidateHash: `sha256:candidate:${assignment.id}`,
    claimIds: [`claim:${assignment.id}:tests`, `claim:${assignment.id}:implementation`],
    evidenceRefs: [`ci://${assignment.id}`],
    workspaceReceipt: {
      repositoryId: assignment.workspace.repositoryId,
      baseSha: assignment.workspace.baseSha,
      branchRef: assignment.workspace.branchRef,
      headSha: `commit:head:${assignment.id}`,
      prRef: `github:zhinjs/zhin#${40 + assignment.attempt}`,
      prHeadSha: `commit:head:${assignment.id}`,
    },
  };
}

function render(): void {
  console.clear();
  const state = replayRemoteA2a(journal);
  console.log(`${bold}Remote A2A Executor — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Kernel Assignment is canonical. A2A task/link is an idempotent transport projection.${reset}\n`);
  console.log(`${bold}TASK${reset} ${state.task.key}@${state.task.revision} status=${state.task.status} attempt=${state.task.attempt}/${state.task.maxAttempts} current=${state.task.currentAssignmentId ?? '-'} candidate=${state.task.candidateHash ?? '-'}`);
  console.log(`${bold}ASSIGNMENTS / GITHUB LEASES${reset}`);
  for (const item of Object.values(state.assignments)) {
    console.log(`  ${item.id} attempt=${item.attempt} fence=${item.fence} status=${item.status} outcome=${item.outcome ?? '-'} lease=${item.leaseExpiresAt}`);
    console.log(`    ${item.workspace.repositoryId}@${item.workspace.baseSha} → ${item.workspace.branchRef}`);
  }
  console.log(`${bold}REMOTE LINKS${reset}`);
  for (const item of Object.values(state.links)) {
    console.log(`  ${item.assignmentId} status=${item.status} sends=${item.sendAttempts} remote=${item.remoteTaskId ?? '?'} seq=${item.lastRemoteSequence}`);
    console.log(`    dispatch=${item.dispatch.dispatchId} message=${item.dispatch.messageId}`);
  }
  console.log(`${bold}CALLBACKS / DISCUSSION${reset} receipts=${Object.keys(state.callbacks).length} discussion=${state.discussions.length}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-8)) console.log(`  #${entry.seq} ${entry.type}`);
  console.log(`${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [n] new Assignment [u] send unknown [r] retry same ID [a] attach remote task');
  console.log('  [d] discussion [p] progress [k] typed checkpoint [g] gapped completion [s] poll snapshot [f] conflict');
  console.log('  [e] expire lease [t] takeover [l] late old completion [c] cancel unknown [x] expire control [q] quit');
}
