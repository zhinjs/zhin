/**
 * PROTOTYPE — delete after decision-map ticket #2 is absorbed.
 *
 * Question: can an event-sourced Workflow Plan and a pure Scheduler provide
 * deterministic DAG readiness, bounded starvation, dynamic revisions and safe
 * preemption without giving the Orchestrator or an in-memory queue authority?
 */

export type SponsorLane = 'urgent' | 'high' | 'normal' | 'low';
export type Requirement = 'required' | 'optional';
export type Preemptibility = 'checkpointable' | 'atomic';
export type SchedulerRunStatus = 'active' | 'awaiting_approval' | 'needs_replan' | 'completed';
export type ScheduledTaskStatus =
  | 'waiting_dependency'
  | 'ready'
  | 'running'
  | 'preempt_requested'
  | 'paused'
  | 'accepted'
  | 'failed'
  | 'skipped'
  | 'superseded';

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly sponsorLane: SponsorLane;
  readonly status: 'pending_plan' | 'planned';
  readonly receivedAt: number;
}

export interface ScheduledTask {
  readonly id: string;
  readonly title: string;
  readonly planRevision: number;
  readonly sponsorLane: SponsorLane;
  readonly localRank: number;
  readonly requirement: Requirement;
  readonly dependencies: readonly string[];
  readonly preemptibility: Preemptibility;
  readonly status: ScheduledTaskStatus;
  readonly readySince?: number;
  readonly enqueuedSeq?: number;
  readonly deadline?: number;
  readonly supersedes?: string;
  readonly checkpointRef?: string;
  readonly terminalReason?: string;
}

export interface TaskSpec {
  readonly id: string;
  readonly title: string;
  readonly sponsorLane: SponsorLane;
  readonly localRank: number;
  readonly requirement: Requirement;
  readonly dependencies: readonly string[];
  readonly preemptibility: Preemptibility;
  readonly deadline?: number;
  readonly supersedes?: string;
}

export interface PlanRevision {
  readonly id: string;
  readonly baseRevision: number;
  readonly targetRevision: number;
  readonly proposedBy: 'orchestrator';
  readonly reason: string;
  readonly status: 'proposed' | 'approval_required' | 'applied' | 'rejected' | 'stale';
  readonly approval?: Readonly<{
    owner: 'sponsor';
    deadline: number;
    allowedActions: readonly ['approve', 'reject', 'rebase', 'cancel_run'];
  }>;
  readonly resolutionReason?: string;
  readonly sourceInboxId?: string;
  readonly parentTaskId?: string;
  readonly authorizedLane: SponsorLane;
  readonly task: TaskSpec;
}

export interface PreemptionReservation {
  readonly victimTaskId: string;
  readonly reservedTaskId: string;
  readonly deadline: number;
  readonly reason: 'higher_priority' | 'starvation_bound';
}

export interface SchedulerState {
  readonly sequence: number;
  readonly now: number;
  readonly capacity: number;
  readonly policy: SchedulerPolicy;
  readonly currentPlanRevision: number;
  readonly runStatus: SchedulerRunStatus;
  readonly inbox: Readonly<Record<string, InboxItem>>;
  readonly revisions: Readonly<Record<string, PlanRevision>>;
  readonly tasks: Readonly<Record<string, ScheduledTask>>;
  readonly dispatchedByLane: Readonly<Record<SponsorLane, number>>;
  readonly preemption?: PreemptionReservation;
}

export interface SchedulerPolicy {
  readonly version: 1;
  readonly agingStepSeconds: number;
  readonly preemptionDeadlineSeconds: number;
  readonly starvationBoundByLane: Readonly<Record<SponsorLane, number>>;
}

export type SchedulerEvent = Readonly<{
  seq: number;
  type:
    | 'scheduler.created'
    | 'clock.advanced'
    | 'inbox.received'
    | 'plan.revision_proposed'
    | 'plan.revision_approval_required'
    | 'plan.revision_rejected'
    | 'plan.revision_applied'
    | 'task.ready'
    | 'task.dispatched'
    | 'task.preempt_requested'
    | 'task.preemption_timed_out'
    | 'task.checkpointed'
    | 'task.accepted'
    | 'task.failed'
    | 'task.skipped';
  payload: Readonly<Record<string, unknown>>;
}>;

