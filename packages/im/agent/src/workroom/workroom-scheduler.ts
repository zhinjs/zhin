import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import type { WorkroomEvent } from './kernel-contracts.js';

export type WorkroomSponsorLane = 'urgent' | 'high' | 'normal' | 'low';
export type WorkroomTaskPreemptibility = 'checkpointable' | 'atomic';

export interface WorkroomSchedulerPolicySnapshotInput {
  readonly policyRef: string;
  readonly revision: number;
  readonly pinnedAtSequence: number;
  readonly capacity: number;
  readonly agingStepMs: number;
  readonly starvationBoundMs: Readonly<Record<WorkroomSponsorLane, number>>;
  readonly preemptionDeadlineMs: number;
}

export interface WorkroomSchedulerPolicySnapshot
extends WorkroomSchedulerPolicySnapshotInput {
  readonly version: 1;
  readonly comparatorVersion: 1;
  readonly digest: string;
}

export interface WorkroomDispatchTaskDecision {
  readonly version: 1;
  readonly type: 'dispatch_task';
  readonly decisionId: string;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly role: string;
  readonly sponsorLane: WorkroomSponsorLane;
  readonly reason: 'scheduler_order' | 'starvation_bound' | 'preemption_reservation';
  readonly policy: Readonly<{
    ref: string;
    revision: number;
    digest: string;
  }>;
}

export interface WorkroomPreemptionPrepareDecision {
  readonly version: 1;
  readonly type: 'prepare_preemption';
  readonly decisionId: string;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly victimTaskKey: string;
  readonly victimTaskRevision: number;
  readonly reservedTaskKey: string;
  readonly reservedTaskRevision: number;
  readonly assignmentId: string;
  readonly assignmentAttempt: number;
  readonly assignmentFence: number;
  readonly assignmentEnvelopeDigest: string;
  readonly owner: string;
  readonly requestedAt: number;
  readonly deadline: number;
  readonly takeoverFence: number;
  readonly reason: 'higher_priority' | 'starvation_bound';
  readonly allowedSuccessors: readonly ['replan', 'cancel_run'];
  readonly policy: Readonly<{ ref: string; revision: number; digest: string }>;
}

export type WorkroomScheduleDecision = WorkroomDispatchTaskDecision | WorkroomPreemptionPrepareDecision;

export function parseWorkroomDispatchTaskDecision(value: unknown): WorkroomDispatchTaskDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom Scheduler dispatch decision shape is invalid');
  }
  const input = value as Partial<WorkroomDispatchTaskDecision>;
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [
    'decisionId', 'digest', 'expectedSequence', 'policy', 'projectId', 'reason',
    'role', 'runId', 'sponsorLane', 'taskKey', 'taskRevision', 'type', 'version',
  ].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Workroom Scheduler dispatch decision keys are invalid');
  }
  if (input.version !== 1 || input.type !== 'dispatch_task') {
    throw new Error('Workroom Scheduler dispatch decision version/type is invalid');
  }
  const body = deepFreeze({
    version: 1 as const,
    type: 'dispatch_task' as const,
    projectId: text(input.projectId, 'Scheduler decision projectId'),
    runId: text(input.runId, 'Scheduler decision runId'),
    expectedSequence: nonNegativeInteger(input.expectedSequence, 'Scheduler decision expectedSequence'),
    taskKey: text(input.taskKey, 'Scheduler decision taskKey'),
    taskRevision: positiveInteger(input.taskRevision, 'Scheduler decision taskRevision'),
    role: text(input.role, 'Scheduler decision role'),
    sponsorLane: lane(input.sponsorLane),
    reason: schedulerReason(input.reason),
    policy: {
      ref: text(input.policy?.ref, 'Scheduler decision policy ref'),
      revision: positiveInteger(input.policy?.revision, 'Scheduler decision policy revision'),
      digest: canonicalDigest(input.policy?.digest, 'Scheduler decision policy digest'),
    },
  });
  const digest = digestCanonicalWorkroomValue(body);
  const expectedId = `scheduler:${digest.slice('sha256:'.length)}`;
  if (input.digest !== digest || input.decisionId !== expectedId) {
    throw new Error('Workroom Scheduler dispatch decision digest/identity is invalid');
  }
  return deepFreeze({ ...body, digest, decisionId: expectedId });
}

