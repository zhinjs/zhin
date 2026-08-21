import type {
  WorkroomAssignmentState,
  WorkroomAcceptanceWaitStatus,
  WorkroomCommand,
  WorkroomEvent,
  WorkroomEventDraft,
  WorkroomRunState,
  WorkroomReviewerAssignmentState,
  WorkroomSponsorGateState,
  WorkroomTaskState,
} from './kernel-contracts.js';
import { assertAcceptanceContract, assertPinnedAcceptanceContract } from './acceptance-policy.js';
import {
  assertReviewerVerdictBindings,
  reviewerVerdictRequiresRework,
  type ReviewerVerdict,
} from './acceptance-control.js';

const TERMINAL_TASKS = new Set(['accepted', 'failed', 'cancelled']);
const ACTIVE_ASSIGNMENTS = new Set(['leased', 'running', 'cancel_requested']);

export function replayWorkroom(events: readonly WorkroomEvent[]): WorkroomRunState {
  const first = events[0];
  if (!first || first.type !== 'run.created' || first.sequence !== 0) {
    throw new Error('Workroom journal must begin with run.created at sequence 0');
  }
  let state: WorkroomRunState = {
    runId: first.runId,
    projectId: String(first.payload.projectId ?? ''),
    title: String(first.payload.title ?? ''),
    status: 'active',
    sequence: -1,
    now: first.occurredAt,
    cancelRequested: false,
    tasks: {},
    assignments: {},
    reviewerAssignments: {},
    sponsorGates: {},
  };
  for (const event of events) {
    if (event.runId !== state.runId) throw new Error('Workroom journal contains another run');
    if (event.sequence !== state.sequence + 1) throw new Error('Workroom journal sequence is not contiguous');
    state = evolveWorkroom(state, event);
  }
  return deriveRunStatus(state);
}

export function decideWorkroom(
  state: WorkroomRunState,
  command: WorkroomCommand,
  event: (type: WorkroomEventDraft['type'], payload: Record<string, unknown>) => WorkroomEventDraft,
): readonly WorkroomEventDraft[] {
  if (state.status === 'completed' || state.status === 'cancelled') {
    throw new Error(`Workroom run is terminal: ${state.status}`);
  }
  switch (command.type) {
    case 'plan_task':
      if (state.cancelRequested) throw new Error('Cannot plan while run cancellation is active');
      if (state.tasks[command.taskKey]) throw new Error(`Task ${command.taskKey} already exists`);
      if (!Number.isInteger(command.maxAttempts) || command.maxAttempts < 1) {
        throw new Error('Task maxAttempts must be a positive integer');
      }
      return [event('task.planned', { ...command })];
    case 'block_task': {
      const task = requireTask(state, command.taskKey, ['ready']);
      return [event('task.blocked', { ...command, taskKey: task.key })];
    }
    case 'resolve_blocker': {
      const task = requireTask(state, command.taskKey, ['blocked']);
      if (!task.blockers.some(blocker => blocker.id === command.blockerId)) {
        throw new Error(`Blocker ${command.blockerId} not found`);
      }
      return [event('task.blocker_resolved', { ...command })];
    }
    case 'claim_task': {
      const task = requireTask(state, command.taskKey, ['ready']);
      if (!task.acceptanceContract) throw new Error(`Task ${task.key} Acceptance Contract is not pinned`);
      if (state.assignments[command.assignmentId]) throw new Error('Assignment already exists');
      return [event('assignment.claimed', {
        ...command,
        taskRevision: task.revision,
        attempt: task.attempt + 1,
      })];
    }
    case 'start_assignment':
      requireAssignment(state, command.assignmentId, ['leased']);
      return [event('assignment.started', { assignmentId: command.assignmentId })];
    case 'heartbeat':
      requireAssignment(state, command.assignmentId, ['leased', 'running']);
      return [event('assignment.heartbeat', { ...command })];
    case 'complete_execution':
      requireAssignment(state, command.assignmentId, ['running']);
      return [event('assignment.execution_completed', { ...command })];
    case 'request_rework':
      requireTask(state, command.taskKey, ['awaiting_acceptance']);
      return [event('task.rework_requested', { ...command })];
    case 'revise_task': {
      requireTask(state, command.taskKey, ['failed']);
      if (!Number.isInteger(command.maxAttempts) || command.maxAttempts < 1) {
        throw new Error('Task maxAttempts must be a positive integer');
      }
      return [event('task.revised', { ...command })];
    }
    case 'cancel_run': {
      if (state.cancelRequested) return [];
      const events: WorkroomEventDraft[] = [event('run.cancel_requested', { reason: command.reason })];
      let waiting = 0;
      for (const task of Object.values(state.tasks)) {
        if (TERMINAL_TASKS.has(task.status)) continue;
        events.push(event('task.cancel_requested', { taskKey: task.key, reason: command.reason }));
        const assignment = task.currentAssignmentId
          ? state.assignments[task.currentAssignmentId]
          : undefined;
        if (assignment && ACTIVE_ASSIGNMENTS.has(assignment.status)) {
          waiting += 1;
          events.push(event('assignment.cancel_requested', {
            assignmentId: assignment.id,
            controlDeadline: command.controlDeadline,
          }));
        } else {
          events.push(event('task.cancelled', { taskKey: task.key, reason: command.reason }));
        }
      }
      if (waiting === 0) events.push(event('run.cancelled', { reason: command.reason }));
      return events;
    }
    case 'advance_clock':
      if (!Number.isFinite(command.now) || command.now <= state.now) throw new Error('Clock must advance');
      return decideClock(state, command.now, event);
  }
}