export type SchedulerCommand =
  | Readonly<{ type: 'receive_inbox'; title: string; sponsorLane: SponsorLane }>
  | Readonly<{
    type: 'propose_task';
    baseRevision: number;
    title: string;
    requestedLane: SponsorLane;
    localRank: number;
    requirement: Requirement;
    dependencies?: readonly string[];
    preemptibility: Preemptibility;
    sourceInboxId?: string;
    parentTaskId?: string;
    supersedes?: string;
    reason: string;
  }>
  | Readonly<{ type: 'approve_revision'; revisionId: string }>
  | Readonly<{ type: 'reject_revision'; revisionId: string; reason: string }>
  | Readonly<{ type: 'schedule' }>
  | Readonly<{ type: 'checkpoint_preemption' }>
  | Readonly<{ type: 'accept_task'; taskId: string }>
  | Readonly<{ type: 'fail_task'; taskId: string; reason: string }>
  | Readonly<{ type: 'skip_task'; taskId: string; reason: string }>
  | Readonly<{ type: 'advance_clock'; seconds: number }>;

const LANE_ORDER: Readonly<Record<SponsorLane, number>> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const DEFAULT_POLICY: SchedulerPolicy = Object.freeze({
  version: 1,
  agingStepSeconds: 30,
  preemptionDeadlineSeconds: 15,
  starvationBoundByLane: Object.freeze({ urgent: 30, high: 60, normal: 120, low: 240 }),
});

const SETTLED_TASKS = new Set<ScheduledTaskStatus>([
  'accepted', 'failed', 'skipped', 'superseded',
]);

export function initialSchedulerJournal(capacity = 1): readonly SchedulerEvent[] {
  return [makeEvent(0, 'scheduler.created', { capacity, policy: DEFAULT_POLICY })];
}

export function replayScheduler(events: readonly SchedulerEvent[]): SchedulerState {
  if (events.length === 0 || events[0]?.type !== 'scheduler.created') {
    throw new Error('journal must begin with scheduler.created');
  }
  let state: SchedulerState = {
    sequence: 0,
    now: 0,
    capacity: Number(events[0].payload.capacity),
    policy: events[0].payload.policy as unknown as SchedulerPolicy,
    currentPlanRevision: 0,
    runStatus: 'active',
    inbox: {},
    revisions: {},
    tasks: {},
    dispatchedByLane: { urgent: 0, high: 0, normal: 0, low: 0 },
  };
  for (const entry of events) state = evolveScheduler(state, entry);
  return deriveRunStatus(state);
}

export function dispatchScheduler(
  journal: readonly SchedulerEvent[],
  command: SchedulerCommand,
): readonly SchedulerEvent[] {
  const state = replayScheduler(journal);
  const decided = decideScheduler(state, command);
  return Object.freeze([
    ...journal,
    ...decided.map((entry, index) => ({ ...entry, seq: journal.length + index })),
  ]);
}

export function schedulableTasks(state: SchedulerState): readonly ScheduledTask[] {
  return Object.values(state.tasks).filter((task) => task.status === 'ready' || task.status === 'paused');
}

