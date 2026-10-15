import type { WorkroomBlocker, WorkroomBlockerKind, WorkroomEvent } from '../kernel-contracts.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from '../canonical-value.js';
import type {
  StoredWorkroomEvent,
  WorkroomAssignmentRoleHeader,
  WorkroomStoredEventControl,
  WorkroomStoredProtectedReceiptHeader,
} from './contracts.js';
import { assertExactRecordKeys, isNonEmptyString, isRecord } from './event-validation.js';
import { isGovernedJournalPayloadReference } from './payload-reference.js';

export function deriveStoredEventControl(event: WorkroomEvent): WorkroomStoredEventControl {
  const payload = event.payload;
  const taskKey = (): string => opaqueStoredRef('task', event.runId, storedHeaderText(payload, 'taskKey'));
  const assignmentId = (): string =>
    opaqueStoredRef('assignment', event.runId, storedHeaderText(payload, 'assignmentId'));
  switch (event.type) {
    case 'run.created': return deepFreeze({ projectId: storedHeaderText(payload, 'projectId') });
    case 'task.planned': return deepFreeze({
      taskKey: taskKey(),
      required: payload.required === true,
      maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
    });
    case 'task.blocked': return deepFreeze({
      taskKey: taskKey(),
      blockerId: opaqueStoredRef('blocker', event.runId, storedHeaderText(payload, 'blockerId')),
      blockerKind: storedHeaderBlockerKind(payload.kind),
      blockerDeadline: storedHeaderNonNegativeInteger(payload, 'deadline'),
      blockerAllowedActions: Object.freeze(['resolve', 'replan', 'cancel'] as const),
    });
    case 'task.blocker_resolved': return deepFreeze({
      taskKey: taskKey(),
      blockerId: opaqueStoredRef('blocker', event.runId, storedHeaderText(payload, 'blockerId')),
    });
    case 'assignment.claimed': return deepFreeze({
      taskKey: taskKey(),
      assignmentId: assignmentId(),
      role: storedHeaderRole(payload.role),
      attempt: storedHeaderPositiveInteger(payload, 'attempt'),
      assignmentRevision: storedHeaderPositiveInteger(payload, 'assignmentRevision'),
      fence: storedHeaderPositiveInteger(payload, 'fence'),
    });
    case 'assignment.started':
    case 'assignment.progress':
    case 'assignment.heartbeat':
    case 'assignment.checkpointed':
    case 'assignment.checkpoint_requested':
    case 'assignment.preempted':
    case 'assignment.execution_completed':
    case 'assignment.cancel_requested':
    case 'assignment.lease_expired': return deepFreeze({ assignmentId: assignmentId() });
    case 'assignment.cancelled': return deepFreeze({
      assignmentId: assignmentId(), outcome: storedHeaderOutcome(payload.outcome),
    });
    case 'task.accepted':
    case 'task.acceptance_pinned':
    case 'task.acceptance_blocked':
    case 'task.cancel_requested':
    case 'task.cancelled':
    case 'task.failed':
    case 'task.rework_requested': return deepFreeze({ taskKey: taskKey() });
    case 'task.revised': return deepFreeze({
      taskKey: taskKey(), maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
    });
    case 'task.plan_revised': return deepFreeze({
      taskKey: taskKey(), required: payload.required === true,
      maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
      newTaskRevision: storedHeaderPositiveInteger(payload, 'newTaskRevision'),
    });
    case 'reviewer.assigned': {
      const assignment = storedHeaderRecord(payload, 'assignment');
      return deepFreeze({
        taskKey: taskKey(),
        waitId: opaqueStoredRef('reviewer', event.runId, storedHeaderText(assignment, 'id')),
        waitStatus: storedHeaderText(assignment, 'status'),
      });
    }
    case 'reviewer.claimed':
    case 'reviewer.verdict_recorded':
    case 'reviewer.expired': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('reviewer', event.runId, storedHeaderText(payload, 'assignmentId')),
      ...(event.type === 'reviewer.verdict_recorded'
        ? { verdictOutcome: payload.outcome === 'passed' ? 'passed' as const : 'rework' as const }
        : {}),
    });
    case 'sponsor_gate.opened': {
      const gate = storedHeaderRecord(payload, 'gate');
      return deepFreeze({
        taskKey: taskKey(),
        waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(gate, 'id')),
        waitStatus: storedHeaderText(gate, 'status'),
      });
    }
    case 'sponsor_gate.decided': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(payload, 'gateId')),
      decision: storedHeaderDecision(payload.decision),
    });
    case 'sponsor_gate.expired': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(payload, 'gateId')),
    });
    default: return Object.freeze({});
  }
}