export function parseWorkroomPreemptionPrepareDecision(value: unknown): WorkroomPreemptionPrepareDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom preemption prepare decision shape is invalid');
  }
  const input = value as Partial<WorkroomPreemptionPrepareDecision>;
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [
    'allowedSuccessors', 'assignmentAttempt', 'assignmentEnvelopeDigest', 'assignmentFence',
    'assignmentId', 'deadline', 'decisionId', 'digest', 'expectedSequence', 'owner', 'policy',
    'projectId', 'reason', 'requestedAt', 'reservedTaskKey', 'reservedTaskRevision', 'runId',
    'takeoverFence', 'type', 'version', 'victimTaskKey', 'victimTaskRevision',
  ].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Workroom preemption prepare decision keys are invalid');
  }
  const body = deepFreeze({
    version: 1 as const,
    type: 'prepare_preemption' as const,
    projectId: text(input.projectId, 'Preemption projectId'),
    runId: text(input.runId, 'Preemption runId'),
    expectedSequence: nonNegativeInteger(input.expectedSequence, 'Preemption expectedSequence'),
    victimTaskKey: text(input.victimTaskKey, 'Preemption victimTaskKey'),
    victimTaskRevision: positiveInteger(input.victimTaskRevision, 'Preemption victimTaskRevision'),
    reservedTaskKey: text(input.reservedTaskKey, 'Preemption reservedTaskKey'),
    reservedTaskRevision: positiveInteger(input.reservedTaskRevision, 'Preemption reservedTaskRevision'),
    assignmentId: text(input.assignmentId, 'Preemption assignmentId'),
    assignmentAttempt: positiveInteger(input.assignmentAttempt, 'Preemption assignmentAttempt'),
    assignmentFence: positiveInteger(input.assignmentFence, 'Preemption assignmentFence'),
    assignmentEnvelopeDigest: canonicalDigest(input.assignmentEnvelopeDigest, 'Preemption Envelope digest'),
    owner: text(input.owner, 'Preemption owner'),
    requestedAt: finiteTime(input.requestedAt, 'Preemption requestedAt'),
    deadline: finiteTime(input.deadline, 'Preemption deadline'),
    takeoverFence: positiveInteger(input.takeoverFence, 'Preemption takeoverFence'),
    reason: preemptionReason(input.reason),
    allowedSuccessors: ['replan', 'cancel_run'] as const,
    policy: {
      ref: text(input.policy?.ref, 'Preemption policy ref'),
      revision: positiveInteger(input.policy?.revision, 'Preemption policy revision'),
      digest: canonicalDigest(input.policy?.digest, 'Preemption policy digest'),
    },
  });
  if (body.deadline <= body.requestedAt || body.takeoverFence !== body.assignmentFence + 1
    || canonicalWorkroomJson(input.allowedSuccessors) !== canonicalWorkroomJson(body.allowedSuccessors)) {
    throw new Error('Workroom preemption deadline/fence/successors are invalid');
  }
  const digest = digestCanonicalWorkroomValue(body);
  const decisionId = `scheduler-preemption:${digest.slice('sha256:'.length)}`;
  if (input.digest !== digest || input.decisionId !== decisionId) {
    throw new Error('Workroom preemption prepare decision digest/identity is invalid');
  }
  return deepFreeze({ ...body, digest, decisionId });
}

export interface WorkroomPriorityChangeProposalInput {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly expectedSequence: number;
  readonly currentLane: WorkroomSponsorLane;
  readonly requestedLane: WorkroomSponsorLane;
  readonly localRank: number;
  readonly principalId: string;
  readonly authority: 'sponsor' | 'orchestrator';
  readonly authorityRef: string;
  readonly deadline: number;
}

export interface WorkroomPriorityChangeProposal
extends WorkroomPriorityChangeProposalInput {
  readonly version: 1;
  readonly type: 'priority_change';
  readonly owner: string;
  readonly allowedSuccessors: readonly ['restore', 'rebase', 'cancel_run'];
  readonly proposalId: string;
  readonly digest: string;
}

export interface WorkroomScheduledTaskSnapshot {
  readonly taskRevision: number;
  readonly sponsorLane: WorkroomSponsorLane;
  readonly localRank: number;
}