export function evolveWorkroom(state: WorkroomRunState, event: WorkroomEvent): WorkroomRunState {
  let tasks = state.tasks;
  let assignments = state.assignments;
  let reviewerAssignments = state.reviewerAssignments;
  let sponsorGates = state.sponsorGates;
  let cancelRequested = state.cancelRequested;
  let status = state.status;
  const payload = event.payload;

  switch (event.type) {
    case 'run.created': break;
    case 'run.cancel_requested': cancelRequested = true; status = 'cancelling'; break;
    case 'run.cancelled': status = 'cancelled'; break;
    case 'task.planned': {
      const key = String(payload.taskKey);
      tasks = { ...tasks, [key]: {
        key,
        title: String(payload.title),
        status: 'ready',
        revision: 1,
        attempt: 0,
        maxAttempts: Number(payload.maxAttempts),
        required: payload.required === true,
        blockers: [],
      } };
      break;
    }
    case 'task.blocked': {
      const task = requireTask(state, String(payload.taskKey));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        status: 'blocked',
        blockers: [...task.blockers, {
          id: String(payload.blockerId),
          kind: payload.kind as never,
          owner: String(payload.owner),
          reason: String(payload.reason),
          deadline: Number(payload.deadline),
          allowedActions: ['resolve', 'replan', 'cancel'],
        }],
      });
      break;
    }
    case 'task.blocker_resolved': {
      const task = requireTask(state, String(payload.taskKey));
      const blockers = task.blockers.filter(blocker => blocker.id !== payload.blockerId);
      tasks = replaceTask(tasks, task.key, { ...task, blockers, status: blockers.length ? 'blocked' : 'ready' });
      break;
    }
    case 'assignment.claimed': {
      const task = requireTask(state, String(payload.taskKey));
      const assignment: WorkroomAssignmentState = {
        id: String(payload.assignmentId),
        taskKey: task.key,
        taskRevision: Number(payload.taskRevision),
        attempt: Number(payload.attempt),
        role: payload.role as WorkroomAssignmentState['role'],
        status: 'leased',
        owner: String(payload.owner),
        leaseExpiresAt: Number(payload.leaseExpiresAt),
      };
      assignments = { ...assignments, [assignment.id]: assignment };
      tasks = replaceTask(tasks, task.key, {
        ...task,
        status: 'executing',
        attempt: assignment.attempt,
        currentAssignmentId: assignment.id,
      });
      break;
    }
    case 'assignment.started':
    case 'assignment.heartbeat':
    case 'assignment.execution_completed':
    case 'assignment.cancel_requested':
    case 'assignment.cancelled':
    case 'assignment.lease_expired': {
      const assignment = requireAssignment(state, String(payload.assignmentId));
      const next = evolveAssignment(assignment, event);
      assignments = { ...assignments, [assignment.id]: next };
      const task = requireTask(state, assignment.taskKey);
      tasks = replaceTask(tasks, task.key, evolveTaskFromAssignment(task, next, event));
      break;
    }
    case 'task.accepted': {
      const task = requireTask(state, String(payload.taskKey));
      const record = payload.record as NonNullable<WorkroomTaskState['acceptanceRecord']>;
      if (!task.acceptanceContract) throw new Error(`Task ${task.key} Acceptance Contract is not pinned`);
      assertPinnedAcceptanceContract(record.contract, task.acceptanceContract);
      assertAcceptanceRecordControlBindings(state, task, record);
      ({ reviewerAssignments, sponsorGates } = settleAcceptanceWaits(
        task, reviewerAssignments, sponsorGates, 'satisfied',
      ));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        status: 'accepted',
        acceptanceRecord: record,
        currentReviewerAssignmentId: undefined,
        currentSponsorGateId: undefined,
        acceptanceBlockReason: undefined,
      });
      break;
    }
    case 'task.acceptance_pinned': {
      const task = requireTask(state, String(payload.taskKey));
      if (task.status !== 'ready') throw new Error(`Task ${task.key} is ${task.status}`);
      if (task.acceptanceContract) throw new Error(`Task ${task.key} Acceptance Contract is already pinned`);
      const contract = payload.contract as NonNullable<WorkroomTaskState['acceptanceContract']>;
      assertAcceptanceContract(contract, task.key, task.revision);
      tasks = replaceTask(tasks, task.key, {
        ...task,
        acceptanceContract: contract,
      });
      break;
    }
    case 'task.acceptance_blocked': {
      const task = requireTask(state, String(payload.taskKey));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        acceptanceBlockReason: String(payload.reason),
      });
      break;
    }
    case 'reviewer.assigned': {
      const task = requireTask(state, String(payload.taskKey), ['awaiting_acceptance']);
      const assignment = payload.assignment as WorkroomReviewerAssignmentState;
      if (reviewerAssignments[assignment.id]) throw new Error(`Reviewer Assignment ${assignment.id} already exists`);
      if (assignment.owner === assignment.producerPrincipalId) {
        throw new Error('Producer and Reviewer Assignment owner must be different principals');
      }
      assertAcceptanceWaitBinding(task, assignment);
      assertNoOpenAcceptanceWait(state, task);
      reviewerAssignments = { ...reviewerAssignments, [assignment.id]: assignment };
      tasks = replaceTask(tasks, task.key, {
        ...task,
        currentReviewerAssignmentId: assignment.id,
        currentSponsorGateId: undefined,
        acceptanceBlockReason: String(payload.reason),
      });
      break;
    }
    case 'reviewer.expired': {
      const assignment = requireReviewerAssignment(state, String(payload.assignmentId), ['open', 'claimed']);
      if (payload.taskKey !== assignment.taskKey) throw new Error('Reviewer expiry targets another Task');
      reviewerAssignments = {
        ...reviewerAssignments,
        [assignment.id]: { ...assignment, status: 'expired' },
      };
      const task = requireTask(state, assignment.taskKey, ['awaiting_acceptance']);
      tasks = replaceTask(tasks, task.key, {
        ...task,
        acceptanceBlockReason: 'Reviewer deadline expired; reassign, replan or cancel',
      });
      break;
    }
    case 'reviewer.claimed': {
      const assignment = requireReviewerAssignment(state, String(payload.assignmentId), ['open']);
      if (payload.taskKey !== assignment.taskKey) throw new Error('Reviewer claim targets another Task');
      assertPersistedAcceptanceAuthorization(state, payload, {
        action: 'claim_review', role: 'reviewer', principalKey: 'reviewerPrincipalId', targetId: assignment.id,
      });
      if (payload.reviewerPrincipalId === assignment.producerPrincipalId) {
        throw new Error('Producer cannot review its own Candidate');
      }
      reviewerAssignments = {
        ...reviewerAssignments,
        [assignment.id]: {
          ...assignment,
          status: 'claimed',
          reviewerPrincipalId: String(payload.reviewerPrincipalId),
          authorizationRef: String(payload.authorizedBy),
        },
      };
      break;
    }
    case 'reviewer.verdict_recorded': {
      const assignment = requireReviewerAssignment(state, String(payload.assignmentId), ['claimed']);
      if (payload.taskKey !== assignment.taskKey) throw new Error('Reviewer verdict targets another Task');
      assertPersistedAcceptanceAuthorization(state, payload, {
        action: 'submit_review', role: 'reviewer', principalKey: 'reviewerPrincipalId', targetId: assignment.id,
      });
      if (payload.reviewerPrincipalId !== assignment.reviewerPrincipalId) {
        throw new Error('Reviewer verdict principal does not match the claimed Assignment');
      }
      assertReviewerVerdictBindings(assignment.evaluation, payload.verdict);
      const verdict = payload.verdict as ReviewerVerdict;
      const expectedOutcome = reviewerVerdictRequiresRework(verdict) ? 'rework' : 'passed';
      if (payload.outcome !== expectedOutcome) {
        throw new Error('Reviewer verdict outcome does not match its criterion disposition');
      }
      reviewerAssignments = {
        ...reviewerAssignments,
        [assignment.id]: {
          ...assignment,
          status: payload.outcome === 'passed' ? 'passed' : 'rework',
          verdict: verdict as unknown as Readonly<Record<string, unknown>>,
        },
      };
      break;
    }
    case 'sponsor_gate.opened': {
      const task = requireTask(state, String(payload.taskKey), ['awaiting_acceptance']);
      const gate = payload.gate as WorkroomSponsorGateState;
      if (sponsorGates[gate.id]) throw new Error(`Sponsor Gate ${gate.id} already exists`);
      assertAcceptanceWaitBinding(task, gate);
      assertNoOpenAcceptanceWait(state, task);
      sponsorGates = { ...sponsorGates, [gate.id]: gate };
      tasks = replaceTask(tasks, task.key, {
        ...task,
        currentReviewerAssignmentId: undefined,
        currentSponsorGateId: gate.id,
        acceptanceBlockReason: String(payload.reason),
      });
      break;
    }
    case 'sponsor_gate.expired': {
      const gate = requireSponsorGate(state, String(payload.gateId), ['open']);
      if (payload.taskKey !== gate.taskKey) throw new Error('Sponsor Gate expiry targets another Task');
      sponsorGates = { ...sponsorGates, [gate.id]: { ...gate, status: 'expired' } };
      const task = requireTask(state, gate.taskKey, ['awaiting_acceptance']);
      tasks = replaceTask(tasks, task.key, {
        ...task,
        acceptanceBlockReason: 'Sponsor Gate expired; reopen, rebase, replan or cancel',
      });
      break;
    }
    case 'sponsor_gate.decided': {
      const gate = requireSponsorGate(state, String(payload.gateId), ['open']);
      if (payload.taskKey !== gate.taskKey) throw new Error('Sponsor decision targets another Task');
      assertPersistedAcceptanceAuthorization(state, payload, {
        action: 'decide_sponsor', role: 'sponsor', principalKey: 'sponsorPrincipalId', targetId: gate.id,
      });
      if (payload.candidateHash !== gate.candidateHash) {
        throw new Error('Sponsor decision is stale for the current Candidate hash');
      }
      const decision = payload.decision as 'approve' | 'reject' | 'request_changes' | 'cancel';
      sponsorGates = {
        ...sponsorGates,
        [gate.id]: {
          ...gate,
          status: decision === 'approve'
            ? 'approved'
            : decision === 'request_changes'
              ? 'changes_requested'
              : decision === 'reject' ? 'rejected' : 'cancelled',
          sponsorPrincipalId: String(payload.sponsorPrincipalId),
          authorizationRef: String(payload.authorizedBy),
          decisionReason: String(payload.reason),
        },
      };
      break;
    }
    case 'task.rework_requested': {
      const task = requireTask(state, String(payload.taskKey));
      ({ reviewerAssignments, sponsorGates } = settleAcceptanceWaits(
        task, reviewerAssignments, sponsorGates, 'cancelled',
      ));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        status: 'ready',
        revision: task.revision + 1,
        attempt: 0,
        currentAssignmentId: undefined,
        reportRef: undefined,
        acceptanceContract: undefined,
        acceptanceRecord: undefined,
        currentReviewerAssignmentId: undefined,
        currentSponsorGateId: undefined,
        acceptanceBlockReason: undefined,
        terminalReason: String(payload.reason),
      });
      break;
    }
    case 'task.revised': {
      const task = requireTask(state, String(payload.taskKey));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        title: String(payload.title),
        status: 'ready',
        revision: task.revision + 1,
        attempt: 0,
        maxAttempts: Number(payload.maxAttempts),
        currentAssignmentId: undefined,
        reportRef: undefined,
        acceptanceContract: undefined,
        acceptanceRecord: undefined,
        currentReviewerAssignmentId: undefined,
        currentSponsorGateId: undefined,
        acceptanceBlockReason: undefined,
        terminalReason: String(payload.reason),
      });
      break;
    }
    case 'task.cancel_requested': {
      const task = requireTask(state, String(payload.taskKey));
      tasks = replaceTask(tasks, task.key, { ...task, status: 'cancelling' });
      break;
    }
    case 'task.cancelled':
    case 'task.failed': {
      const task = requireTask(state, String(payload.taskKey));
      ({ reviewerAssignments, sponsorGates } = settleAcceptanceWaits(
        task, reviewerAssignments, sponsorGates, 'cancelled',
      ));
      tasks = replaceTask(tasks, task.key, {
        ...task,
        status: event.type === 'task.cancelled' ? 'cancelled' : 'failed',
        terminalReason: String(payload.reason ?? ''),
      });
      break;
    }
    case 'clock.advanced': break;
  }

  return deriveRunStatus({
    ...state,
    status,
    sequence: event.sequence,
    now: event.type === 'clock.advanced' ? Number(payload.now) : Math.max(state.now, event.occurredAt),
    cancelRequested,
    tasks,
    assignments,
    reviewerAssignments,
    sponsorGates,
  });
}