function decideScheduler(
  state: SchedulerState,
  command: SchedulerCommand,
): readonly Omit<SchedulerEvent, 'seq'>[] {
  switch (command.type) {
    case 'receive_inbox': {
      const inboxId = `inbox-${Object.keys(state.inbox).length + 1}`;
      return [domainEvent('inbox.received', {
        inboxId,
        title: command.title,
        sponsorLane: command.sponsorLane,
        receivedAt: state.now,
      })];
    }
    case 'propose_task':
      return decidePlanProposal(state, command);
    case 'approve_revision': {
      const revision = requireRevision(state, command.revisionId);
      if (revision.status !== 'approval_required') {
        throw new Error(`revision ${revision.id} is ${revision.status}`);
      }
      if (revision.baseRevision !== state.currentPlanRevision) {
        throw new Error(`stale revision: base=${revision.baseRevision}, current=${state.currentPlanRevision}; rebase required`);
      }
      return [domainEvent('plan.revision_applied', revisionPayload(revision))];
    }
    case 'reject_revision': {
      const revision = requireRevision(state, command.revisionId);
      if (revision.status !== 'approval_required') {
        throw new Error(`revision ${revision.id} is ${revision.status}`);
      }
      return [domainEvent('plan.revision_rejected', {
        revisionId: revision.id,
        reason: command.reason,
      })];
    }
    case 'schedule':
      return decideSchedule(state);
    case 'checkpoint_preemption': {
      const reservation = state.preemption;
      if (!reservation) throw new Error('no preemption is pending');
      return [domainEvent('task.checkpointed', {
        taskId: reservation.victimTaskId,
        checkpointRef: `checkpoint://${reservation.victimTaskId}/${state.now}`,
      })];
    }
    case 'accept_task': {
      const task = requireTask(state, command.taskId);
      if (task.status !== 'running') throw new Error(`task ${task.id} is ${task.status}`);
      return [domainEvent('task.accepted', { taskId: task.id })];
    }
    case 'fail_task': {
      const task = requireTask(state, command.taskId);
      if (task.status !== 'running') throw new Error(`task ${task.id} is ${task.status}`);
      return [domainEvent('task.failed', { taskId: task.id, reason: command.reason })];
    }
    case 'skip_task': {
      const task = requireTask(state, command.taskId);
      if (task.requirement !== 'optional') throw new Error('required task cannot be skipped');
      if (!['waiting_dependency', 'ready', 'paused', 'failed'].includes(task.status)) {
        throw new Error(`optional task ${task.id} cannot be skipped from ${task.status}`);
      }
      return [domainEvent('task.skipped', { taskId: task.id, reason: command.reason })];
    }
    case 'advance_clock': {
      if (!Number.isFinite(command.seconds) || command.seconds <= 0) throw new Error('seconds must be positive');
      return [domainEvent('clock.advanced', { now: state.now + command.seconds })];
    }
  }
}

function decidePlanProposal(
  state: SchedulerState,
  command: Extract<SchedulerCommand, { type: 'propose_task' }>,
): readonly Omit<SchedulerEvent, 'seq'>[] {
  if (command.baseRevision !== state.currentPlanRevision) {
    throw new Error(`stale plan base: ${command.baseRevision}; current=${state.currentPlanRevision}`);
  }
  const source = command.sourceInboxId ? state.inbox[command.sourceInboxId] : undefined;
  const parent = command.parentTaskId ? state.tasks[command.parentTaskId] : undefined;
  if (command.sourceInboxId && !source) throw new Error(`unknown inbox item: ${command.sourceInboxId}`);
  if (command.parentTaskId && !parent) throw new Error(`unknown parent task: ${command.parentTaskId}`);
  if (!source && !parent) throw new Error('proposal must cite an inbox item or parent task');
  const dependencies = [...(command.dependencies ?? [])];
  for (const dependency of dependencies) requireTask(state, dependency);
  if (command.supersedes) {
    const superseded = requireTask(state, command.supersedes);
    if (!['waiting_dependency', 'ready', 'failed', 'paused', 'skipped'].includes(superseded.status)) {
      throw new Error(`cannot supersede active task ${superseded.id}; preempt/checkpoint first`);
    }
  }
  const authorizedLane = source?.sponsorLane ?? parent?.sponsorLane ?? 'normal';
  const revisionIndex = Object.keys(state.revisions).length + 1;
  const revisionId = `revision-${revisionIndex}`;
  const task: TaskSpec = {
    id: `task-${revisionIndex}`,
    title: command.title,
    sponsorLane: command.requestedLane,
    localRank: clampRank(command.localRank),
    requirement: command.requirement,
    dependencies,
    preemptibility: command.preemptibility,
    supersedes: command.supersedes,
  };
  const payload = {
    revisionId,
    baseRevision: state.currentPlanRevision,
    targetRevision: state.currentPlanRevision + 1,
    proposedBy: 'orchestrator',
    reason: command.reason,
    sourceInboxId: command.sourceInboxId,
    parentTaskId: command.parentTaskId,
    authorizedLane,
    task,
  };
  const events: Omit<SchedulerEvent, 'seq'>[] = [domainEvent('plan.revision_proposed', payload)];
  if (LANE_ORDER[command.requestedLane] < LANE_ORDER[authorizedLane]) {
    events.push(domainEvent('plan.revision_approval_required', {
      revisionId,
      reason: `priority escalation ${authorizedLane} -> ${command.requestedLane}`,
      owner: 'sponsor',
      deadline: state.now + 60,
      allowedActions: ['approve', 'reject', 'rebase', 'cancel_run'],
    }));
  } else {
    events.push(domainEvent('plan.revision_applied', payload));
  }
  return events;
}