/** Content-free Kernel facts required to project one Portfolio Capacity Request. */
export interface WorkroomScheduledTaskCapacitySnapshot {
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly role: string;
  readonly preemptibility: WorkroomTaskPreemptibility;
  readonly status: ScheduledTaskProjection['status'];
}

interface ScheduledTaskProjection {
  readonly key: string;
  readonly revision: number;
  readonly role: string;
  readonly sponsorLane: WorkroomSponsorLane;
  readonly localRank: number;
  readonly deadline?: number;
  readonly enqueuedAt: number;
  readonly enqueueSequence: number;
  readonly dependsOn: readonly string[];
  readonly preemptibility: WorkroomTaskPreemptibility;
  readonly status: 'ready' | 'blocked' | 'executing' | 'awaiting_acceptance' | 'accepted' | 'failed' | 'cancelled';
  readonly blockers: ReadonlyMap<string, Readonly<{ owner: string; deadline: number; allowedSuccessors: readonly string[] }>>;
}

interface SchedulerProjection {
  readonly runId: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly now: number;
  readonly cancelRequested: boolean;
  readonly replanRequested: boolean;
  readonly policy: WorkroomSchedulerPolicySnapshot;
  readonly tasks: ReadonlyMap<string, ScheduledTaskProjection>;
  readonly activeAssignments: ReadonlyMap<string, Readonly<{
    taskKey: string; status: string; attempt: number; fence: number; envelopeDigest: string; owner: string;
  }>>;
  readonly pendingDispatches: ReadonlySet<string>;
  readonly reservedTaskKey?: string;
  readonly pendingPreemptionDecisionId?: string;
}

const LANE_ORDER: Readonly<Record<WorkroomSponsorLane, number>> = Object.freeze({
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
});

export function createWorkroomSchedulerPolicySnapshot(
  input: WorkroomSchedulerPolicySnapshotInput,
): WorkroomSchedulerPolicySnapshot {
  text(input.policyRef, 'Scheduler policyRef');
  positiveInteger(input.revision, 'Scheduler policy revision');
  nonNegativeInteger(input.pinnedAtSequence, 'Scheduler policy pinnedAtSequence');
  positiveInteger(input.capacity, 'Scheduler capacity');
  positiveInteger(input.agingStepMs, 'Scheduler agingStepMs');
  positiveInteger(input.preemptionDeadlineMs, 'Scheduler preemptionDeadlineMs');
  const starvationBoundMs = deepFreeze({
    urgent: positiveInteger(input.starvationBoundMs?.urgent, 'Scheduler urgent starvation bound'),
    high: positiveInteger(input.starvationBoundMs?.high, 'Scheduler high starvation bound'),
    normal: positiveInteger(input.starvationBoundMs?.normal, 'Scheduler normal starvation bound'),
    low: positiveInteger(input.starvationBoundMs?.low, 'Scheduler low starvation bound'),
  });
  const body = deepFreeze({
    version: 1 as const,
    comparatorVersion: 1 as const,
    policyRef: input.policyRef,
    revision: input.revision,
    pinnedAtSequence: input.pinnedAtSequence,
    capacity: input.capacity,
    agingStepMs: input.agingStepMs,
    starvationBoundMs,
    preemptionDeadlineMs: input.preemptionDeadlineMs,
  });
  return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
}

export function assertWorkroomSchedulerPolicySnapshot(
  value: WorkroomSchedulerPolicySnapshot,
  pinnedAtSequence?: number,
): void {
  if (!value || value.version !== 1 || value.comparatorVersion !== 1) {
    throw new Error('Workroom Scheduler Policy Snapshot shape is invalid');
  }
  const rebuilt = createWorkroomSchedulerPolicySnapshot(value);
  if (rebuilt.digest !== value.digest) {
    throw new Error('Workroom Scheduler Policy Snapshot digest does not match its canonical body');
  }
  if (pinnedAtSequence !== undefined && value.pinnedAtSequence !== pinnedAtSequence) {
    throw new Error('Workroom Scheduler Policy Snapshot is pinned at another Journal sequence');
  }
}