function decideClock(
  state: WorkroomRunState,
  now: number,
  event: (type: WorkroomEventDraft['type'], payload: Record<string, unknown>) => WorkroomEventDraft,
): readonly WorkroomEventDraft[] {
  const events: WorkroomEventDraft[] = [event('clock.advanced', { now })];
  const newlyTerminal = new Set<string>();
  for (const assignment of Object.values(state.assignments)) {
    if (assignment.status === 'cancel_requested' && (assignment.controlDeadline ?? Infinity) <= now) {
      events.push(event('assignment.cancelled', { assignmentId: assignment.id, outcome: 'outcome_unknown' }));
      events.push(event('task.cancelled', { taskKey: assignment.taskKey, reason: 'control deadline expired' }));
      newlyTerminal.add(assignment.taskKey);
    } else if ((assignment.status === 'leased' || assignment.status === 'running')
      && assignment.leaseExpiresAt <= now) {
      const task = state.tasks[assignment.taskKey]!;
      events.push(event('assignment.lease_expired', { assignmentId: assignment.id }));
      if (assignment.attempt >= task.maxAttempts) {
        events.push(event('task.failed', { taskKey: task.key, reason: 'assignment attempts exhausted' }));
        newlyTerminal.add(task.key);
      }
    }
  }
  for (const assignment of Object.values(state.reviewerAssignments)) {
    if ((assignment.status === 'open' || assignment.status === 'claimed') && assignment.deadline <= now) {
      events.push(event('reviewer.expired', {
        taskKey: assignment.taskKey,
        assignmentId: assignment.id,
      }));
    }
  }
  for (const gate of Object.values(state.sponsorGates)) {
    if (gate.status === 'open' && gate.deadline <= now) {
      events.push(event('sponsor_gate.expired', { taskKey: gate.taskKey, gateId: gate.id }));
    }
  }
  if (state.cancelRequested && Object.values(state.tasks).every(task =>
    TERMINAL_TASKS.has(task.status) || newlyTerminal.has(task.key))) {
    events.push(event('run.cancelled', { reason: 'all task cancellation controls settled' }));
  }
  return events;
}

