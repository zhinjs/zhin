import type { WorkroomEvent, WorkroomEventDraft } from './kernel-contracts.js';
import type { WorkroomJournal } from './journal.js';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import {
  parseWorkroomPreemptionPrepareDecision,
  type WorkroomPreemptionPrepareDecision,
} from './workroom-scheduler.js';

export type WorkroomPreemptionStatus =
  | 'prepared'
  | 'checkpoint_requested'
  | 'checkpoint_acknowledged'
  | 'takeover_ready'
  | 'timed_out';

export interface WorkroomPreemptionState extends WorkroomPreemptionPrepareDecision {
  readonly status: WorkroomPreemptionStatus;
  readonly checkpoint?: Readonly<{ ref: string; digest: string }>;
  readonly observationId?: string;
  readonly observationDigest?: string;
  readonly acknowledgedAt?: number;
  readonly timeoutBlockerId?: string;
}

export interface WorkroomPreemptionProjection {
  readonly byDecisionId: Readonly<Record<string, WorkroomPreemptionState>>;
  readonly pending?: WorkroomPreemptionState;
}

export interface WorkroomPreemptionCheckpointAck {
  readonly version: 1;
  readonly decisionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly victimTaskKey: string;
  readonly reservedTaskKey: string;
  readonly assignmentId: string;
  readonly assignmentAttempt: number;
  readonly assignmentFence: number;
  readonly takeoverFence: number;
  readonly envelopeDigest: string;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly checkpoint: Readonly<{ ref: string; digest: string }>;
  readonly producer: Readonly<{ principalId: string; authorityRef: string; authorityDigest: string }>;
  readonly acknowledgedAt: number;
  readonly digest: string;
}

export interface WorkroomCheckpointRequestDeliveryPort {
  /** Must be idempotent by decisionId; success never implies checkpoint acknowledgement. */
  request(preemption: WorkroomPreemptionState, signal: AbortSignal): Promise<void>;
}

export interface WorkroomPreemptionCheckpointApplicationOptions {
  readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>;
  readonly delivery: WorkroomCheckpointRequestDeliveryPort;
}

/** Journal-backed at-least-once checkpoint request consumer; only Assignment observations can ack. */
export class WorkroomPreemptionCheckpointApplication {
  constructor(readonly options: WorkroomPreemptionCheckpointApplicationOptions) {}

  async recover(signal: AbortSignal): Promise<number> {
    let delivered = 0;
    for (const runId of [...await this.options.journal.listRunIds()].sort()) {
      signal.throwIfAborted();
      const pending = replayWorkroomPreemptions(await this.options.journal.read(runId)).pending;
      if (!pending) continue;
      await this.options.delivery.request(pending, signal);
      delivered += 1;
    }
    return delivered;
  }
}

