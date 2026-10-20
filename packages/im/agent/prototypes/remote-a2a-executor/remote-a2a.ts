/**
 * PROTOTYPE — delete after decision-map ticket #8 is absorbed.
 *
 * Remote A2A is a transport adapter for the same Task/Assignment lifecycle as
 * local execution. A2A observations never become a second task authority.
 */

export type TaskStatus = 'ready' | 'executing' | 'blocked' | 'awaiting_acceptance' | 'cancelled' | 'failed';
export type AssignmentStatus =
  | 'leased'
  | 'running'
  | 'blocked'
  | 'cancel_requested'
  | 'execution_completed'
  | 'lost'
  | 'cancelled';

export interface Principal {
  readonly id: string;
  readonly role: 'kernel' | 'transport' | 'callback_gateway';
}

export interface RemoteEndpointSnapshot {
  readonly id: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly callbackAuthBindingId: string;
  readonly workroomExtension: string;
  readonly idempotentDispatch: boolean;
  readonly typedCompletionEnvelope: boolean;
  readonly workspaceProviders: readonly string[];
  readonly leaseRenewalMs: number;
  readonly reconciliationMs: number;
}

export interface GithubWorkspaceReference {
  readonly provider: 'github_pull_request';
  readonly repositoryId: string;
  readonly integrationBindingId: string;
  readonly baseSha: string;
  readonly targetRef: string;
  readonly branchRef: string;
  readonly pathScope: readonly string[];
  readonly mode: 'branch_only' | 'branch_and_pr';
  readonly fence: number;
  readonly checkpointSha?: string;
}

export interface RemoteAssignment {
  readonly id: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly endpointId: string;
  readonly status: AssignmentStatus;
  readonly leaseExpiresAt: number;
  readonly workspace: GithubWorkspaceReference;
  readonly controlDeadline?: number;
  readonly reportRef?: string;
  readonly candidateHash?: string;
  readonly checkpointSha?: string;
  readonly checkpointRef?: string;
  readonly outcome?: 'interrupted' | 'committed' | 'outcome_unknown';
  readonly reason?: string;
}

export interface RemoteDispatchEnvelope {
  readonly version: 1;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly fence: number;
  readonly endpointId: string;
  readonly endpointCardDigest: string;
  readonly contextViewRef: string;
  readonly contextViewHash: string;
  readonly acceptanceContractRef: string;
  readonly acceptanceContractHash: string;
  readonly capabilitySnapshotRef: string;
  readonly capabilityGrantRef: string;
  readonly disclosureManifestRef: string;
  readonly workspace: GithubWorkspaceReference;
}

export interface RemoteCompletionEnvelope {
  readonly version: 1;
  readonly completionId: string;
  readonly reportRef: string;
  readonly reportHash: string;
  readonly candidateHash: string;
  readonly claimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly workspaceReceipt: Readonly<{
    repositoryId: string;
    baseSha: string;
    branchRef: string;
    headSha: string;
    prRef?: string;
    prHeadSha?: string;
  }>;
}

export interface RemoteCheckpointEnvelope {
  readonly checkpointId: string;
  readonly repositoryId: string;
  readonly baseSha: string;
  readonly branchRef: string;
  readonly headSha: string;
}

export interface RemoteCallback {
  readonly eventId: string;
  readonly payloadHash: string;
  readonly source: 'push' | 'poll_snapshot';
  readonly sequence: number;
  readonly dispatchId: string;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly fence: number;
  readonly remoteTaskId: string;
  readonly kind: 'discussion' | 'progress' | 'heartbeat' | 'checkpoint' | 'completed' | 'failed' | 'cancelled';
  readonly note?: string;
  readonly checkpoint?: RemoteCheckpointEnvelope;
  readonly completion?: RemoteCompletionEnvelope;
}

export interface RemoteLink {
  readonly assignmentId: string;
  readonly dispatch: RemoteDispatchEnvelope;
  readonly status: 'prepared' | 'attached' | 'reconcile_required' | 'terminal' | 'lost' | 'cancel_pending' | 'cancelled' | 'conflicted';
  readonly sendAttempts: number;
  readonly receiptIds: readonly string[];
  readonly remoteTaskId?: string;
  readonly remoteContextId?: string;
  readonly lastRemoteSequence: number;
  readonly reconcileDeadline?: number;
  readonly completionId?: string;
  readonly reason?: string;
}

