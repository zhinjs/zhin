/**
 * PROTOTYPE — throw away after decision-map ticket #1 is resolved.
 *
 * Question: can one event-sourced Kernel represent blocking, role-bound
 * assignments, lease recovery, safe preemption, cancellation and acceptance
 * without a second mutable Dispatcher/TaskQueue authority?
 */

export type RunStatus = 'active' | 'blocked' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type TaskStatus =
  | 'ready'
  | 'blocked'
  | 'executing'
  | 'paused'
  | 'awaiting_acceptance'
  | 'cancelling'
  | 'accepted'
  | 'failed'
  | 'cancelled';
export type AssignmentStatus =
  | 'leased'
  | 'running'
  | 'preempt_requested'
  | 'paused'
  | 'cancel_requested'
  | 'execution_completed'
  | 'lost'
  | 'cancelled';
export type ExecutionRole = 'executor' | 'reviewer' | 'integration';
export type BlockerKind = 'dependency' | 'approval' | 'capability' | 'external' | 'human_input';

export interface Blocker {
  readonly id: string;
  readonly kind: BlockerKind;
  readonly owner: string;
  readonly reason: string;
  readonly deadline: number;
  readonly allowedActions: readonly ('resolve' | 'replan' | 'cancel')[];
}

export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly blockers: readonly Blocker[];
  readonly currentAssignmentId?: string;
  readonly reportRef?: string;
  readonly terminalReason?: string;
}

export interface AssignmentState {
  readonly id: string;
  readonly taskId: string;
  readonly revision: number;
  readonly attempt: number;
  readonly role: ExecutionRole;
  readonly status: AssignmentStatus;
  readonly owner: string;
  readonly leaseExpiresAt: number;
  readonly controlDeadline?: number;
  readonly checkpointRef?: string;
  readonly outcome?: 'interrupted' | 'committed' | 'outcome_unknown';
}

export interface KernelState {
  readonly runId: string;
  readonly status: RunStatus;
  readonly now: number;
  readonly cancelRequested: boolean;
  readonly tasks: Readonly<Record<string, TaskState>>;
  readonly assignments: Readonly<Record<string, AssignmentState>>;
}

export type KernelEvent = Readonly<{
  seq: number;
  type:
    | 'run.created'
    | 'run.cancel_requested'
    | 'run.cancelled'
    | 'task.planned'
    | 'task.blocked'
    | 'task.blocker_resolved'
    | 'task.cancel_requested'
    | 'task.cancelled'
    | 'task.accepted'
    | 'task.rework_requested'
    | 'assignment.claimed'
    | 'assignment.started'
    | 'assignment.heartbeat'
    | 'assignment.preempt_requested'
    | 'assignment.paused'
    | 'assignment.resumed'
    | 'assignment.execution_completed'
    | 'assignment.cancel_requested'
    | 'assignment.cancelled'
    | 'assignment.lease_expired'
    | 'assignment.control_expired'
    | 'clock.advanced';
  payload: Readonly<Record<string, unknown>>;
}>;

export type KernelCommand =
  | Readonly<{ type: 'plan_task'; title: string }>
  | Readonly<{ type: 'block_task'; taskId: string; kind: BlockerKind; owner: string; reason: string }>
  | Readonly<{ type: 'resolve_blocker'; taskId: string }>
  | Readonly<{ type: 'claim_task'; taskId: string; owner: string; role: ExecutionRole }>
  | Readonly<{ type: 'start_assignment'; taskId: string }>
  | Readonly<{ type: 'heartbeat'; taskId: string }>
  | Readonly<{ type: 'request_preempt'; taskId: string }>
  | Readonly<{ type: 'checkpoint_pause'; taskId: string }>
  | Readonly<{ type: 'resume_task'; taskId: string }>
  | Readonly<{ type: 'complete_execution'; taskId: string }>
  | Readonly<{ type: 'accept_task'; taskId: string }>
  | Readonly<{ type: 'request_rework'; taskId: string; reason: string }>
  | Readonly<{ type: 'cancel_task'; taskId: string; reason: string }>
  | Readonly<{ type: 'ack_cancel'; taskId: string; outcome: 'interrupted' | 'committed' }>
  | Readonly<{ type: 'cancel_run'; reason: string }>
  | Readonly<{ type: 'advance_clock'; seconds: number }>;