function decideSchedule(state: SchedulerState): readonly Omit<SchedulerEvent, 'seq'>[] {
  const events: Omit<SchedulerEvent, 'seq'>[] = [];
  let projected = state;
  for (const revision of Object.values(projected.revisions)) {
    if (revision.status !== 'approval_required' || (revision.approval?.deadline ?? Infinity) > projected.now) continue;
    const rejected = domainEvent('plan.revision_rejected', {
      revisionId: revision.id,
      reason: 'approval deadline expired; default deny',
    });
    events.push(rejected);
    projected = evolvePrototypeEvent(projected, rejected);
  }
  for (const task of Object.values(projected.tasks)) {
    if (task.status !== 'waiting_dependency') continue;
    if (!task.dependencies.every((taskId) => projected.tasks[taskId]?.status === 'accepted')) continue;
    const ready = domainEvent('task.ready', { taskId: task.id, readySince: projected.now });
    events.push(ready);
    projected = evolvePrototypeEvent(projected, ready);
  }

  if (projected.preemption && projected.preemption.deadline <= projected.now) {
    const expired = domainEvent('task.preemption_timed_out', {
      taskId: projected.preemption.victimTaskId,
      reservedTaskId: projected.preemption.reservedTaskId,
      reason: 'executor missed checkpoint deadline; Kernel released lease with outcome_unknown',
    });
    events.push(expired);
    projected = evolvePrototypeEvent(projected, expired);
  }

  let freeSlots = projected.capacity - runningCount(projected);
  while (freeSlots > 0) {
    const candidate = chooseCandidate(projected);
    if (!candidate) break;
    const dispatched = domainEvent('task.dispatched', { taskId: candidate.id, lane: candidate.sponsorLane });
    events.push(dispatched);
    projected = evolvePrototypeEvent(projected, dispatched);
    freeSlots -= 1;
  }
  if (freeSlots > 0 || projected.preemption) return events;

  const incoming = chooseCandidate(projected);
  if (!incoming) return events;
  const incomingOverdue = isStarved(projected, incoming);
  const victims = Object.values(projected.tasks)
    .filter((task) => task.status === 'running' && task.preemptibility === 'checkpointable')
    .filter((task) => incomingOverdue || LANE_ORDER[incoming.sponsorLane] < LANE_ORDER[task.sponsorLane])
    .sort(compareVictims);
  const victim = victims[0];
  if (!victim) return events;
  events.push(domainEvent('task.preempt_requested', {
    taskId: victim.id,
    reservedTaskId: incoming.id,
    deadline: projected.now + projected.policy.preemptionDeadlineSeconds,
    reason: incomingOverdue ? 'starvation_bound' : 'higher_priority',
  }));
  return events;
}

function chooseCandidate(state: SchedulerState): ScheduledTask | undefined {
  const candidates = [...schedulableTasks(state)];
  const reserved = state.preemption?.reservedTaskId;
  if (reserved) {
    const task = candidates.find((item) => item.id === reserved);
    if (task) return task;
  }
  return candidates.sort((left, right) => compareCandidates(state, left, right))[0];
}

function compareCandidates(state: SchedulerState, left: ScheduledTask, right: ScheduledTask): number {
  const leftStarved = isStarved(state, left);
  const rightStarved = isStarved(state, right);
  if (leftStarved !== rightStarved) return leftStarved ? -1 : 1;
  if (leftStarved && rightStarved) {
    const leftBound = (left.readySince ?? state.now) + state.policy.starvationBoundByLane[left.sponsorLane];
    const rightBound = (right.readySince ?? state.now) + state.policy.starvationBoundByLane[right.sponsorLane];
    if (leftBound !== rightBound) return leftBound - rightBound;
  }
  const lane = LANE_ORDER[left.sponsorLane] - LANE_ORDER[right.sponsorLane];
  if (lane !== 0) return lane;
  const deadline = (left.deadline ?? Infinity) - (right.deadline ?? Infinity);
  if (deadline !== 0) return deadline;
  const rank = effectiveRank(state, right) - effectiveRank(state, left);
  if (rank !== 0) return rank;
  const seq = (left.enqueuedSeq ?? Infinity) - (right.enqueuedSeq ?? Infinity);
  if (seq !== 0) return seq;
  return left.id.localeCompare(right.id);
}

function compareVictims(left: ScheduledTask, right: ScheduledTask): number {
  const lane = LANE_ORDER[right.sponsorLane] - LANE_ORDER[left.sponsorLane];
  if (lane !== 0) return lane;
  if (left.localRank !== right.localRank) return left.localRank - right.localRank;
  return left.id.localeCompare(right.id);
}