function evolveAssignment(
  assignment: WorkroomAssignmentState,
  event: WorkroomEvent,
): WorkroomAssignmentState {
  switch (event.type) {
    case 'assignment.started': return { ...assignment, status: 'running' };
    case 'assignment.heartbeat': return { ...assignment, leaseExpiresAt: Number(event.payload.leaseExpiresAt) };
    case 'assignment.execution_completed': return {
      ...assignment,
      status: 'execution_completed',
      reportRef: String(event.payload.reportRef),
    };
    case 'assignment.cancel_requested': return {
      ...assignment,
      status: 'cancel_requested',
      controlDeadline: Number(event.payload.controlDeadline),
    };
    case 'assignment.cancelled': return {
      ...assignment,
      status: 'cancelled',
      outcome: event.payload.outcome as WorkroomAssignmentState['outcome'],
    };
    case 'assignment.lease_expired': return { ...assignment, status: 'lost', outcome: 'outcome_unknown' };
    default: return assignment;
  }
}

function evolveTaskFromAssignment(
  task: WorkroomTaskState,
  assignment: WorkroomAssignmentState,
  event: WorkroomEvent,
): WorkroomTaskState {
  if (event.type === 'assignment.execution_completed') {
    return { ...task, status: 'awaiting_acceptance', reportRef: assignment.reportRef };
  }
  if (event.type === 'assignment.cancel_requested') return { ...task, status: 'cancelling' };
  if (event.type === 'assignment.cancelled') return { ...task, status: 'cancelled' };
  if (event.type === 'assignment.lease_expired') {
    return task.attempt >= task.maxAttempts
      ? { ...task, status: 'failed', terminalReason: 'assignment attempts exhausted' }
      : { ...task, status: 'ready', currentAssignmentId: undefined };
  }
  return task;
}