const TERMINAL_TASKS = new Set<TaskStatus>(['accepted', 'failed', 'cancelled']);
const ACTIVE_ASSIGNMENTS = new Set<AssignmentStatus>([
  'leased', 'running', 'preempt_requested', 'cancel_requested',
]);

export function initialJournal(runId = 'run-1'): readonly KernelEvent[] {
  return [event(0, 'run.created', { runId })];
}

export function replay(events: readonly KernelEvent[]): KernelState {
  if (events.length === 0 || events[0]?.type !== 'run.created') {
    throw new Error('journal must begin with run.created');
  }
  let state: KernelState = {
    runId: String(events[0].payload.runId),
    status: 'active',
    now: 0,
    cancelRequested: false,
    tasks: {},
    assignments: {},
  };
  for (const entry of events) state = evolve(state, entry);
  return deriveRunStatus(state);
}

export function dispatch(
  journal: readonly KernelEvent[],
  command: KernelCommand,
): readonly KernelEvent[] {
  const state = replay(journal);
  const decided = decide(state, command);
  return Object.freeze([
    ...journal,
    ...decided.map((entry, index) => ({ ...entry, seq: journal.length + index })),
  ]);
}

export function allowedTaskActions(task: TaskState): readonly string[] {
  switch (task.status) {
    case 'ready': return ['claim', 'block', 'cancel'];
    case 'blocked': return ['resolve', 'replan', 'cancel'];
    case 'executing': return ['start/heartbeat', 'preempt', 'complete', 'cancel'];
    case 'paused': return ['resume', 'cancel'];
    case 'awaiting_acceptance': return ['accept', 'rework', 'cancel'];
    case 'cancelling': return ['ack cancel', 'advance clock'];
    default: return [];
  }
}

function decide(state: KernelState, command: KernelCommand): readonly Omit<KernelEvent, 'seq'>[] {
  if (state.status === 'cancelled' || state.status === 'completed' || state.status === 'failed') {
    throw new Error(`run is terminal: ${state.status}`);
  }
  switch (command.type) {
    case 'plan_task': {
      if (state.cancelRequested) throw new Error('cannot plan task while run cancellation is active');
      const taskId = `task-${Object.keys(state.tasks).length + 1}`;
      return [domainEvent('task.planned', { taskId, title: command.title, maxAttempts: 2 })];
    }
    case 'block_task': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['ready']);
      return [domainEvent('task.blocked', {
        taskId: task.id,
        blockerId: `blocker-${task.blockers.length + 1}`,
        kind: command.kind,
        owner: command.owner,
        reason: command.reason,
        deadline: state.now + 30,
        allowedActions: ['resolve', 'replan', 'cancel'],
      })];
    }
    case 'resolve_blocker': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['blocked']);
      const blocker = task.blockers[0];
      if (!blocker) throw new Error('task has no blocker');
      return [domainEvent('task.blocker_resolved', { taskId: task.id, blockerId: blocker.id })];
    }
    case 'claim_task': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['ready']);
      const assignmentId = `${task.id}:rev-${task.revision}:attempt-${task.attempt + 1}`;
      return [domainEvent('assignment.claimed', {
        taskId: task.id,
        assignmentId,
        revision: task.revision,
        attempt: task.attempt + 1,
        owner: command.owner,
        role: command.role,
        leaseExpiresAt: state.now + 20,
      })];
    }
    case 'start_assignment': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['leased']);
      return [domainEvent('assignment.started', { assignmentId: assignment.id })];
    }
    case 'heartbeat': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['leased', 'running']);
      return [domainEvent('assignment.heartbeat', {
        assignmentId: assignment.id,
        leaseExpiresAt: state.now + 20,
      })];
    }
    case 'request_preempt': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['running']);
      return [domainEvent('assignment.preempt_requested', {
        assignmentId: assignment.id,
        controlDeadline: state.now + 10,
      })];
    }
    case 'checkpoint_pause': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['preempt_requested']);
      return [domainEvent('assignment.paused', {
        assignmentId: assignment.id,
        checkpointRef: `checkpoint://${assignment.id}/${state.now}`,
      })];
    }
    case 'resume_task': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['paused']);
      return [domainEvent('assignment.resumed', { taskId: task.id })];
    }
    case 'complete_execution': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['running']);
      return [domainEvent('assignment.execution_completed', {
        assignmentId: assignment.id,
        reportRef: `report://${assignment.id}`,
      })];
    }
    case 'accept_task': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['awaiting_acceptance']);
      return [domainEvent('task.accepted', { taskId: task.id, reportRef: task.reportRef })];
    }
    case 'request_rework': {
      const task = requireTask(state, command.taskId);
      requireTaskStatus(task, ['awaiting_acceptance']);
      return [domainEvent('task.rework_requested', { taskId: task.id, reason: command.reason })];
    }
    case 'cancel_task':
      return decideTaskCancellation(state, command.taskId, command.reason);
    case 'ack_cancel': {
      const assignment = requireCurrentAssignment(state, command.taskId);
      requireAssignmentStatus(assignment, ['cancel_requested']);
      const events: Omit<KernelEvent, 'seq'>[] = [
        domainEvent('assignment.cancelled', { assignmentId: assignment.id, outcome: command.outcome }),
        domainEvent('task.cancelled', { taskId: assignment.taskId, reason: 'executor acknowledged cancellation' }),
      ];
      if (state.cancelRequested && countOtherNonTerminalTasks(state, assignment.taskId) === 0) {
        events.push(domainEvent('run.cancelled', { reason: 'all tasks cancelled' }));
      }
      return events;
    }
    case 'cancel_run': {
      if (state.cancelRequested) return [];
      const events: Omit<KernelEvent, 'seq'>[] = [domainEvent('run.cancel_requested', { reason: command.reason })];
      let pendingAcknowledgements = 0;
      for (const task of Object.values(state.tasks)) {
        if (TERMINAL_TASKS.has(task.status)) continue;
        events.push(domainEvent('task.cancel_requested', { taskId: task.id, reason: command.reason }));
        const assignment = currentAssignment(state, task);
        if (assignment && ACTIVE_ASSIGNMENTS.has(assignment.status)) {
          pendingAcknowledgements += 1;
          events.push(domainEvent('assignment.cancel_requested', {
            assignmentId: assignment.id,
            controlDeadline: state.now + 10,
          }));
        } else {
          events.push(domainEvent('task.cancelled', { taskId: task.id, reason: command.reason }));
        }
      }
      if (pendingAcknowledgements === 0) {
        events.push(domainEvent('run.cancelled', { reason: command.reason }));
      }
      return events;
    }
    case 'advance_clock':
      return decideClockAdvance(state, command.seconds);
  }
}