/** The Journal is the only preemption state; this projection is restart-safe and I/O-free. */
export function replayWorkroomPreemptions(events: readonly WorkroomEvent[]): WorkroomPreemptionProjection {
  const byDecisionId: Record<string, WorkroomPreemptionState> = {};
  const checkpoints = new Map<string, Readonly<{
    observationId: string; observationDigest: string; envelopeDigest: string;
    checkpointRef: string; checkpointDigest: string;
  }>>();
  let pending: WorkroomPreemptionState | undefined;
  let prepared: WorkroomPreemptionState | undefined;
  for (const event of events) {
    if (event.type === 'assignment.checkpointed') {
      checkpoints.set(required(event.payload.assignmentId, 'checkpoint assignmentId'), {
        observationId: required(event.payload.observationId, 'checkpoint observationId'),
        observationDigest: requiredDigest(event.payload.observationDigest, 'checkpoint observationDigest'),
        envelopeDigest: requiredDigest(event.payload.envelopeDigest, 'checkpoint Envelope digest'),
        checkpointRef: required(event.payload.checkpointRef, 'checkpoint ref'),
        checkpointDigest: requiredDigest(event.payload.checkpointDigest, 'checkpoint digest'),
      });
      continue;
    }
    if (event.type === 'scheduler.preemption_requested') {
      const decision = parseWorkroomPreemptionPrepareDecision(event.payload);
      if (byDecisionId[decision.decisionId] || pending || prepared) {
        throw new Error('Workroom preemption prepare overlaps an existing request');
      }
      const state = deepFreeze({ ...decision, status: 'prepared' as const });
      byDecisionId[decision.decisionId] = state;
      prepared = state;
      continue;
    }
    if (event.type === 'assignment.checkpoint_requested') {
      const decisionId = required(event.payload.decisionId, 'checkpoint request decisionId');
      const state = byDecisionId[decisionId];
      if (!state || state.status !== 'prepared' || prepared?.decisionId !== decisionId
        || event.payload.assignmentId !== state.assignmentId
        || event.payload.envelopeDigest !== state.assignmentEnvelopeDigest
        || event.payload.deadline !== state.deadline
        || event.payload.takeoverFence !== state.takeoverFence) {
        throw new Error('Workroom checkpoint request is not bound to its preemption prepare');
      }
      const requested = deepFreeze({ ...state, status: 'checkpoint_requested' as const });
      byDecisionId[decisionId] = requested;
      pending = requested;
      prepared = undefined;
      continue;
    }
    if (event.type === 'scheduler.preemption_checkpoint_acknowledged') {
      const decisionId = required(event.payload.decisionId, 'checkpoint ack decisionId');
      const state = byDecisionId[decisionId];
      const checkpoint = checkpoints.get(String(event.payload.assignmentId));
      if (!state || state.status !== 'checkpoint_requested'
        || event.payload.assignmentId !== state.assignmentId
        || event.payload.envelopeDigest !== state.assignmentEnvelopeDigest
        || event.payload.assignmentAttempt !== state.assignmentAttempt
        || event.payload.assignmentFence !== state.assignmentFence
        || event.payload.takeoverFence !== state.takeoverFence
        || !checkpoint
        || checkpoint.envelopeDigest !== state.assignmentEnvelopeDigest
        || checkpoint.observationId !== event.payload.observationId
        || checkpoint.observationDigest !== event.payload.observationDigest
        || checkpoint.checkpointRef !== event.payload.checkpointRef
        || checkpoint.checkpointDigest !== event.payload.checkpointDigest) {
        throw new Error('Workroom checkpoint acknowledgement is stale');
      }
      const acknowledged = deepFreeze({
        ...state,
        status: 'checkpoint_acknowledged' as const,
        checkpoint: {
          ref: required(event.payload.checkpointRef, 'checkpoint ref'),
          digest: requiredDigest(event.payload.checkpointDigest, 'checkpoint digest'),
        },
        observationId: required(event.payload.observationId, 'checkpoint observationId'),
        observationDigest: requiredDigest(event.payload.observationDigest, 'checkpoint observationDigest'),
        acknowledgedAt: nonNegative(event.occurredAt, 'checkpoint acknowledgedAt'),
      });
      byDecisionId[decisionId] = acknowledged;
      pending = undefined;
      checkpoints.delete(state.assignmentId);
      continue;
    }
    if (event.type === 'assignment.preempted') {
      const decisionId = required(event.payload.decisionId, 'Assignment preempted decisionId');
      const state = byDecisionId[decisionId];
      if (!state || state.status !== 'checkpoint_acknowledged'
        || event.payload.assignmentId !== state.assignmentId
        || event.payload.checkpointRef !== state.checkpoint?.ref
        || event.payload.checkpointDigest !== state.checkpoint?.digest
        || event.payload.outcome !== 'interrupted') {
        throw new Error('Workroom Assignment preemption is not bound to an authenticated checkpoint');
      }
      byDecisionId[decisionId] = deepFreeze({ ...state, status: 'takeover_ready' as const });
      continue;
    }
    if (event.type === 'scheduler.preemption_timed_out') {
      const decisionId = required(event.payload.decisionId, 'preemption timeout decisionId');
      const state = byDecisionId[decisionId];
      if (!state || state.status !== 'checkpoint_requested'
        || event.payload.assignmentId !== state.assignmentId
        || event.payload.reservedTaskKey !== state.reservedTaskKey) {
        throw new Error('Workroom preemption timeout is stale');
      }
      const timedOut = deepFreeze({
        ...state,
        status: 'timed_out' as const,
        timeoutBlockerId: required(event.payload.blockerId, 'preemption timeout blockerId'),
      });
      byDecisionId[decisionId] = timedOut;
      pending = undefined;
    }
  }
  if (prepared) throw new Error('Workroom preemption prepare has no checkpoint request');
  if (Object.values(byDecisionId).some(state => state.status === 'checkpoint_acknowledged')) {
    throw new Error('Workroom preemption checkpoint acknowledgement has no atomic takeover release');
  }
  return deepFreeze({
    byDecisionId,
    ...(pending ? { pending } : {}),
  });
}