const WORKROOM_EVENT_CONTROL_KEYS: Readonly<Record<WorkroomEvent['type'], readonly string[]>> = Object.freeze({
  'run.created': ['projectId'],
  'task.planned': ['taskKey', 'required', 'maxAttempts'],
  'task.blocked': [
    'taskKey', 'blockerId', 'blockerKind', 'blockerDeadline', 'blockerAllowedActions',
  ],
  'task.blocker_resolved': ['taskKey', 'blockerId'],
  'assignment.claimed': [
    'taskKey', 'assignmentId', 'role', 'attempt', 'assignmentRevision', 'fence',
  ],
  'assignment.started': ['assignmentId'],
  'assignment.progress': ['assignmentId'],
  'assignment.heartbeat': ['assignmentId'],
  'assignment.checkpointed': ['assignmentId'],
  'assignment.checkpoint_requested': ['assignmentId'],
  'assignment.preempted': ['assignmentId'],
  'assignment.execution_completed': ['assignmentId'],
  'assignment.cancel_requested': ['assignmentId'],
  'assignment.cancelled': ['assignmentId', 'outcome'],
  'assignment.lease_expired': ['assignmentId'],
  'task.accepted': ['taskKey'],
  'task.acceptance_pinned': ['taskKey'],
  'task.acceptance_blocked': ['taskKey'],
  'task.cancel_requested': ['taskKey'],
  'task.cancelled': ['taskKey'],
  'task.failed': ['taskKey'],
  'task.rework_requested': ['taskKey'],
  'task.revised': ['taskKey', 'maxAttempts'],
  'task.plan_revised': ['taskKey', 'required', 'maxAttempts', 'newTaskRevision'],
  'reviewer.assigned': ['taskKey', 'waitId', 'waitStatus'],
  'reviewer.claimed': ['taskKey', 'waitId'],
  'reviewer.verdict_recorded': ['taskKey', 'waitId', 'verdictOutcome'],
  'reviewer.expired': ['taskKey', 'waitId'],
  'sponsor_gate.opened': ['taskKey', 'waitId', 'waitStatus'],
  'sponsor_gate.decided': ['taskKey', 'waitId', 'decision'],
  'sponsor_gate.expired': ['taskKey', 'waitId'],
  'plan.admitted': [],
  'plan.revision_applied': [],
  'plan_gate.decided': [],
  'run.control_decided': [],
  'run.replan_requested': [],
  'run.cancel_requested': [],
  'run.cancelled': [],
  'scheduler.dispatch_requested': [],
  'scheduler.priority_changed': [],
  'scheduler.preemption_requested': [],
  'scheduler.preemption_checkpoint_acknowledged': [],
  'scheduler.preemption_timed_out': [],
  'local_execution.requested': [],
  'remote_dispatch.requested': [],
  'clock.advanced': [],
});