/** Pure `Journal facts + pinned policy -> one typed decision` boundary. */
export function decideWorkroomSchedule(
  events: readonly WorkroomEvent[],
): WorkroomScheduleDecision | null {
  const state = projectScheduler(events);
  if (state.cancelRequested || state.replanRequested) return null;
  assertWaitRecoveryMetadata(state.tasks);
  const used = state.activeAssignments.size + state.pendingDispatches.size;
  const candidates = [...state.tasks.values()].filter(task =>
    task.status === 'ready'
    && !state.pendingDispatches.has(task.key)
    && task.dependsOn.every(key => state.tasks.get(key)?.status === 'accepted'));
  const selected = candidates.sort((left, right) => compareTasks(state, left, right))[0];
  if (!selected) return null;
  if (used >= state.policy.capacity) {
    if (state.pendingPreemptionDecisionId) return null;
    const incomingStarved = isStarved(state, selected);
    const victims = [...state.activeAssignments.entries()].flatMap(([assignmentId, assignment]) => {
      const task = state.tasks.get(assignment.taskKey);
      if (!task || assignment.status !== 'running' || task.preemptibility !== 'checkpointable') return [];
      if (!incomingStarved && LANE_ORDER[selected.sponsorLane] >= LANE_ORDER[task.sponsorLane]) return [];
      return [{ assignmentId, assignment, task }];
    }).sort((left, right) => {
      const laneOrder = LANE_ORDER[right.task.sponsorLane] - LANE_ORDER[left.task.sponsorLane];
      if (laneOrder !== 0) return laneOrder;
      return compareCanonicalWorkroomText(left.task.key, right.task.key);
    });
    const victim = victims[0];
    if (!victim) return null;
    const body = deepFreeze({
      version: 1 as const,
      type: 'prepare_preemption' as const,
      projectId: state.projectId,
      runId: state.runId,
      expectedSequence: state.sequence,
      victimTaskKey: victim.task.key,
      victimTaskRevision: victim.task.revision,
      reservedTaskKey: selected.key,
      reservedTaskRevision: selected.revision,
      assignmentId: victim.assignmentId,
      assignmentAttempt: victim.assignment.attempt,
      assignmentFence: victim.assignment.fence,
      assignmentEnvelopeDigest: victim.assignment.envelopeDigest,
      owner: victim.assignment.owner,
      requestedAt: state.now,
      deadline: state.now + state.policy.preemptionDeadlineMs,
      takeoverFence: victim.assignment.fence + 1,
      reason: incomingStarved ? 'starvation_bound' as const : 'higher_priority' as const,
      allowedSuccessors: ['replan', 'cancel_run'] as const,
      policy: {
        ref: state.policy.policyRef,
        revision: state.policy.revision,
        digest: state.policy.digest,
      },
    });
    const digest = digestCanonicalWorkroomValue(body);
    return deepFreeze({
      ...body,
      decisionId: `scheduler-preemption:${digest.slice('sha256:'.length)}`,
      digest,
    });
  }
  const reason = state.reservedTaskKey === selected.key
    ? 'preemption_reservation' as const
    : isStarved(state, selected) ? 'starvation_bound' as const : 'scheduler_order' as const;
  const body = deepFreeze({
    version: 1 as const,
    type: 'dispatch_task' as const,
    projectId: state.projectId,
    runId: state.runId,
    expectedSequence: state.sequence,
    taskKey: selected.key,
    taskRevision: selected.revision,
    role: selected.role,
    sponsorLane: selected.sponsorLane,
    reason,
    policy: {
      ref: state.policy.policyRef,
      revision: state.policy.revision,
      digest: state.policy.digest,
    },
  });
  const digest = digestCanonicalWorkroomValue(body);
  return deepFreeze({
    ...body,
    decisionId: `scheduler:${digest.slice('sha256:'.length)}`,
    digest,
  });
}

/**
 * Creates a typed proposal only. The Sponsor/Orchestrator principal and
 * authorityRef must be injected by a trusted role-scoped command port before
 * a Kernel CAS adapter may persist it.
 */