export interface CallbackReceipt {
  readonly eventId: string;
  readonly payloadHash: string;
  readonly assignmentId: string;
  readonly disposition: 'applied' | 'discussion' | 'stale' | 'gap' | 'conflict';
}

export interface RemoteTaskState {
  readonly key: string;
  readonly revision: number;
  readonly status: TaskStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly currentAssignmentId?: string;
  readonly reportRef?: string;
  readonly candidateHash?: string;
  readonly reason?: string;
}

export interface RemoteA2aState {
  readonly sequence: number;
  readonly now: number;
  readonly projectId: string;
  readonly runId: string;
  readonly endpoint: RemoteEndpointSnapshot;
  readonly task: RemoteTaskState;
  readonly assignments: Readonly<Record<string, RemoteAssignment>>;
  readonly links: Readonly<Record<string, RemoteLink>>;
  readonly callbacks: Readonly<Record<string, CallbackReceipt>>;
  readonly discussions: readonly Readonly<{ assignmentId: string; eventId: string; note: string }>[];
}

export type RemoteA2aEvent = Readonly<{
  seq: number;
  at: number;
  type:
    | 'remote.fixture_registered'
    | 'assignment.claimed'
    | 'assignment.started'
    | 'assignment.heartbeat'
    | 'assignment.progress_recorded'
    | 'assignment.checkpointed'
    | 'assignment.execution_completed'
    | 'assignment.remote_failed'
    | 'assignment.lease_expired'
    | 'assignment.cancel_requested'
    | 'assignment.cancelled'
    | 'assignment.lease_revoked'
    | 'remote.dispatch_prepared'
    | 'remote.dispatch_retry_requested'
    | 'remote.dispatch_receipt_recorded'
    | 'remote.reconciliation_required'
    | 'remote.callback_recorded'
    | 'remote.callback_ignored'
    | 'remote.callback_conflict'
    | 'remote.discussion_observed'
    | 'remote.cancel_receipt_recorded'
    | 'clock.advanced';
  payload: Readonly<Record<string, unknown>>;
}>;

export type RemoteA2aCommand =
  | Readonly<{
      type: 'claim_remote'; actor: Principal; assignmentId: string; leaseExpiresAt: number;
      baseSha: string; branchRef: string; pathScope: readonly string[];
    }>
  | Readonly<{
      type: 'prepare_dispatch'; actor: Principal; assignmentId: string;
      contextViewRef: string; contextViewHash: string; acceptanceContractRef: string;
      acceptanceContractHash: string; capabilitySnapshotRef: string;
      capabilityGrantRef: string; disclosureManifestRef: string;
    }>
  | Readonly<{
      type: 'record_dispatch_receipt'; actor: Principal; assignmentId: string; receiptId: string;
      outcome: 'delivered' | 'outcome_unknown' | 'failed'; remoteTaskId?: string; remoteContextId?: string;
    }>
  | Readonly<{ type: 'retry_dispatch'; actor: Principal; assignmentId: string }>
  | Readonly<{ type: 'receive_callback'; actor: Principal; callback: RemoteCallback }>
  | Readonly<{ type: 'request_cancel'; actor: Principal; assignmentId: string; controlDeadline: number; reason: string }>
  | Readonly<{
      type: 'record_cancel_receipt'; actor: Principal; assignmentId: string;
      receiptId: string; outcome: 'acknowledged' | 'outcome_unknown';
    }>
  | Readonly<{
      type: 'takeover'; actor: Principal; priorAssignmentId: string; assignmentId: string;
      leaseExpiresAt: number; branchRef: string;
    }>
  | Readonly<{ type: 'advance_clock'; actor: Principal; now: number }>;

type EventDraft = Omit<RemoteA2aEvent, 'seq' | 'at'>;

export function initialRemoteA2aJournal(
  now = 1_000,
  endpointOverrides: Partial<RemoteEndpointSnapshot> = {},
): readonly RemoteA2aEvent[] {
  const endpoint: RemoteEndpointSnapshot = {
    id: 'remote:review-lab',
    cardDigest: 'sha256:agent-card-v1',
    authBindingId: 'secret-ref:a2a-review-lab',
    callbackAuthBindingId: 'secret-ref:a2a-callback-review-lab',
    workroomExtension: 'https://zhin.dev/a2a/extensions/workroom-assignment/v1',
    idempotentDispatch: true,
    typedCompletionEnvelope: true,
    workspaceProviders: ['github_pull_request'],
    leaseRenewalMs: 30_000,
    reconciliationMs: 20_000,
    ...endpointOverrides,
  };
  const task: RemoteTaskState = {
    key: 'implement-auth',
    revision: 1,
    status: 'ready',
    attempt: 0,
    maxAttempts: 3,
  };
  return [Object.freeze({
    seq: 0,
    at: now,
    type: 'remote.fixture_registered',
    payload: Object.freeze({ projectId: 'project-zhin', runId: 'run-a2a', endpoint, task }),
  })];
}