function decideTaskCancellation(
  state: KernelState,
  taskId: string,
  reason: string,
): readonly Omit<KernelEvent, 'seq'>[] {
  const task = requireTask(state, taskId);
  if (TERMINAL_TASKS.has(task.status)) throw new Error(`task is terminal: ${task.status}`);
  const events: Omit<KernelEvent, 'seq'>[] = [domainEvent('task.cancel_requested', { taskId, reason })];
  const assignment = currentAssignment(state, task);
  if (assignment && ACTIVE_ASSIGNMENTS.has(assignment.status)) {
    events.push(domainEvent('assignment.cancel_requested', {
      assignmentId: assignment.id,
      controlDeadline: state.now + 10,
    }));
  } else {
    events.push(domainEvent('task.cancelled', { taskId, reason }));
  }
  return events;
}

function decideClockAdvance(state: KernelState, seconds: number): readonly Omit<KernelEvent, 'seq'>[] {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('seconds must be positive');
  const now = state.now + seconds;
  const events: Omit<KernelEvent, 'seq'>[] = [domainEvent('clock.advanced', { now })];
  let terminalAfter = Object.values(state.tasks).filter((task) => TERMINAL_TASKS.has(task.status)).length;
  for (const assignment of Object.values(state.assignments)) {
    if (assignment.status === 'cancel_requested' && (assignment.controlDeadline ?? Infinity) <= now) {
      events.push(domainEvent('assignment.cancelled', {
        assignmentId: assignment.id,
        outcome: 'outcome_unknown',
        forced: true,
      }));
      events.push(domainEvent('task.cancelled', {
        taskId: assignment.taskId,
        reason: 'cancellation deadline expired',
      }));
      terminalAfter += 1;
      continue;
    }
    if (assignment.status === 'preempt_requested' && (assignment.controlDeadline ?? Infinity) <= now) {
      const task = state.tasks[assignment.taskId]!;
      const exhausted = assignment.attempt >= task.maxAttempts;
      events.push(domainEvent('assignment.control_expired', {
        assignmentId: assignment.id,
        exhausted,
        control: 'preempt',
      }));
      if (exhausted) terminalAfter += 1;
      continue;
    }
    if ((assignment.status === 'leased' || assignment.status === 'running') && assignment.leaseExpiresAt <= now) {
      const task = state.tasks[assignment.taskId]!;
      const exhausted = assignment.attempt >= task.maxAttempts;
      events.push(domainEvent('assignment.lease_expired', {
        assignmentId: assignment.id,
        exhausted,
      }));
      if (exhausted) terminalAfter += 1;
    }
  }
  if (state.cancelRequested && terminalAfter === Object.keys(state.tasks).length) {
    events.push(domainEvent('run.cancelled', { reason: 'cancellation deadlines settled' }));
  }
  return events;
}