export function proposeWorkroomPriorityChange(
  input: WorkroomPriorityChangeProposalInput,
): WorkroomPriorityChangeProposal {
  for (const [value, label] of [
    [input.projectId, 'projectId'], [input.runId, 'runId'], [input.taskKey, 'taskKey'],
    [input.principalId, 'principalId'], [input.authorityRef, 'authorityRef'],
  ] as const) text(value, `Priority change ${label}`);
  positiveInteger(input.taskRevision, 'Priority change taskRevision');
  nonNegativeInteger(input.expectedSequence, 'Priority change expectedSequence');
  nonNegativeInteger(input.localRank, 'Priority change localRank');
  finiteTime(input.deadline, 'Priority change deadline');
  lane(input.currentLane);
  lane(input.requestedLane);
  if (input.authority === 'orchestrator' && input.requestedLane !== input.currentLane) {
    throw new Error('Orchestrator cannot move a Task across Sponsor lanes');
  }
  const body = deepFreeze({
    version: 1 as const,
    type: 'priority_change' as const,
    ...structuredClone(input),
    owner: input.principalId,
    allowedSuccessors: ['restore', 'rebase', 'cancel_run'] as const,
  });
  const digest = digestCanonicalWorkroomValue(body);
  return deepFreeze({
    ...body,
    proposalId: `scheduler-priority:${digest.slice('sha256:'.length)}`,
    digest,
  });
}

export function parseWorkroomPriorityChangeProposal(value: unknown): WorkroomPriorityChangeProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom priority change proposal shape is invalid');
  }
  const input = value as WorkroomPriorityChangeProposal;
  const rebuilt = proposeWorkroomPriorityChange({
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.taskKey,
    taskRevision: input.taskRevision,
    expectedSequence: input.expectedSequence,
    currentLane: input.currentLane,
    requestedLane: input.requestedLane,
    localRank: input.localRank,
    principalId: input.principalId,
    authority: input.authority,
    authorityRef: input.authorityRef,
    deadline: input.deadline,
  });
  if (canonicalWorkroomJson(rebuilt) !== canonicalWorkroomJson(input)) {
    throw new Error('Workroom priority change proposal is not canonical');
  }
  return rebuilt;
}

export function getWorkroomScheduledTaskSnapshot(
  events: readonly WorkroomEvent[],
  taskKey: string,
): WorkroomScheduledTaskSnapshot {
  const task = projectScheduler(events).tasks.get(text(taskKey, 'Scheduled Task key'));
  if (!task) throw new Error(`Scheduled Task ${taskKey} not found`);
  return deepFreeze({
    taskRevision: task.revision,
    sponsorLane: task.sponsorLane,
    localRank: task.localRank,
  });
}

export function getWorkroomScheduledTaskCapacitySnapshot(
  events: readonly WorkroomEvent[],
  taskKey: string,
): WorkroomScheduledTaskCapacitySnapshot {
  const task = projectScheduler(events).tasks.get(text(taskKey, 'Scheduled Task key'));
  if (!task) throw new Error(`Scheduled Task ${taskKey} not found`);
  return deepFreeze({
    taskKey: task.key,
    taskRevision: task.revision,
    role: task.role,
    preemptibility: task.preemptibility,
    status: task.status,
  });
}