export function replayRemoteA2a(events: readonly RemoteA2aEvent[]): RemoteA2aState {
  const first = events[0];
  if (!first || first.type !== 'remote.fixture_registered' || first.seq !== 0) {
    throw new Error('remote A2A journal must begin with remote.fixture_registered');
  }
  let state: RemoteA2aState = {
    sequence: -1,
    now: first.at,
    projectId: String(first.payload.projectId),
    runId: String(first.payload.runId),
    endpoint: first.payload.endpoint as RemoteEndpointSnapshot,
    task: first.payload.task as RemoteTaskState,
    assignments: {},
    links: {},
    callbacks: {},
    discussions: [],
  };
  for (const entry of events) {
    if (entry.seq !== state.sequence + 1) throw new Error('remote A2A journal sequence is not contiguous');
    state = evolve(state, entry);
  }
  return state;
}

export function dispatchRemoteA2a(
  journal: readonly RemoteA2aEvent[],
  command: RemoteA2aCommand,
): readonly RemoteA2aEvent[] {
  const state = replayRemoteA2a(journal);
  const drafts = decide(state, command);
  const at = command.type === 'advance_clock' ? command.now : state.now;
  return Object.freeze([
    ...journal,
    ...drafts.map((draft, index) => Object.freeze({ ...draft, seq: journal.length + index, at })),
  ]);
}