export function validateStoredEventControl(
  type: WorkroomEvent['type'],
  control: Readonly<Record<string, unknown>>,
): void {
  const keys = type === 'task.blocked' && Object.keys(control).length === 2
    ? ['taskKey', 'blockerId']
    : WORKROOM_EVENT_CONTROL_KEYS[type];
  assertExactRecordKeys(control, keys, 'Stored Workroom control');
  if (control.projectId !== undefined) storedHeaderText(control, 'projectId');
  for (const key of ['taskKey', 'assignmentId', 'blockerId', 'waitId'] as const) {
    if (control[key] !== undefined && (typeof control[key] !== 'string'
      || !/^workroom-[a-z-]+:[a-f0-9]{64}$/u.test(control[key]))) {
      throw new Error(`Stored Workroom control ${key} is invalid`);
    }
  }
  for (const key of ['maxAttempts', 'attempt', 'assignmentRevision', 'fence', 'newTaskRevision'] as const) {
    if (control[key] !== undefined) storedHeaderPositiveInteger(control, key);
  }
  if (control.required !== undefined && typeof control.required !== 'boolean') {
    throw new Error('Stored Workroom control required is invalid');
  }
  if (control.blockerKind !== undefined) storedHeaderBlockerKind(control.blockerKind);
  if (control.blockerDeadline !== undefined) {
    storedHeaderNonNegativeInteger(control, 'blockerDeadline');
  }
  if (control.blockerAllowedActions !== undefined) {
    storedHeaderBlockerActions(control.blockerAllowedActions);
  }
  if (control.role !== undefined) storedHeaderRole(control.role);
  if (control.outcome !== undefined) storedHeaderOutcome(control.outcome);
  if (control.decision !== undefined) storedHeaderDecision(control.decision);
  if (control.verdictOutcome !== undefined
    && control.verdictOutcome !== 'passed' && control.verdictOutcome !== 'rework') {
    throw new Error('Stored Workroom control verdict outcome is invalid');
  }
  if (control.waitStatus !== undefined && ![
    'open', 'claimed', 'passed', 'rework', 'expired', 'cancelled', 'satisfied', 'stale',
  ].includes(String(control.waitStatus))) {
    throw new Error('Stored Workroom control wait status is invalid');
  }
}

export function storedProtectedReceiptHeaders(
  value: Readonly<Record<string, unknown>>,
): readonly WorkroomStoredProtectedReceiptHeader[] {
  const headers: WorkroomStoredProtectedReceiptHeader[] = [];
  const visit = (candidate: unknown): void => {
    if (isGovernedJournalPayloadReference(candidate)) {
      headers.push(deepFreeze({
        fieldPath: candidate.fieldPath,
        contentHash: candidate.contentHash,
        descriptorDigest: candidate.receipt.descriptor.descriptorDigest,
        sourceDigest: candidate.receipt.source.digest,
        sourceBindingDigest: candidate.receipt.source.bindingDigest,
      }));
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (isRecord(candidate)) for (const item of Object.values(candidate)) visit(item);
  };
  visit(value);
  return deepFreeze(headers.sort((left, right) =>
    compareCanonicalWorkroomText(left.fieldPath, right.fieldPath)));
}

function opaqueStoredRef(kind: string, runId: string, rawId: string): string {
  return `workroom-${kind}:${digestCanonicalWorkroomValue({ kind, runId, rawId }).slice('sha256:'.length)}`;
}

function storedHeaderText(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (!isNonEmptyString(value)) throw new Error(`Stored Workroom header ${key} is invalid`);
  return value;
}

function storedHeaderPositiveInteger(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function storedHeaderNonNegativeInteger(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function storedHeaderBlockerKind(value: unknown): WorkroomBlockerKind {
  if (value !== 'dependency' && value !== 'approval' && value !== 'capability'
    && value !== 'external' && value !== 'human_input') {
    throw new Error('Stored Workroom header Blocker kind is invalid');
  }
  return value;
}

function storedHeaderBlockerActions(value: unknown): WorkroomBlocker['allowedActions'] {
  if (!Array.isArray(value)
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(['resolve', 'replan', 'cancel'])) {
    throw new Error('Stored Workroom header Blocker allowedActions are invalid');
  }
  return Object.freeze([...value]) as WorkroomBlocker['allowedActions'];
}

function storedHeaderRecord(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (!isRecord(value)) throw new Error(`Stored Workroom header ${key} is invalid`);
  return value;
}

function storedHeaderRole(value: unknown): WorkroomAssignmentRoleHeader {
  if (value !== 'executor' && value !== 'reviewer' && value !== 'integration') {
    throw new Error('Stored Workroom header Assignment role is invalid');
  }
  return value;
}

function storedHeaderOutcome(value: unknown): NonNullable<WorkroomStoredEventControl['outcome']> {
  if (value !== 'interrupted' && value !== 'committed' && value !== 'outcome_unknown') {
    throw new Error('Stored Workroom header Assignment outcome is invalid');
  }
  return value;
}

function storedHeaderDecision(value: unknown): NonNullable<WorkroomStoredEventControl['decision']> {
  if (value !== 'approve' && value !== 'reject' && value !== 'request_changes' && value !== 'cancel') {
    throw new Error('Stored Workroom header Sponsor decision is invalid');
  }
  return value;
}