function effectiveRank(state: SchedulerState, task: ScheduledTask): number {
  const waited = Math.max(0, state.now - (task.readySince ?? state.now));
  return task.localRank + Math.floor(waited / state.policy.agingStepSeconds);
}

function isStarved(state: SchedulerState, task: ScheduledTask): boolean {
  return state.now - (task.readySince ?? state.now) >= state.policy.starvationBoundByLane[task.sponsorLane];
}

function runningCount(state: SchedulerState): number {
  return Object.values(state.tasks).filter((task) => (
    task.status === 'running' || task.status === 'preempt_requested'
  )).length;
}

function evolveScheduler(state: SchedulerState, entry: SchedulerEvent): SchedulerState {
  const inbox = { ...state.inbox };
  const revisions = { ...state.revisions };
  const tasks = { ...state.tasks };
  let next: SchedulerState = { ...state, sequence: entry.seq, inbox, revisions, tasks };
  const payload = entry.payload;
  const taskId = String(payload.taskId ?? '');
  switch (entry.type) {
    case 'scheduler.created': break;
    case 'clock.advanced': next = { ...next, now: Number(payload.now) }; break;
    case 'inbox.received': {
      const inboxId = String(payload.inboxId);
      inbox[inboxId] = {
        id: inboxId,
        title: String(payload.title),
        sponsorLane: payload.sponsorLane as SponsorLane,
        status: 'pending_plan',
        receivedAt: Number(payload.receivedAt),
      };
      break;
    }
    case 'plan.revision_proposed': {
      const revision = payloadToRevision(payload, 'proposed');
      revisions[revision.id] = revision;
      break;
    }
    case 'plan.revision_approval_required': {
      const revisionId = String(payload.revisionId);
      revisions[revisionId] = {
        ...requireRevision(next, revisionId),
        status: 'approval_required',
        approval: {
          owner: 'sponsor',
          deadline: Number(payload.deadline),
          allowedActions: payload.allowedActions as readonly ['approve', 'reject', 'rebase', 'cancel_run'],
        },
      };
      break;
    }
    case 'plan.revision_rejected': {
      const revisionId = String(payload.revisionId);
      revisions[revisionId] = {
        ...requireRevision(next, revisionId),
        status: 'rejected',
        resolutionReason: String(payload.reason),
      };
      break;
    }
    case 'plan.revision_applied': {
      const revision = payloadToRevision(payload, 'applied');
      for (const candidate of Object.values(revisions)) {
        if (candidate.id === revision.id || ['applied', 'rejected', 'stale'].includes(candidate.status)) continue;
        if (candidate.baseRevision < revision.targetRevision) {
          revisions[candidate.id] = {
            ...candidate,
            status: 'stale',
            resolutionReason: `base v${candidate.baseRevision} was overtaken by v${revision.targetRevision}`,
          };
        }
      }
      revisions[revision.id] = revision;
      const spec = revision.task;
      if (spec.supersedes) {
        tasks[spec.supersedes] = {
          ...requireTask(next, spec.supersedes),
          status: 'superseded',
          terminalReason: `superseded by ${spec.id}`,
        };
      }
      const ready = spec.dependencies.length === 0;
      tasks[spec.id] = {
        ...spec,
        planRevision: revision.targetRevision,
        status: ready ? 'ready' : 'waiting_dependency',
        readySince: ready ? state.now : undefined,
        enqueuedSeq: ready ? entry.seq : undefined,
      };
      if (revision.sourceInboxId) {
        const item = inbox[revision.sourceInboxId];
        if (!item) throw new Error(`applied revision references missing inbox item: ${revision.sourceInboxId}`);
        inbox[revision.sourceInboxId] = { ...item, status: 'planned' };
      }
      next = { ...next, currentPlanRevision: revision.targetRevision };
      break;
    }
    case 'task.ready':
      tasks[taskId] = {
        ...requireTask(next, taskId),
        status: 'ready',
        readySince: Number(payload.readySince),
        enqueuedSeq: entry.seq,
      };
      break;
    case 'task.dispatched': {
      const task = requireTask(next, taskId);
      tasks[taskId] = { ...task, status: 'running' };
      next = {
        ...next,
        dispatchedByLane: {
          ...next.dispatchedByLane,
          [task.sponsorLane]: next.dispatchedByLane[task.sponsorLane] + 1,
        },
        preemption: next.preemption?.reservedTaskId === taskId ? undefined : next.preemption,
      };
      break;
    }
    case 'task.preempt_requested':
      tasks[taskId] = { ...requireTask(next, taskId), status: 'preempt_requested' };
      next = {
        ...next,
        preemption: {
          victimTaskId: taskId,
          reservedTaskId: String(payload.reservedTaskId),
          deadline: Number(payload.deadline),
          reason: payload.reason as PreemptionReservation['reason'],
        },
      };
      break;
    case 'task.preemption_timed_out':
      tasks[taskId] = {
        ...requireTask(next, taskId),
        status: 'paused',
        terminalReason: String(payload.reason),
      };
      break;
    case 'task.checkpointed':
      tasks[taskId] = {
        ...requireTask(next, taskId),
        status: 'paused',
        checkpointRef: String(payload.checkpointRef),
      };
      break;
    case 'task.accepted':
      tasks[taskId] = { ...requireTask(next, taskId), status: 'accepted' };
      break;
    case 'task.failed':
      tasks[taskId] = {
        ...requireTask(next, taskId),
        status: 'failed',
        terminalReason: String(payload.reason),
      };
      break;
    case 'task.skipped':
      tasks[taskId] = {
        ...requireTask(next, taskId),
        status: 'skipped',
        terminalReason: String(payload.reason),
      };
      break;
  }
  return deriveRunStatus(next);
}