function evolve(state: KernelState, entry: KernelEvent): KernelState {
  const tasks = { ...state.tasks };
  const assignments = { ...state.assignments };
  let next: KernelState = { ...state, tasks, assignments };
  const payload = entry.payload;
  const taskId = String(payload.taskId ?? '');
  const assignmentId = String(payload.assignmentId ?? '');
  switch (entry.type) {
    case 'run.created': break;
    case 'run.cancel_requested': next = { ...next, cancelRequested: true }; break;
    case 'run.cancelled': next = { ...next, status: 'cancelled' }; break;
    case 'clock.advanced': next = { ...next, now: Number(payload.now) }; break;
    case 'task.planned':
      tasks[taskId] = {
        id: taskId,
        title: String(payload.title),
        status: 'ready',
        revision: 1,
        attempt: 0,
        maxAttempts: Number(payload.maxAttempts),
        blockers: [],
      };
      break;
    case 'task.blocked': {
      const task = tasks[taskId]!;
      tasks[taskId] = {
        ...task,
        status: 'blocked',
        blockers: [...task.blockers, {
          id: String(payload.blockerId),
          kind: payload.kind as BlockerKind,
          owner: String(payload.owner),
          reason: String(payload.reason),
          deadline: Number(payload.deadline),
          allowedActions: payload.allowedActions as Blocker['allowedActions'],
        }],
      };
      break;
    }
    case 'task.blocker_resolved': {
      const task = tasks[taskId]!;
      const blockers = task.blockers.filter((item) => item.id !== payload.blockerId);
      tasks[taskId] = { ...task, blockers, status: blockers.length === 0 ? 'ready' : 'blocked' };
      break;
    }
    case 'assignment.claimed': {
      const task = tasks[taskId]!;
      assignments[assignmentId] = {
        id: assignmentId,
        taskId,
        revision: Number(payload.revision),
        attempt: Number(payload.attempt),
        role: payload.role as ExecutionRole,
        status: 'leased',
        owner: String(payload.owner),
        leaseExpiresAt: Number(payload.leaseExpiresAt),
      };
      tasks[taskId] = {
        ...task,
        status: 'executing',
        attempt: Number(payload.attempt),
        currentAssignmentId: assignmentId,
      };
      break;
    }
    case 'assignment.started':
      assignments[assignmentId] = { ...assignments[assignmentId]!, status: 'running' };
      break;
    case 'assignment.heartbeat':
      assignments[assignmentId] = {
        ...assignments[assignmentId]!,
        leaseExpiresAt: Number(payload.leaseExpiresAt),
      };
      break;
    case 'assignment.preempt_requested':
      assignments[assignmentId] = {
        ...assignments[assignmentId]!,
        status: 'preempt_requested',
        controlDeadline: Number(payload.controlDeadline),
      };
      break;
    case 'assignment.paused': {
      const assignment = assignments[assignmentId]!;
      assignments[assignmentId] = {
        ...assignment,
        status: 'paused',
        checkpointRef: String(payload.checkpointRef),
      };
      tasks[assignment.taskId] = { ...tasks[assignment.taskId]!, status: 'paused' };
      break;
    }
    case 'assignment.resumed': {
      const task = tasks[taskId]!;
      tasks[taskId] = { ...task, status: 'ready', currentAssignmentId: undefined };
      break;
    }
    case 'assignment.execution_completed': {
      const assignment = assignments[assignmentId]!;
      assignments[assignmentId] = { ...assignment, status: 'execution_completed' };
      tasks[assignment.taskId] = {
        ...tasks[assignment.taskId]!,
        status: 'awaiting_acceptance',
        reportRef: String(payload.reportRef),
      };
      break;
    }
    case 'task.accepted':
      tasks[taskId] = { ...tasks[taskId]!, status: 'accepted', reportRef: String(payload.reportRef) };
      break;
    case 'task.rework_requested':
      tasks[taskId] = {
        ...tasks[taskId]!,
        status: 'ready',
        revision: tasks[taskId]!.revision + 1,
        attempt: 0,
        currentAssignmentId: undefined,
        reportRef: undefined,
        terminalReason: String(payload.reason),
      };
      break;
    case 'task.cancel_requested':
      tasks[taskId] = { ...tasks[taskId]!, status: 'cancelling', terminalReason: String(payload.reason) };
      break;
    case 'assignment.cancel_requested':
      assignments[assignmentId] = {
        ...assignments[assignmentId]!,
        status: 'cancel_requested',
        controlDeadline: Number(payload.controlDeadline),
      };
      break;
    case 'assignment.cancelled':
      assignments[assignmentId] = {
        ...assignments[assignmentId]!,
        status: 'cancelled',
        outcome: payload.outcome as AssignmentState['outcome'],
      };
      break;
    case 'task.cancelled':
      tasks[taskId] = { ...tasks[taskId]!, status: 'cancelled', terminalReason: String(payload.reason) };
      break;
    case 'assignment.lease_expired':
    case 'assignment.control_expired': {
      const assignment = assignments[assignmentId]!;
      assignments[assignmentId] = { ...assignment, status: 'lost', outcome: 'outcome_unknown' };
      tasks[assignment.taskId] = {
        ...tasks[assignment.taskId]!,
        status: payload.exhausted ? 'failed' : 'ready',
        currentAssignmentId: undefined,
        terminalReason: payload.exhausted
          ? 'assignment attempts exhausted'
          : entry.type === 'assignment.control_expired'
            ? 'preemption deadline expired; retryable'
            : 'lease expired; retryable',
      };
      break;
    }
  }
  return deriveRunStatus(next);
}