function decide(state: RemoteA2aState, command: RemoteA2aCommand): readonly EventDraft[] {
  switch (command.type) {
    case 'claim_remote': {
      requireRole(command.actor, 'kernel');
      if (state.task.status !== 'ready') throw new Error(`task is ${state.task.status}`);
      if (state.assignments[command.assignmentId]) throw new Error('assignment already exists');
      if (state.task.attempt >= state.task.maxAttempts) throw new Error('task attempts exhausted');
      requireCompatibleEndpoint(state.endpoint);
      if (command.leaseExpiresAt <= state.now) throw new Error('lease must expire in the future');
      const attempt = state.task.attempt + 1;
      const fence = highestFence(state) + 1;
      if (!command.branchRef.includes(`/attempt-${attempt}-`)) throw new Error('takeover-safe branch must encode the new attempt');
      const workspace: GithubWorkspaceReference = {
        provider: 'github_pull_request',
        repositoryId: 'github:zhinjs/zhin',
        integrationBindingId: 'integration:github-app-zhin',
        baseSha: command.baseSha,
        targetRef: 'refs/heads/main',
        branchRef: command.branchRef,
        pathScope: command.pathScope,
        mode: 'branch_and_pr',
        fence,
      };
      const assignment: RemoteAssignment = {
        id: command.assignmentId,
        taskKey: state.task.key,
        taskRevision: state.task.revision,
        attempt,
        fence,
        endpointId: state.endpoint.id,
        status: 'leased',
        leaseExpiresAt: command.leaseExpiresAt,
        workspace,
      };
      return [event('assignment.claimed', { assignment })];
    }
    case 'prepare_dispatch': {
      requireRole(command.actor, 'kernel');
      const assignment = requireAssignment(state, command.assignmentId, ['leased']);
      const dispatchId = `dispatch:${assignment.id}:${assignment.attempt}:${assignment.fence}`;
      const envelope: RemoteDispatchEnvelope = {
        version: 1,
        dispatchId,
        messageId: `message:${dispatchId}`,
        projectId: state.projectId,
        runId: state.runId,
        taskKey: assignment.taskKey,
        taskRevision: assignment.taskRevision,
        assignmentId: assignment.id,
        attempt: assignment.attempt,
        fence: assignment.fence,
        endpointId: assignment.endpointId,
        endpointCardDigest: state.endpoint.cardDigest,
        contextViewRef: command.contextViewRef,
        contextViewHash: command.contextViewHash,
        acceptanceContractRef: command.acceptanceContractRef,
        acceptanceContractHash: command.acceptanceContractHash,
        capabilitySnapshotRef: command.capabilitySnapshotRef,
        capabilityGrantRef: command.capabilityGrantRef,
        disclosureManifestRef: command.disclosureManifestRef,
        workspace: assignment.workspace,
      };
      return [
        event('remote.dispatch_prepared', { assignmentId: assignment.id, envelope }),
        event('assignment.started', { assignmentId: assignment.id }),
      ];
    }
    case 'record_dispatch_receipt': {
      requireRole(command.actor, 'transport');
      const assignment = requireAssignment(state, command.assignmentId, ['running']);
      const link = requireLink(state, assignment.id);
      if (link.receiptIds.includes(command.receiptId)) return [];
      if (command.outcome === 'delivered' && !command.remoteTaskId) throw new Error('delivered dispatch requires remote task receipt');
      const drafts: EventDraft[] = [event('remote.dispatch_receipt_recorded', {
        assignmentId: assignment.id,
        receiptId: command.receiptId,
        outcome: command.outcome,
        remoteTaskId: command.remoteTaskId,
        remoteContextId: command.remoteContextId,
      })];
      if (command.outcome === 'outcome_unknown') {
        drafts.push(event('remote.reconciliation_required', {
          assignmentId: assignment.id,
          reason: 'dispatch outcome unknown; query or retry the same idempotency key',
          deadline: state.now + state.endpoint.reconciliationMs,
        }));
      } else if (command.outcome === 'failed') {
        drafts.push(event('assignment.remote_failed', {
          assignmentId: assignment.id,
          reason: 'dispatch failed before remote task attachment',
          outcome: 'interrupted',
        }));
      }
      return drafts;
    }
    case 'retry_dispatch': {
      requireRole(command.actor, 'kernel');
      const assignment = requireAssignment(state, command.assignmentId, ['running']);
      const link = requireLink(state, assignment.id, ['reconcile_required']);
      if (!state.endpoint.idempotentDispatch) throw new Error('remote endpoint cannot safely retry dispatch');
      return [event('remote.dispatch_retry_requested', {
        assignmentId: assignment.id,
        dispatchId: link.dispatch.dispatchId,
        messageId: link.dispatch.messageId,
      })];
    }
    case 'receive_callback': {
      requireRole(command.actor, 'callback_gateway');
      return decideCallback(state, command.callback);
    }
    case 'request_cancel': {
      requireRole(command.actor, 'kernel');
      const assignment = requireAssignment(state, command.assignmentId, ['leased', 'running', 'blocked']);
      if (command.controlDeadline <= state.now) throw new Error('control deadline must be in the future');
      return [event('assignment.cancel_requested', {
        assignmentId: assignment.id,
        controlDeadline: command.controlDeadline,
        reason: command.reason,
      })];
    }
    case 'record_cancel_receipt': {
      requireRole(command.actor, 'transport');
      const assignment = requireAssignment(state, command.assignmentId, ['cancel_requested']);
      const link = requireLink(state, assignment.id);
      if (link.receiptIds.includes(command.receiptId)) return [];
      const drafts: EventDraft[] = [event('remote.cancel_receipt_recorded', {
        assignmentId: assignment.id,
        receiptId: command.receiptId,
        outcome: command.outcome,
      })];
      if (command.outcome === 'acknowledged') {
        drafts.push(event('assignment.cancelled', { assignmentId: assignment.id, outcome: 'interrupted', reason: 'remote cancellation acknowledged' }));
      }
      return drafts;
    }
    case 'takeover': {
      requireRole(command.actor, 'kernel');
      const prior = requireAssignment(state, command.priorAssignmentId, ['lost', 'blocked']);
      if (state.assignments[command.assignmentId]) throw new Error('replacement assignment already exists');
      if (state.task.attempt >= state.task.maxAttempts) throw new Error('task attempts exhausted');
      if (command.leaseExpiresAt <= state.now) throw new Error('replacement lease must expire in the future');
      const attempt = state.task.attempt + 1;
      const fence = highestFence(state) + 1;
      if (!command.branchRef.includes(`/attempt-${attempt}-`)) throw new Error('replacement branch must be unique to the new attempt');
      if (command.branchRef === prior.workspace.branchRef) throw new Error('replacement cannot reuse the prior mutable branch');
      const workspace: GithubWorkspaceReference = {
        ...prior.workspace,
        baseSha: prior.checkpointSha ?? prior.workspace.baseSha,
        branchRef: command.branchRef,
        fence,
        ...(prior.checkpointSha ? { checkpointSha: prior.checkpointSha } : {}),
      };
      const replacement: RemoteAssignment = {
        id: command.assignmentId,
        taskKey: prior.taskKey,
        taskRevision: prior.taskRevision,
        attempt,
        fence,
        endpointId: prior.endpointId,
        status: 'leased',
        leaseExpiresAt: command.leaseExpiresAt,
        workspace,
      };
      const drafts: EventDraft[] = [];
      if (prior.status === 'blocked') drafts.push(event('assignment.lease_revoked', { assignmentId: prior.id, outcome: 'outcome_unknown', reason: 'conflicted remote assignment replaced' }));
      drafts.push(event('assignment.claimed', { assignment: replacement }));
      return drafts;
    }
    case 'advance_clock': {
      requireRole(command.actor, 'kernel');
      if (command.now <= state.now) throw new Error('clock must advance');
      const drafts: EventDraft[] = [event('clock.advanced', { now: command.now })];
      for (const assignment of Object.values(state.assignments)) {
        if (assignment.status === 'cancel_requested' && (assignment.controlDeadline ?? Infinity) <= command.now) {
          drafts.push(event('assignment.cancelled', {
            assignmentId: assignment.id,
            outcome: 'outcome_unknown',
            reason: 'remote cancel deadline expired; local control released without claiming remote stopped',
          }));
          continue;
        }
        if ((assignment.status === 'leased' || assignment.status === 'running') && assignment.leaseExpiresAt <= command.now) {
          drafts.push(event('assignment.lease_expired', {
            assignmentId: assignment.id,
            outcome: 'outcome_unknown',
            reason: 'remote lease expired',
          }));
          continue;
        }
        const link = state.links[assignment.id];
        if (assignment.status === 'running' && link?.status === 'reconcile_required' && (link.reconcileDeadline ?? Infinity) <= command.now) {
          drafts.push(event('assignment.lease_expired', {
            assignmentId: assignment.id,
            outcome: 'outcome_unknown',
            reason: 'remote reconciliation deadline expired',
          }));
        }
      }
      return drafts;
    }
  }
}