function deriveRunStatus(state: WorkroomRunState): WorkroomRunState {
  if (state.status === 'cancelled') return state;
  const tasks = Object.values(state.tasks);
  if (state.cancelRequested) return { ...state, status: 'cancelling' };
  if (tasks.length > 0 && tasks.every(task => task.status === 'accepted' || (!task.required && TERMINAL_TASKS.has(task.status)))) {
    return { ...state, status: 'completed' };
  }
  if (tasks.some(task => task.required && (task.status === 'failed' || task.status === 'cancelled'))) {
    return { ...state, status: 'needs_replan' };
  }
  if (tasks.some(task =>
    (task.currentReviewerAssignmentId
      && state.reviewerAssignments[task.currentReviewerAssignmentId]?.status === 'expired')
    || (task.currentSponsorGateId
      && state.sponsorGates[task.currentSponsorGateId]?.status === 'expired'))) {
    return { ...state, status: 'blocked' };
  }
  if (tasks.some(task => task.status === 'blocked')) return { ...state, status: 'blocked' };
  return { ...state, status: 'active' };
}

function replaceTask(
  tasks: WorkroomRunState['tasks'],
  key: string,
  task: WorkroomTaskState,
): WorkroomRunState['tasks'] {
  return { ...tasks, [key]: task };
}