function deriveRunStatus(state: KernelState): KernelState {
  if (state.status === 'cancelled') return state;
  const tasks = Object.values(state.tasks);
  let status: RunStatus = 'active';
  if (state.cancelRequested) status = 'cancelling';
  else if (tasks.some((task) => task.status === 'failed' || task.status === 'cancelled')) status = 'failed';
  else if (tasks.length > 0 && tasks.every((task) => task.status === 'accepted')) status = 'completed';
  else if (tasks.length > 0 && tasks.every((task) => (
    task.status === 'blocked' || task.status === 'paused' || task.status === 'awaiting_acceptance'
  ))) status = 'blocked';
  return { ...state, status };
}

function requireTask(state: KernelState, taskId: string): TaskState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`unknown task: ${taskId}`);
  return task;
}

function currentAssignment(state: KernelState, task: TaskState): AssignmentState | undefined {
  return task.currentAssignmentId ? state.assignments[task.currentAssignmentId] : undefined;
}

function requireCurrentAssignment(state: KernelState, taskId: string): AssignmentState {
  const task = requireTask(state, taskId);
  const assignment = currentAssignment(state, task);
  if (!assignment) throw new Error(`task ${taskId} has no current assignment`);
  return assignment;
}

function requireTaskStatus(task: TaskState, allowed: readonly TaskStatus[]): void {
  if (!allowed.includes(task.status)) {
    throw new Error(`task ${task.id} is ${task.status}; expected ${allowed.join(' | ')}`);
  }
}

function requireAssignmentStatus(assignment: AssignmentState, allowed: readonly AssignmentStatus[]): void {
  if (!allowed.includes(assignment.status)) {
    throw new Error(`assignment ${assignment.id} is ${assignment.status}; expected ${allowed.join(' | ')}`);
  }
}

function countOtherNonTerminalTasks(state: KernelState, taskId: string): number {
  return Object.values(state.tasks).filter((task) => task.id !== taskId && !TERMINAL_TASKS.has(task.status)).length;
}

function event(
  seq: number,
  type: KernelEvent['type'],
  payload: Record<string, unknown>,
): KernelEvent {
  return Object.freeze({ seq, type, payload: Object.freeze(payload) });
}

function domainEvent(
  type: KernelEvent['type'],
  payload: Record<string, unknown>,
): Omit<KernelEvent, 'seq'> {
  return { type, payload: Object.freeze(payload) };
}