function decideCallback(state: RemoteA2aState, callback: RemoteCallback): readonly EventDraft[] {
  const receiptKey = callbackReceiptKey(state.endpoint.id, callback.eventId);
  const priorReceipt = state.callbacks[receiptKey];
  if (priorReceipt) {
    if (priorReceipt.payloadHash === callback.payloadHash) return [];
    return [event('remote.callback_conflict', {
      callback,
      receiptKey,
      reason: 'same authenticated remote event id arrived with a different payload hash',
    })];
  }

  const assignment = state.assignments[callback.assignmentId];
  const link = state.links[callback.assignmentId];
  if (!assignment || !link || link.dispatch.dispatchId !== callback.dispatchId) {
    return [event('remote.callback_ignored', { callback, receiptKey, disposition: 'stale', reason: 'callback does not match a known dispatch' })];
  }
  if (assignment.attempt !== callback.attempt || assignment.fence !== callback.fence
    || isAssignmentTerminal(assignment.status) || assignment.status === 'cancel_requested') {
    return [event('remote.callback_ignored', { callback, receiptKey, disposition: 'stale', reason: 'callback belongs to a stale or inactive lease' })];
  }
  if (link.remoteTaskId && link.remoteTaskId !== callback.remoteTaskId) {
    return [event('remote.callback_conflict', { callback, receiptKey, reason: 'remote task identity changed for one dispatch' })];
  }
  if (callback.source === 'push' && callback.sequence > link.lastRemoteSequence + 1) {
    return [
      event('remote.callback_recorded', { callback, receiptKey, disposition: 'gap' }),
      event('remote.reconciliation_required', {
        assignmentId: assignment.id,
        reason: `remote callback gap: expected ${link.lastRemoteSequence + 1}, received ${callback.sequence}`,
        deadline: state.now + state.endpoint.reconciliationMs,
      }),
    ];
  }
  if (callback.sequence <= link.lastRemoteSequence) {
    return [event('remote.callback_ignored', { callback, receiptKey, disposition: 'stale', reason: 'remote callback sequence did not advance' })];
  }

  if (callback.kind === 'discussion') {
    return [
      event('remote.callback_recorded', { callback, receiptKey, disposition: 'discussion' }),
      event('remote.discussion_observed', { assignmentId: assignment.id, eventId: callback.eventId, note: callback.note ?? '' }),
    ];
  }
  const drafts: EventDraft[] = [event('remote.callback_recorded', { callback, receiptKey, disposition: 'applied' })];
  if (callback.kind === 'progress') {
    drafts.push(event('assignment.progress_recorded', { assignmentId: assignment.id, note: callback.note ?? '' }));
  } else if (callback.kind === 'heartbeat') {
    drafts.push(event('assignment.heartbeat', { assignmentId: assignment.id, leaseExpiresAt: state.now + state.endpoint.leaseRenewalMs }));
  } else if (callback.kind === 'checkpoint') {
    const checkpoint = requireValidCheckpoint(assignment, callback);
    drafts.push(event('assignment.checkpointed', {
      assignmentId: assignment.id,
      checkpointRef: checkpoint.checkpointId,
      checkpointSha: checkpoint.headSha,
    }));
  } else if (callback.kind === 'completed') {
    const completion = requireValidCompletion(assignment, callback);
    drafts.push(event('assignment.execution_completed', {
      assignmentId: assignment.id,
      reportRef: completion.reportRef,
      reportHash: completion.reportHash,
      candidateHash: completion.candidateHash,
      completionId: completion.completionId,
      claimIds: completion.claimIds,
      evidenceRefs: completion.evidenceRefs,
      workspaceReceipt: completion.workspaceReceipt,
    }));
  } else if (callback.kind === 'failed' || callback.kind === 'cancelled') {
    drafts.push(event('assignment.remote_failed', {
      assignmentId: assignment.id,
      reason: callback.note || `remote task ${callback.kind}`,
      outcome: callback.kind === 'cancelled' ? 'interrupted' : 'outcome_unknown',
    }));
  }
  return drafts;
}