function projectScheduler(events: readonly WorkroomEvent[]): SchedulerProjection {
  const created = events[0];
  if (!created || created.sequence !== 0 || created.type !== 'run.created') {
    throw new Error('Workroom Scheduler requires a Run Journal beginning at sequence 0');
  }
  const tasks = new Map<string, ScheduledTaskProjection>();
  const activeAssignments = new Map<string, {
    taskKey: string; status: string; attempt: number; fence: number; envelopeDigest: string; owner: string;
  }>();
  const pendingDispatches = new Set<string>();
  let policy: WorkroomSchedulerPolicySnapshot | undefined;
  let now = created.occurredAt;
  let cancelRequested = false;
  let replanRequested = false;
  let reservedTaskKey: string | undefined;
  let pendingPreemptionDecisionId: string | undefined;
  for (const [index, event] of events.entries()) {
    if (event.runId !== created.runId || event.sequence !== index) {
      throw new Error('Workroom Scheduler Journal scope/sequence is not contiguous');
    }
    now = event.type === 'clock.advanced'
      ? finiteTime(event.payload.now, 'Scheduler clock')
      : Math.max(now, finiteTime(event.occurredAt, 'Scheduler event time'));
    switch (event.type as string) {
      case 'plan.admitted': {
        if (policy) throw new Error('Workroom Scheduler Policy Snapshot is duplicated');
        const plan = event.payload.plan && typeof event.payload.plan === 'object'
          ? event.payload.plan as Readonly<Record<string, unknown>>
          : undefined;
        const candidate = (event.payload.schedulerPolicy ?? plan?.schedulerPolicy) as WorkroomSchedulerPolicySnapshot | undefined;
        if (!candidate) throw new Error('Workroom Scheduler Policy Snapshot is not pinned');
        assertWorkroomSchedulerPolicySnapshot(candidate, event.sequence);
        policy = candidate;
        break;
      }
      case 'run.cancel_requested':
      case 'run.cancelled': cancelRequested = true; break;
      case 'run.replan_requested': replanRequested = true; break;
      case 'plan.revision_applied': replanRequested = false; break;
      case 'task.planned': {
        const key = text(event.payload.taskKey, 'Scheduled Task key');
        if (tasks.has(key)) throw new Error(`Scheduled Task ${key} is duplicated`);
        tasks.set(key, Object.freeze({
          key,
          revision: 1,
          role: text(event.payload.role, `Scheduled Task ${key} role`),
          sponsorLane: lane(event.payload.sponsorLane),
          localRank: nonNegativeInteger(event.payload.localRank, `Scheduled Task ${key} localRank`),
          ...(event.payload.deadline === undefined
            ? {}
            : { deadline: finiteTime(event.payload.deadline, `Scheduled Task ${key} deadline`) }),
          enqueuedAt: finiteTime(event.payload.enqueuedAt, `Scheduled Task ${key} enqueuedAt`),
          enqueueSequence: event.sequence,
          dependsOn: stringList(event.payload.dependsOn, `Scheduled Task ${key} dependsOn`),
          preemptibility: preemptibility(event.payload.preemptibility),
          status: 'ready',
          blockers: new Map(),
        }));
        break;
      }
      case 'task.blocked': {
        const task = requireTask(tasks, event.payload.taskKey);
        const blockers = new Map(task.blockers);
        blockers.set(text(event.payload.blockerId, 'Task Blocker id'), Object.freeze({
          owner: typeof event.payload.owner === 'string' ? event.payload.owner : '',
          deadline: typeof event.payload.deadline === 'number' ? event.payload.deadline : Number.NaN,
          allowedSuccessors: Array.isArray(event.payload.allowedActions)
            ? event.payload.allowedActions.map(String)
            : ['resolve', 'replan', 'cancel'],
        }));
        tasks.set(task.key, Object.freeze({ ...task, status: 'blocked', blockers }));
        break;
      }
      case 'task.blocker_resolved': {
        const task = requireTask(tasks, event.payload.taskKey);
        const blockers = new Map(task.blockers);
        blockers.delete(String(event.payload.blockerId));
        tasks.set(task.key, Object.freeze({
          ...task,
          status: blockers.size === 0 ? 'ready' : 'blocked',
          enqueuedAt: blockers.size === 0 ? event.occurredAt : task.enqueuedAt,
          enqueueSequence: blockers.size === 0 ? event.sequence : task.enqueueSequence,
          blockers,
        }));
        break;
      }
      case 'assignment.claimed': {
        const assignmentId = text(event.payload.assignmentId, 'Assignment id');
        const task = requireTask(tasks, event.payload.taskKey);
        activeAssignments.set(assignmentId, {
          taskKey: task.key,
          status: 'leased',
          attempt: positiveInteger(event.payload.attempt, 'Assignment attempt'),
          fence: positiveInteger(event.payload.fence, 'Assignment fence'),
          envelopeDigest: canonicalDigest(event.payload.envelopeDigest, 'Assignment Envelope digest'),
          owner: text(event.payload.owner, 'Assignment owner'),
        });
        pendingDispatches.delete(task.key);
        tasks.set(task.key, Object.freeze({ ...task, status: 'executing' }));
        break;
      }
      case 'assignment.started': {
        const assignment = activeAssignments.get(String(event.payload.assignmentId));
        if (assignment) activeAssignments.set(String(event.payload.assignmentId), { ...assignment, status: 'running' });
        break;
      }
      case 'assignment.execution_completed': {
        const assignment = activeAssignments.get(String(event.payload.assignmentId));
        if (assignment) {
          activeAssignments.delete(String(event.payload.assignmentId));
          const task = requireTask(tasks, assignment.taskKey);
          tasks.set(task.key, Object.freeze({ ...task, status: 'awaiting_acceptance' }));
        }
        break;
      }
      case 'assignment.cancelled':
      case 'assignment.preempted':
      case 'assignment.lease_expired': {
        const assignment = activeAssignments.get(String(event.payload.assignmentId));
        if (assignment) {
          activeAssignments.delete(String(event.payload.assignmentId));
          const task = requireTask(tasks, assignment.taskKey);
          tasks.set(task.key, Object.freeze({
            ...task, status: 'ready', enqueuedAt: event.occurredAt, enqueueSequence: event.sequence,
          }));
        }
        break;
      }
      case 'task.accepted': setTaskStatus(tasks, event.payload.taskKey, 'accepted'); break;
      case 'task.failed': setTaskStatus(tasks, event.payload.taskKey, 'failed'); break;
      case 'task.cancelled': setTaskStatus(tasks, event.payload.taskKey, 'cancelled'); break;
      case 'task.rework_requested':
      case 'task.revised': {
        const task = requireTask(tasks, event.payload.taskKey);
        tasks.set(task.key, Object.freeze({
          ...task,
          revision: task.revision + 1,
          status: 'ready',
          enqueuedAt: event.occurredAt,
          enqueueSequence: event.sequence,
        }));
        break;
      }
      case 'task.plan_revised': {
        const task = requireTask(tasks, event.payload.taskKey);
        if (Number(event.payload.expectedTaskRevision) !== task.revision
          || Number(event.payload.newTaskRevision) !== task.revision + 1) {
          throw new Error('Persisted Plan Revision targets another Task revision');
        }
        tasks.set(task.key, Object.freeze({
          ...task,
          revision: task.revision + 1,
          role: text(event.payload.role, `Scheduled Task ${task.key} role`),
          sponsorLane: lane(event.payload.sponsorLane),
          localRank: nonNegativeInteger(event.payload.localRank, `Scheduled Task ${task.key} localRank`),
          deadline: finiteTime(event.payload.deadline, `Scheduled Task ${task.key} deadline`),
          enqueuedAt: finiteTime(event.payload.enqueuedAt, `Scheduled Task ${task.key} enqueuedAt`),
          enqueueSequence: event.sequence,
          dependsOn: stringList(event.payload.dependsOn, `Scheduled Task ${task.key} dependsOn`),
          preemptibility: preemptibility(event.payload.preemptibility),
          status: 'ready',
          blockers: new Map(),
        }));
        break;
      }
      case 'scheduler.priority_changed': {
        const task = requireTask(tasks, event.payload.taskKey);
        if (Number(event.payload.taskRevision) !== task.revision) {
          throw new Error('Persisted Workroom priority change targets another Task revision');
        }
        tasks.set(task.key, Object.freeze({
          ...task,
          sponsorLane: lane(event.payload.requestedLane),
          localRank: nonNegativeInteger(event.payload.localRank, 'Persisted priority localRank'),
        }));
        break;
      }
      case 'scheduler.dispatch_requested':
        pendingDispatches.add(text(event.payload.taskKey, 'Scheduler dispatch Task key'));
        break;
      case 'scheduler.preemption_requested':
        reservedTaskKey = text(event.payload.reservedTaskKey, 'Scheduler reserved Task key');
        pendingPreemptionDecisionId = text(event.payload.decisionId, 'Scheduler preemption decision id');
        break;
      case 'scheduler.preemption_checkpoint_acknowledged':
        if (event.payload.decisionId === pendingPreemptionDecisionId) {
          pendingPreemptionDecisionId = undefined;
        }
        break;
      case 'scheduler.preemption_timed_out':
        if (event.payload.decisionId === pendingPreemptionDecisionId) {
          pendingPreemptionDecisionId = undefined;
          reservedTaskKey = undefined;
        }
        break;
    }
  }
  if (!policy) throw new Error('Workroom Scheduler Policy Snapshot is not pinned');
  return Object.freeze({
    runId: created.runId,
    projectId: text(created.payload.projectId, 'Workroom Project id'),
    sequence: events.at(-1)!.sequence,
    now,
    cancelRequested,
    replanRequested,
    policy,
    tasks,
    activeAssignments,
    pendingDispatches,
    ...(reservedTaskKey === undefined ? {} : { reservedTaskKey }),
    ...(pendingPreemptionDecisionId === undefined ? {} : { pendingPreemptionDecisionId }),
  });
}