function requireTask(
  state: WorkroomRunState,
  key: string,
  statuses?: readonly WorkroomTaskState['status'][],
): WorkroomTaskState {
  const task = state.tasks[key];
  if (!task) throw new Error(`Task ${key} not found`);
  if (statuses && !statuses.includes(task.status)) throw new Error(`Task ${key} is ${task.status}`);
  return task;
}

function requireAssignment(
  state: WorkroomRunState,
  id: string,
  statuses?: readonly WorkroomAssignmentState['status'][],
): WorkroomAssignmentState {
  const assignment = state.assignments[id];
  if (!assignment) throw new Error(`Assignment ${id} not found`);
  if (statuses && !statuses.includes(assignment.status)) throw new Error(`Assignment ${id} is ${assignment.status}`);
  return assignment;
}

function requireReviewerAssignment(
  state: WorkroomRunState,
  id: string,
  statuses?: readonly WorkroomReviewerAssignmentState['status'][],
): WorkroomReviewerAssignmentState {
  const assignment = state.reviewerAssignments[id];
  if (!assignment) throw new Error(`Reviewer Assignment ${id} not found`);
  if (statuses && !statuses.includes(assignment.status)) {
    throw new Error(`Reviewer Assignment ${id} is ${assignment.status}`);
  }
  return assignment;
}

function requireSponsorGate(
  state: WorkroomRunState,
  id: string,
  statuses?: readonly WorkroomSponsorGateState['status'][],
): WorkroomSponsorGateState {
  const gate = state.sponsorGates[id];
  if (!gate) throw new Error(`Sponsor Gate ${id} not found`);
  if (statuses && !statuses.includes(gate.status)) throw new Error(`Sponsor Gate ${id} is ${gate.status}`);
  return gate;
}

function assertAcceptanceWaitBinding(
  task: WorkroomTaskState,
  wait: WorkroomReviewerAssignmentState | WorkroomSponsorGateState,
): void {
  const contract = task.acceptanceContract;
  if (!contract
    || wait.taskKey !== task.key
    || wait.taskRevision !== task.revision
    || wait.contractId !== contract.id
    || wait.policy.id !== contract.policy.id
    || wait.policy.revision !== contract.policy.revision
    || wait.policy.digest !== contract.policy.digest) {
    throw new Error('Acceptance wait does not match the pinned Task, Contract and Policy snapshot');
  }
}