function requireValidCompletion(assignment: RemoteAssignment, callback: RemoteCallback): RemoteCompletionEnvelope {
  const completion = callback.completion;
  if (!completion) throw new Error('completed callback requires typed Completion Envelope');
  if (!completion.reportRef || !completion.reportHash || !completion.candidateHash) throw new Error('Completion Envelope is missing immutable report/candidate identity');
  if (completion.claimIds.length === 0 || completion.evidenceRefs.length === 0) throw new Error('Completion Envelope requires structured claims and Evidence refs');
  const receipt = completion.workspaceReceipt;
  const expected = assignment.workspace;
  if (receipt.repositoryId !== expected.repositoryId || receipt.baseSha !== expected.baseSha || receipt.branchRef !== expected.branchRef) {
    throw new Error('Completion workspace receipt does not match the leased GitHub reference');
  }
  if (!receipt.headSha) throw new Error('Completion workspace receipt requires an exact head SHA');
  if (expected.mode === 'branch_and_pr' && (!receipt.prRef || receipt.prHeadSha !== receipt.headSha)) {
    throw new Error('PR receipt must bind the exact candidate head SHA');
  }
  return completion;
}

function requireValidCheckpoint(assignment: RemoteAssignment, callback: RemoteCallback): RemoteCheckpointEnvelope {
  const checkpoint = callback.checkpoint;
  if (!checkpoint) throw new Error('checkpoint callback requires typed Checkpoint Envelope');
  const workspace = assignment.workspace;
  if (checkpoint.repositoryId !== workspace.repositoryId || checkpoint.baseSha !== workspace.baseSha
    || checkpoint.branchRef !== workspace.branchRef || !checkpoint.headSha) {
    throw new Error('Checkpoint Envelope does not match the leased GitHub reference');
  }
  return checkpoint;
}