/** Exact authenticated fact P11 may consume; it cannot create or mutate this acknowledgement. */
export function readWorkroomPreemptionCheckpointAck(
  events: readonly WorkroomEvent[],
  decisionId: string,
): WorkroomPreemptionCheckpointAck | undefined {
  const state = replayWorkroomPreemptions(events).byDecisionId[required(decisionId, 'decisionId')];
  if (!state || state.status !== 'takeover_ready' || !state.checkpoint
    || !state.observationId || !state.observationDigest || state.acknowledgedAt === undefined) return undefined;
  const body = deepFreeze({
    version: 1 as const,
    decisionId: state.decisionId,
    projectId: state.projectId,
    runId: state.runId,
    victimTaskKey: state.victimTaskKey,
    reservedTaskKey: state.reservedTaskKey,
    assignmentId: state.assignmentId,
    assignmentAttempt: state.assignmentAttempt,
    assignmentFence: state.assignmentFence,
    takeoverFence: state.takeoverFence,
    envelopeDigest: state.assignmentEnvelopeDigest,
    observationId: state.observationId,
    observationDigest: state.observationDigest,
    checkpoint: state.checkpoint,
    producer: {
      principalId: state.owner,
      authorityRef: `assignment-envelope:${state.assignmentId}:${state.assignmentFence}`,
      authorityDigest: state.assignmentEnvelopeDigest,
    },
    acknowledgedAt: state.acknowledgedAt,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function decideWorkroomPreemptionTimeout(
  events: readonly WorkroomEvent[],
  now: number,
  event: (type: WorkroomEvent['type'], payload: Record<string, unknown>) => WorkroomEventDraft,
): readonly WorkroomEventDraft[] {
  const pending = replayWorkroomPreemptions(events).pending;
  if (!pending || pending.deadline > now) return Object.freeze([]);
  const blockerId = `preemption-timeout:${encodeURIComponent(pending.decisionId)}`;
  return Object.freeze([
    event('scheduler.preemption_timed_out', {
      decisionId: pending.decisionId,
      assignmentId: pending.assignmentId,
      reservedTaskKey: pending.reservedTaskKey,
      blockerId,
      owner: `orchestrator:${pending.projectId}`,
      deadline: now,
      allowedSuccessors: ['replan', 'cancel_run'],
      reason: 'Checkpoint deadline expired; owner and resource remain held until explicit recovery',
    }),
    event('task.blocked', {
      taskKey: pending.reservedTaskKey,
      blockerId,
      kind: 'external',
      owner: `orchestrator:${pending.projectId}`,
      reason: 'Preemption checkpoint timed out; replan or cancel without assuming resource release',
      deadline: now,
      allowedActions: ['replan', 'cancel'],
    }),
  ]);
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Workroom preemption ${label} is invalid`);
  return value;
}
function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom preemption ${label} is invalid`);
  }
  return value;
}
function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Workroom preemption ${label} is invalid`);
  }
  return value;
}