function assertNoOpenAcceptanceWait(state: WorkroomRunState, task: WorkroomTaskState): void {
  const review = task.currentReviewerAssignmentId
    ? state.reviewerAssignments[task.currentReviewerAssignmentId]
    : undefined;
  const gate = task.currentSponsorGateId ? state.sponsorGates[task.currentSponsorGateId] : undefined;
  if (review?.status === 'open' || review?.status === 'claimed' || gate?.status === 'open') {
    throw new Error(`Task ${task.key} already has an open Acceptance wait`);
  }
}

function assertAcceptanceRecordControlBindings(
  state: WorkroomRunState,
  task: WorkroomTaskState,
  record: NonNullable<WorkroomTaskState['acceptanceRecord']>,
): void {
  if (record.route === 'auto_accept') {
    if (record.reviewerAssignmentId || record.sponsorGateId) {
      throw new Error('Automatic Acceptance Record cannot reference Reviewer or Sponsor proof');
    }
    return;
  }
  if (record.route === 'reviewer_required' || record.route === 'reviewer_then_sponsor') {
    const reviewId = record.reviewerAssignmentId;
    const review = reviewId ? state.reviewerAssignments[reviewId] : undefined;
    if (!review
      || (record.route === 'reviewer_required' && task.currentReviewerAssignmentId !== review.id)
      || review.status !== 'passed'
      || review.reviewerPrincipalId !== record.reviewerPrincipalId
      || review.candidateHash !== record.candidateHash) {
      throw new Error('Acceptance Record is not bound to a passed Reviewer verdict');
    }
  }
  if (record.route === 'sponsor_required' || record.route === 'reviewer_then_sponsor') {
    const gateId = record.sponsorGateId;
    const gate = gateId ? state.sponsorGates[gateId] : undefined;
    if (!gate
      || task.currentSponsorGateId !== gate.id
      || gate.status !== 'approved'
      || gate.sponsorPrincipalId !== record.sponsorPrincipalId
      || gate.candidateHash !== record.candidateHash
      || (record.route === 'reviewer_then_sponsor'
        && gate.reviewerAssignmentId !== record.reviewerAssignmentId)) {
      throw new Error('Acceptance Record is not bound to an approved Sponsor Gate');
    }
  }
}

function assertPersistedAcceptanceAuthorization(
  state: WorkroomRunState,
  payload: Readonly<Record<string, unknown>>,
  expected: Readonly<{
    action: 'claim_review' | 'submit_review' | 'decide_sponsor';
    role: 'reviewer' | 'sponsor';
    principalKey: 'reviewerPrincipalId' | 'sponsorPrincipalId';
    targetId: string;
  }>,
): void {
  const authorization = payload.authorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new Error('Acceptance control event is missing its authorization decision');
  }
  const value = authorization as Readonly<Record<string, unknown>>;
  if (value.authorized !== true
    || value.action !== expected.action
    || value.role !== expected.role
    || value.principalId !== payload[expected.principalKey]
    || value.projectId !== state.projectId
    || value.runId !== state.runId
    || value.taskKey !== payload.taskKey
    || value.targetId !== expected.targetId
    || value.expectedSequence !== state.sequence
    || value.authorizedBy !== payload.authorizedBy) {
    throw new Error('Acceptance control event authorization is stale or targets another scope');
  }
}

function settleAcceptanceWaits(
  task: WorkroomTaskState,
  reviewerAssignments: WorkroomRunState['reviewerAssignments'],
  sponsorGates: WorkroomRunState['sponsorGates'],
  status: Extract<WorkroomAcceptanceWaitStatus, 'cancelled' | 'satisfied' | 'stale'>,
): Pick<WorkroomRunState, 'reviewerAssignments' | 'sponsorGates'> {
  const reviewId = task.currentReviewerAssignmentId;
  const review = reviewId ? reviewerAssignments[reviewId] : undefined;
  const gateId = task.currentSponsorGateId;
  const gate = gateId ? sponsorGates[gateId] : undefined;
  return {
    reviewerAssignments: review?.status === 'open' || review?.status === 'claimed'
      ? { ...reviewerAssignments, [review.id]: { ...review, status } }
      : reviewerAssignments,
    sponsorGates: gate?.status === 'open'
      ? { ...sponsorGates, [gate.id]: { ...gate, status } }
      : sponsorGates,
  };
}