function evolve(state: RemoteA2aState, entry: RemoteA2aEvent): RemoteA2aState {
  let task = state.task;
  let assignments = state.assignments;
  let links = state.links;
  let callbacks = state.callbacks;
  let discussions = state.discussions;
  const payload = entry.payload;
  switch (entry.type) {
    case 'remote.fixture_registered': break;
    case 'assignment.claimed': {
      const assignment = payload.assignment as RemoteAssignment;
      assignments = { ...assignments, [assignment.id]: assignment };
      task = { ...task, status: 'executing', attempt: assignment.attempt, currentAssignmentId: assignment.id, reason: undefined };
      break;
    }
    case 'assignment.started': {
      assignments = updateAssignment(assignments, String(payload.assignmentId), current => ({ ...current, status: 'running' }));
      break;
    }
    case 'assignment.heartbeat': {
      assignments = updateAssignment(assignments, String(payload.assignmentId), current => ({ ...current, leaseExpiresAt: Number(payload.leaseExpiresAt) }));
      break;
    }
    case 'assignment.progress_recorded': break;
    case 'assignment.checkpointed': {
      assignments = updateAssignment(assignments, String(payload.assignmentId), current => ({
        ...current,
        checkpointRef: String(payload.checkpointRef),
        checkpointSha: String(payload.checkpointSha),
      }));
      break;
    }
    case 'assignment.execution_completed': {
      const id = String(payload.assignmentId);
      assignments = updateAssignment(assignments, id, current => ({
        ...current,
        status: 'execution_completed',
        reportRef: String(payload.reportRef),
        candidateHash: String(payload.candidateHash),
        outcome: 'committed',
      }));
      task = {
        ...task,
        status: 'awaiting_acceptance',
        reportRef: String(payload.reportRef),
        candidateHash: String(payload.candidateHash),
      };
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, status: 'terminal', completionId: String(payload.completionId) } };
      break;
    }
    case 'assignment.remote_failed':
    case 'assignment.lease_expired':
    case 'assignment.lease_revoked': {
      const id = String(payload.assignmentId);
      assignments = updateAssignment(assignments, id, current => ({
        ...current,
        status: 'lost',
        outcome: payload.outcome as RemoteAssignment['outcome'],
        reason: String(payload.reason),
      }));
      task = task.attempt >= task.maxAttempts
        ? { ...task, status: 'failed', reason: String(payload.reason), currentAssignmentId: undefined }
        : { ...task, status: 'ready', reason: String(payload.reason), currentAssignmentId: undefined };
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, status: 'lost', reason: String(payload.reason) } };
      break;
    }
    case 'assignment.cancel_requested': {
      const id = String(payload.assignmentId);
      assignments = updateAssignment(assignments, id, current => ({ ...current, status: 'cancel_requested', controlDeadline: Number(payload.controlDeadline), reason: String(payload.reason) }));
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, status: 'cancel_pending' } };
      break;
    }
    case 'assignment.cancelled': {
      const id = String(payload.assignmentId);
      assignments = updateAssignment(assignments, id, current => ({ ...current, status: 'cancelled', outcome: payload.outcome as RemoteAssignment['outcome'], reason: String(payload.reason) }));
      task = { ...task, status: 'cancelled', reason: String(payload.reason), currentAssignmentId: undefined };
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, status: 'cancelled', reason: String(payload.reason) } };
      break;
    }
    case 'remote.dispatch_prepared': {
      const id = String(payload.assignmentId);
      links = { ...links, [id]: {
        assignmentId: id,
        dispatch: payload.envelope as RemoteDispatchEnvelope,
        status: 'prepared',
        sendAttempts: 1,
        receiptIds: [],
        lastRemoteSequence: 0,
      } };
      break;
    }
    case 'remote.dispatch_retry_requested': {
      const id = String(payload.assignmentId);
      const link = links[id];
      if (!link) throw new Error(`remote link not found during replay: ${id}`);
      links = { ...links, [id]: { ...link, status: 'prepared', sendAttempts: link.sendAttempts + 1 } };
      break;
    }
    case 'remote.dispatch_receipt_recorded': {
      const id = String(payload.assignmentId);
      const link = links[id];
      if (!link) throw new Error(`remote link not found during replay: ${id}`);
      const outcome = String(payload.outcome);
      links = { ...links, [id]: {
        ...link,
        status: outcome === 'delivered' ? 'attached' : link.status,
        receiptIds: [...link.receiptIds, String(payload.receiptId)],
        remoteTaskId: payload.remoteTaskId ? String(payload.remoteTaskId) : link.remoteTaskId,
        remoteContextId: payload.remoteContextId ? String(payload.remoteContextId) : link.remoteContextId,
      } };
      break;
    }
    case 'remote.reconciliation_required': {
      const id = String(payload.assignmentId);
      const link = links[id];
      if (!link) throw new Error(`remote link not found during replay: ${id}`);
      links = { ...links, [id]: { ...link, status: 'reconcile_required', reconcileDeadline: Number(payload.deadline), reason: String(payload.reason) } };
      break;
    }
    case 'remote.callback_recorded': {
      const callback = payload.callback as RemoteCallback;
      const receiptKey = String(payload.receiptKey);
      callbacks = { ...callbacks, [receiptKey]: {
        eventId: callback.eventId,
        payloadHash: callback.payloadHash,
        assignmentId: callback.assignmentId,
        disposition: payload.disposition as CallbackReceipt['disposition'],
      } };
      const link = links[callback.assignmentId];
      if (link) links = { ...links, [callback.assignmentId]: {
        ...link,
        status: payload.disposition === 'gap' ? 'reconcile_required' : link.status,
        remoteTaskId: link.remoteTaskId ?? callback.remoteTaskId,
        lastRemoteSequence: payload.disposition === 'gap' ? link.lastRemoteSequence : callback.sequence,
      } };
      break;
    }
    case 'remote.callback_ignored': {
      const callback = payload.callback as RemoteCallback;
      const receiptKey = payload.receiptKey ? String(payload.receiptKey) : callbackReceiptKey(state.endpoint.id, callback.eventId);
      callbacks = { ...callbacks, [receiptKey]: {
        eventId: callback.eventId,
        payloadHash: callback.payloadHash,
        assignmentId: callback.assignmentId,
        disposition: 'stale',
      } };
      break;
    }
    case 'remote.callback_conflict': {
      const callback = payload.callback as RemoteCallback;
      const id = callback.assignmentId;
      const assignment = assignments[id];
      if (assignment && !isAssignmentTerminal(assignment.status)) {
        assignments = { ...assignments, [id]: { ...assignment, status: 'blocked', reason: String(payload.reason) } };
        task = { ...task, status: 'blocked', reason: String(payload.reason) };
      }
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, status: 'conflicted', reason: String(payload.reason) } };
      break;
    }
    case 'remote.discussion_observed': {
      discussions = [...discussions, { assignmentId: String(payload.assignmentId), eventId: String(payload.eventId), note: String(payload.note) }];
      break;
    }
    case 'remote.cancel_receipt_recorded': {
      const id = String(payload.assignmentId);
      const link = links[id];
      if (link) links = { ...links, [id]: { ...link, receiptIds: [...link.receiptIds, String(payload.receiptId)] } };
      break;
    }
    case 'clock.advanced': break;
  }
  return {
    ...state,
    sequence: entry.seq,
    now: entry.type === 'clock.advanced' ? Number(payload.now) : Math.max(state.now, entry.at),
    task,
    assignments,
    links,
    callbacks,
    discussions,
  };
}