function deriveRunStatus(state: SchedulerState): SchedulerState {
  const currentTasks = Object.values(state.tasks).filter((task) => task.status !== 'superseded');
  const pendingApproval = Object.values(state.revisions).some((revision) => revision.status === 'approval_required');
  let runStatus: SchedulerRunStatus = 'active';
  if (pendingApproval) runStatus = 'awaiting_approval';
  else if (currentTasks.some((task) => task.requirement === 'required' && (
    task.status === 'failed' || task.status === 'skipped'
  ))) runStatus = 'needs_replan';
  else if (currentTasks.length > 0
    && currentTasks.filter((task) => task.requirement === 'required').every((task) => task.status === 'accepted')
    && currentTasks.every((task) => SETTLED_TASKS.has(task.status))) runStatus = 'completed';
  return { ...state, runStatus };
}

function payloadToRevision(
  payload: Readonly<Record<string, unknown>>,
  status: PlanRevision['status'],
): PlanRevision {
  return {
    id: String(payload.revisionId),
    baseRevision: Number(payload.baseRevision),
    targetRevision: Number(payload.targetRevision),
    proposedBy: 'orchestrator',
    reason: String(payload.reason),
    status,
    sourceInboxId: optionalString(payload.sourceInboxId),
    parentTaskId: optionalString(payload.parentTaskId),
    authorizedLane: payload.authorizedLane as SponsorLane,
    task: payload.task as unknown as TaskSpec,
  };
}

function revisionPayload(revision: PlanRevision): Record<string, unknown> {
  return {
    revisionId: revision.id,
    baseRevision: revision.baseRevision,
    targetRevision: revision.targetRevision,
    proposedBy: revision.proposedBy,
    reason: revision.reason,
    sourceInboxId: revision.sourceInboxId,
    parentTaskId: revision.parentTaskId,
    authorizedLane: revision.authorizedLane,
    task: revision.task,
  };
}

function evolvePrototypeEvent(
  state: SchedulerState,
  entry: Omit<SchedulerEvent, 'seq'>,
): SchedulerState {
  return evolveScheduler(state, { ...entry, seq: state.sequence + 1 });
}

function requireTask(state: SchedulerState, taskId: string): ScheduledTask {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`unknown task: ${taskId}`);
  return task;
}

function requireRevision(state: SchedulerState, revisionId: string): PlanRevision {
  const revision = state.revisions[revisionId];
  if (!revision) throw new Error(`unknown revision: ${revisionId}`);
  return revision;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function clampRank(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(rank)));
}

function makeEvent(
  seq: number,
  type: SchedulerEvent['type'],
  payload: Record<string, unknown>,
): SchedulerEvent {
  return Object.freeze({ seq, type, payload: Object.freeze(payload) });
}

function domainEvent(
  type: SchedulerEvent['type'],
  payload: Record<string, unknown>,
): Omit<SchedulerEvent, 'seq'> {
  return { type, payload: Object.freeze(payload) };
}