function compareTasks(
  state: SchedulerProjection,
  left: ScheduledTaskProjection,
  right: ScheduledTaskProjection,
): number {
  const leftReserved = left.key === state.reservedTaskKey;
  const rightReserved = right.key === state.reservedTaskKey;
  if (leftReserved !== rightReserved) return leftReserved ? -1 : 1;
  const leftStarved = isStarved(state, left);
  const rightStarved = isStarved(state, right);
  if (leftStarved !== rightStarved) return leftStarved ? -1 : 1;
  if (leftStarved && rightStarved) {
    const leftAt = left.enqueuedAt + state.policy.starvationBoundMs[left.sponsorLane];
    const rightAt = right.enqueuedAt + state.policy.starvationBoundMs[right.sponsorLane];
    if (leftAt !== rightAt) return leftAt - rightAt;
  }
  const laneOrder = LANE_ORDER[left.sponsorLane] - LANE_ORDER[right.sponsorLane];
  if (laneOrder !== 0) return laneOrder;
  const leftDeadline = left.deadline ?? Number.POSITIVE_INFINITY;
  const rightDeadline = right.deadline ?? Number.POSITIVE_INFINITY;
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  const rank = effectiveRank(state, right) - effectiveRank(state, left);
  if (rank !== 0) return rank;
  if (left.enqueueSequence !== right.enqueueSequence) {
    return left.enqueueSequence - right.enqueueSequence;
  }
  return compareCanonicalWorkroomText(left.key, right.key);
}