function event(type: EventDraft['type'], payload: Record<string, unknown>): EventDraft {
  return Object.freeze({ type, payload: Object.freeze(payload) });
}

function requireRole(actor: Principal, role: Principal['role']): void {
  if (actor.role !== role) throw new Error(`${role} authority required`);
}

function requireCompatibleEndpoint(endpoint: RemoteEndpointSnapshot): void {
  if (endpoint.workroomExtension !== 'https://zhin.dev/a2a/extensions/workroom-assignment/v1'
    || !endpoint.idempotentDispatch || !endpoint.typedCompletionEnvelope
    || !endpoint.workspaceProviders.includes('github_pull_request')) {
    throw new Error('remote endpoint is not Workroom Assignment compatible');
  }
}

function requireAssignment(
  state: RemoteA2aState,
  id: string,
  statuses?: readonly AssignmentStatus[],
): RemoteAssignment {
  const assignment = state.assignments[id];
  if (!assignment) throw new Error(`assignment not found: ${id}`);
  if (statuses && !statuses.includes(assignment.status)) throw new Error(`assignment ${id} is ${assignment.status}`);
  return assignment;
}

function requireLink(
  state: RemoteA2aState,
  assignmentId: string,
  statuses?: readonly RemoteLink['status'][],
): RemoteLink {
  const link = state.links[assignmentId];
  if (!link) throw new Error(`remote link not found: ${assignmentId}`);
  if (statuses && !statuses.includes(link.status)) throw new Error(`remote link is ${link.status}`);
  return link;
}

function updateAssignment(
  assignments: RemoteA2aState['assignments'],
  id: string,
  update: (current: RemoteAssignment) => RemoteAssignment,
): RemoteA2aState['assignments'] {
  const current = assignments[id];
  if (!current) throw new Error(`assignment not found during replay: ${id}`);
  return { ...assignments, [id]: update(current) };
}

function highestFence(state: RemoteA2aState): number {
  return Math.max(0, ...Object.values(state.assignments).map(item => item.fence));
}

function isAssignmentTerminal(status: AssignmentStatus): boolean {
  return status === 'execution_completed' || status === 'lost' || status === 'cancelled';
}

function callbackReceiptKey(endpointId: string, eventId: string): string {
  return `${endpointId}:${eventId}`;
}