function effectiveRank(state: SchedulerProjection, task: ScheduledTaskProjection): number {
  return task.localRank + Math.floor(Math.max(0, state.now - task.enqueuedAt) / state.policy.agingStepMs);
}

function isStarved(state: SchedulerProjection, task: ScheduledTaskProjection): boolean {
  return state.now - task.enqueuedAt >= state.policy.starvationBoundMs[task.sponsorLane];
}

function assertWaitRecoveryMetadata(tasks: ReadonlyMap<string, ScheduledTaskProjection>): void {
  for (const task of tasks.values()) {
    for (const blocker of task.blockers.values()) {
      if (!blocker.owner.trim() || !Number.isFinite(blocker.deadline) || blocker.deadline < 0
        || blocker.allowedSuccessors.length === 0
        || !blocker.allowedSuccessors.includes('cancel')) {
        throw new Error('Workroom wait requires owner, deadline and allowed successors including cancel');
      }
    }
  }
}

function setTaskStatus(
  tasks: Map<string, ScheduledTaskProjection>,
  key: unknown,
  status: ScheduledTaskProjection['status'],
): void {
  const task = requireTask(tasks, key);
  tasks.set(task.key, Object.freeze({ ...task, status }));
}

function requireTask(
  tasks: ReadonlyMap<string, ScheduledTaskProjection>,
  key: unknown,
): ScheduledTaskProjection {
  const id = text(key, 'Scheduled Task key');
  const task = tasks.get(id);
  if (!task) throw new Error(`Scheduled Task ${id} is absent from the admitted Plan`);
  return task;
}

function lane(value: unknown): WorkroomSponsorLane {
  if (!['urgent', 'high', 'normal', 'low'].includes(String(value))) {
    throw new Error('Workroom Sponsor lane is invalid');
  }
  return value as WorkroomSponsorLane;
}

function preemptibility(value: unknown): WorkroomTaskPreemptibility {
  if (value !== 'checkpointable' && value !== 'atomic') {
    throw new Error('Workroom Task preemptibility is invalid');
  }
  return value;
}

function schedulerReason(value: unknown): WorkroomDispatchTaskDecision['reason'] {
  if (!['scheduler_order', 'starvation_bound', 'preemption_reservation'].includes(String(value))) {
    throw new Error('Workroom Scheduler dispatch reason is invalid');
  }
  return value as WorkroomDispatchTaskDecision['reason'];
}

function preemptionReason(value: unknown): WorkroomPreemptionPrepareDecision['reason'] {
  if (value !== 'higher_priority' && value !== 'starvation_bound') {
    throw new Error('Workroom preemption reason is invalid');
  }
  return value;
}

function canonicalDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be a string list`);
  }
  return Object.freeze([...new Set(value)].sort());
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return Number(value);
}

function finiteTime(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite timestamp`);
  }
  return value;
}
