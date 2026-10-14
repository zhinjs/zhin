import type { WorkroomEvent } from '../kernel-contracts.js';
import { assertAcceptanceContract, assertPersistedAcceptanceRecord } from '../acceptance-policy.js';
import { canonicalWorkroomJson, digestCanonicalWorkroomValue } from '../canonical-value.js';
import { assertWorkflowPlanProposal } from '../workflow-plan-builder.js';
import { assertWorkflowPlanRevisionCandidate } from '../plan-revision.js';
import { parseWorkroomRemoteAssignmentIssuance } from '../remote-assignment-issuance.js';
import { parseWorkroomLocalAssignmentIssuance } from '../local-assignment-issuance.js';
import { isWorkroomRunCancelReasonCode, isWorkroomRunReplanReasonCode } from '../workroom-run-control.js';
import {
  assertWorkroomSchedulerPolicySnapshot,
  parseWorkroomDispatchTaskDecision,
  parseWorkroomPreemptionPrepareDecision,
  parseWorkroomPriorityChangeProposal,
} from '../workroom-scheduler.js';

const WORKROOM_EVENT_TYPES = new Set<WorkroomEvent['type']>([
  'run.created', 'run.control_decided', 'run.replan_requested',
  'run.cancel_requested', 'run.cancelled', 'plan.admitted', 'plan_gate.decided',
  'plan.revision_applied',
  'task.planned', 'task.blocked', 'task.blocker_resolved',
  'task.cancel_requested', 'task.cancelled', 'task.failed',
  'task.accepted', 'task.acceptance_pinned', 'task.acceptance_blocked', 'task.rework_requested', 'task.revised',
  'task.plan_revised',
  'reviewer.assigned', 'reviewer.claimed', 'reviewer.verdict_recorded', 'reviewer.expired',
  'sponsor_gate.opened', 'sponsor_gate.decided', 'sponsor_gate.expired',
  'assignment.claimed', 'assignment.started', 'assignment.heartbeat',
  'assignment.progress', 'assignment.checkpointed',
  'assignment.checkpoint_requested', 'assignment.preempted',
  'assignment.execution_completed', 'assignment.cancel_requested',
  'assignment.cancelled', 'assignment.lease_expired',
  'scheduler.dispatch_requested', 'scheduler.priority_changed', 'scheduler.preemption_requested',
  'scheduler.preemption_checkpoint_acknowledged', 'scheduler.preemption_timed_out',
  'local_execution.requested',
  'remote_dispatch.requested', 'clock.advanced',
]);

export function isWorkroomEventType(value: unknown): value is WorkroomEvent['type'] {
  return typeof value === 'string' && WORKROOM_EVENT_TYPES.has(value as WorkroomEvent['type']);
}

/**
 * Closed top-level schema for every persisted Kernel fact. Values not listed
 * here are rejected before either the Journal header or Payload Vault is
 * written, so adding a future field requires an explicit governance choice.
 */
const WORKROOM_EVENT_PAYLOAD_KEYS: Readonly<Record<WorkroomEvent['type'], readonly string[]>> = Object.freeze({
  'run.created': ['projectId', 'title'],
  'run.control_decided': [
    'operationId', 'action', 'reasonCode', 'expectedSequence', 'principalId', 'requestDigest',
    'catalogRevision', 'projectDigest', 'authorizationRef',
    'stateSequence', 'stateStatus', 'stateDigest',
  ],
  'run.replan_requested': ['operationId', 'reasonCode', 'requestDigest'],
  'run.cancel_requested': ['reason'],
  'run.cancelled': ['reason'],
  'plan.admitted': [
    'operationId', 'sourceEventRef', 'sourceEventDigest', 'orchestratorAgentDefinitionId',
    'plan', 'schedulerPolicy',
  ],
  'plan.revision_applied': ['candidate', 'planRevision', 'recomputedDiffDigest'],
  'plan_gate.decided': [
    'operationId', 'requestDigest', 'taskKey', 'taskRevision', 'gateId', 'planDigest',
    'policyRevisionId', 'policyDigest', 'decision', 'sponsorPrincipalId', 'authorizedBy',
    'reasonDigest',
  ],
  'task.planned': [
    'type', 'taskKey', 'title', 'required', 'maxAttempts', 'role', 'dependsOn', 'requires',
    'sponsorLane', 'localRank', 'deadline', 'enqueuedAt', 'preemptibility', 'approvalGate',
  ],
  'task.blocked': [
    'type', 'taskKey', 'blockerId', 'kind', 'owner', 'reason', 'deadline', 'allowedActions',
  ],
  'task.blocker_resolved': ['type', 'taskKey', 'blockerId'],
  'task.cancel_requested': ['taskKey', 'reason'],
  'task.cancelled': ['taskKey', 'reason'],
  'task.failed': ['taskKey', 'reason'],
  'task.accepted': ['taskKey', 'reportRef', 'record'],
  'task.acceptance_pinned': ['taskKey', 'contract'],
  'task.acceptance_blocked': ['taskKey', 'reportRef', 'reason', 'evaluation'],
  'task.rework_requested': ['type', 'taskKey', 'reason', 'evaluation'],
  'task.revised': ['type', 'taskKey', 'title', 'reason', 'maxAttempts'],
  'task.plan_revised': [
    'taskKey', 'title', 'required', 'maxAttempts', 'role', 'dependsOn', 'requires',
    'sponsorLane', 'localRank', 'deadline', 'enqueuedAt', 'preemptibility', 'approvalGate',
    'expectedTaskRevision', 'newTaskRevision', 'reason',
  ],
  'reviewer.assigned': ['taskKey', 'reason', 'assignment'],
  'reviewer.claimed': [
    'taskKey', 'assignmentId', 'reviewerPrincipalId', 'authorizedBy', 'authorization',
  ],
  'reviewer.verdict_recorded': [
    'taskKey', 'assignmentId', 'reviewerPrincipalId', 'authorizedBy', 'outcome',
    'verdict', 'authorization',
  ],
  'reviewer.expired': ['taskKey', 'assignmentId'],
  'sponsor_gate.opened': ['taskKey', 'reason', 'gate'],
  'sponsor_gate.decided': [
    'taskKey', 'gateId', 'sponsorPrincipalId', 'authorizedBy', 'reason', 'candidateHash',
    'decision', 'authorization',
  ],
  'sponsor_gate.expired': ['taskKey', 'gateId'],
  'assignment.claimed': [
    'type', 'taskKey', 'assignmentId', 'owner', 'role', 'taskRevision', 'attempt',
    'assignmentRevision', 'fence', 'envelopeDigest', 'leaseExpiresAt',
  ],
  'assignment.started': ['assignmentId'],
  'assignment.progress': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'progress',
  ],
  'assignment.heartbeat': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'leaseExpiresAt',
  ],
  'assignment.checkpointed': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
    'checkpointRef', 'checkpointDigest',
  ],
  'assignment.checkpoint_requested': [
    'decisionId', 'assignmentId', 'envelopeDigest', 'reservedTaskKey', 'requestedAt',
    'deadline', 'takeoverFence', 'owner', 'allowedSuccessors',
  ],
  'assignment.preempted': [
    'decisionId', 'assignmentId', 'checkpointRef', 'checkpointDigest', 'outcome',
  ],
  'assignment.execution_completed': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'reportRef',
    'reportDigest', 'candidateRef', 'candidateHash', 'completionReceiptDigest',
  ],
  'assignment.cancel_requested': ['assignmentId', 'controlDeadline'],
  'assignment.cancelled': ['assignmentId', 'outcome'],
  'assignment.lease_expired': ['assignmentId'],
  'scheduler.dispatch_requested': [
    'version', 'type', 'decisionId', 'digest', 'projectId', 'runId', 'expectedSequence',
    'taskKey', 'taskRevision', 'role', 'sponsorLane', 'reason', 'policy',
  ],
  'scheduler.priority_changed': [
    'version', 'type', 'proposalId', 'digest', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'expectedSequence', 'currentLane', 'requestedLane', 'localRank',
    'principalId', 'authority', 'authorityRef', 'deadline', 'owner', 'allowedSuccessors',
    'authorizedBy',
  ],
  'scheduler.preemption_requested': [
    'version', 'type', 'decisionId', 'digest', 'projectId', 'runId', 'expectedSequence',
    'victimTaskKey', 'victimTaskRevision', 'reservedTaskKey', 'reservedTaskRevision',
    'assignmentId', 'assignmentAttempt', 'assignmentFence', 'assignmentEnvelopeDigest',
    'owner', 'requestedAt', 'deadline', 'takeoverFence', 'reason', 'allowedSuccessors', 'policy',
  ],
  'scheduler.preemption_checkpoint_acknowledged': [
    'decisionId', 'assignmentId', 'envelopeDigest', 'observationId', 'observationDigest',
    'checkpointRef', 'checkpointDigest', 'assignmentAttempt', 'assignmentFence', 'takeoverFence',
  ],
  'scheduler.preemption_timed_out': [
    'decisionId', 'assignmentId', 'reservedTaskKey', 'blockerId', 'owner', 'deadline',
    'allowedSuccessors', 'reason',
  ],
  'local_execution.requested': [
    'operationId', 'requestDigest', 'agentDefinitionId', 'issuedAt', 'envelope',
  ],
  'remote_dispatch.requested': [
    'operationId', 'requestDigest', 'issuedAt', 'reconcileDeadline', 'envelope', 'dispatchItem',
  ],
  'clock.advanced': ['now'],
});

export function assertAllowedPayloadKeys(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): void {
  const allowed = WORKROOM_EVENT_PAYLOAD_KEYS[type];
  if (Object.keys(payload).some(key => !allowed.includes(key))) {
    throw new Error(`Invalid Workroom event payload keys: ${type}`);
  }
}

export function validatePayload(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
  sequence: number,
): void {
  assertAllowedPayloadKeys(type, payload);
  switch (type) {
    case 'run.created':
      requirePayloadString(payload, 'projectId'); requirePayloadString(payload, 'title'); return;
    case 'run.control_decided':
      requirePayloadString(payload, 'operationId');
      requirePayloadEnum(payload, 'action', ['cancel', 'request_replan']);
      requirePayloadString(payload, 'reasonCode');
      if (payload.action === 'cancel'
        ? !isWorkroomRunCancelReasonCode(payload.reasonCode)
        : !isWorkroomRunReplanReasonCode(payload.reasonCode)) {
        throw new Error('Invalid Workroom event payload: Run control reasonCode');
      }
      if (!Number.isSafeInteger(payload.expectedSequence) || Number(payload.expectedSequence) < 0) {
        throw new Error('Invalid Workroom event payload: expectedSequence');
      }
      requirePayloadString(payload, 'principalId'); requirePayloadDigest(payload, 'requestDigest');
      requirePayloadString(payload, 'catalogRevision'); requirePayloadDigest(payload, 'projectDigest');
      requirePayloadString(payload, 'authorizationRef');
      if (!Number.isSafeInteger(payload.stateSequence) || Number(payload.stateSequence) < 0) {
        throw new Error('Invalid Workroom event payload: stateSequence');
      }
      requirePayloadEnum(payload, 'stateStatus', [
        'active', 'blocked', 'needs_replan', 'cancelling', 'completed', 'cancelled',
      ]);
      requirePayloadDigest(payload, 'stateDigest'); return;
    case 'run.replan_requested':
      requirePayloadString(payload, 'operationId'); requirePayloadString(payload, 'reasonCode');
      if (!isWorkroomRunReplanReasonCode(payload.reasonCode)) {
        throw new Error('Invalid Workroom event payload: replan reasonCode');
      }
      requirePayloadDigest(payload, 'requestDigest'); return;
    case 'plan.admitted':
      requirePayloadString(payload, 'operationId'); requirePayloadString(payload, 'sourceEventRef');
      requirePayloadDigest(payload, 'sourceEventDigest');
      requirePayloadString(payload, 'orchestratorAgentDefinitionId');
      assertWorkflowPlanProposal(requirePayloadRecord(payload, 'plan') as unknown as import('../workflow-plan-builder.js').WorkflowPlanProposal);
      if (payload.schedulerPolicy !== undefined) {
        assertWorkroomSchedulerPolicySnapshot(
          payload.schedulerPolicy as import('../workroom-scheduler.js').WorkroomSchedulerPolicySnapshot,
          sequence,
        );
      }
      return;
    case 'plan.revision_applied': {
      const candidate = requirePayloadRecord(payload, 'candidate') as unknown as import('../plan-revision.js').WorkflowPlanRevisionCandidate;
      assertWorkflowPlanRevisionCandidate(candidate);
      requirePayloadPositiveInteger(payload, 'planRevision');
      requirePayloadDigest(payload, 'recomputedDiffDigest');
      if (payload.recomputedDiffDigest !== digestCanonicalWorkroomValue(candidate.diff)) {
        throw new Error('Persisted Plan Revision recomputed diff digest is invalid');
      }
      return;
    }
    case 'plan_gate.decided':
      requirePayloadString(payload, 'operationId'); requirePayloadDigest(payload, 'requestDigest');
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'taskRevision');
      requirePayloadString(payload, 'gateId'); requirePayloadDigest(payload, 'planDigest');
      requirePayloadString(payload, 'policyRevisionId'); requirePayloadDigest(payload, 'policyDigest');
      requirePayloadEnum(payload, 'decision', ['approve', 'reject', 'request_changes', 'cancel']);
      requirePayloadString(payload, 'sponsorPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadDigest(payload, 'reasonDigest');
      return;
    case 'local_execution.requested':
      parseWorkroomLocalAssignmentIssuance(payload);
      return;
    case 'remote_dispatch.requested':
      parseWorkroomRemoteAssignmentIssuance(payload);
      return;
    case 'scheduler.dispatch_requested':
      parseWorkroomDispatchTaskDecision(payload); return;
    case 'scheduler.priority_changed':
      requirePayloadString(payload, 'proposalId'); requirePayloadDigest(payload, 'digest');
      requirePayloadString(payload, 'projectId'); requirePayloadString(payload, 'runId');
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'taskRevision');
      requirePayloadEnum(payload, 'currentLane', ['urgent', 'high', 'normal', 'low']);
      requirePayloadEnum(payload, 'requestedLane', ['urgent', 'high', 'normal', 'low']);
      requirePayloadEnum(payload, 'authority', ['sponsor', 'orchestrator']);
      requirePayloadString(payload, 'principalId'); requirePayloadString(payload, 'authorityRef');
      requirePayloadString(payload, 'owner'); requirePayloadNumber(payload, 'deadline');
      requirePayloadString(payload, 'authorizedBy');
      parseWorkroomPriorityChangeProposal({
        version: payload.version,
        type: payload.type,
        proposalId: payload.proposalId,
        digest: payload.digest,
        projectId: payload.projectId,
        runId: payload.runId,
        taskKey: payload.taskKey,
        taskRevision: payload.taskRevision,
        expectedSequence: payload.expectedSequence,
        currentLane: payload.currentLane,
        requestedLane: payload.requestedLane,
        localRank: payload.localRank,
        principalId: payload.principalId,
        authority: payload.authority,
        authorityRef: payload.authorityRef,
        deadline: payload.deadline,
        owner: payload.owner,
        allowedSuccessors: payload.allowedSuccessors,
      });
      if (payload.authorizedBy !== payload.authorityRef) {
        throw new Error('Persisted Workroom priority authority proof is not exact');
      }
      return;
    case 'scheduler.preemption_requested':
      parseWorkroomPreemptionPrepareDecision(payload); return;
    case 'scheduler.preemption_checkpoint_acknowledged':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadDigest(payload, 'envelopeDigest'); requirePayloadString(payload, 'observationId');
      requirePayloadDigest(payload, 'observationDigest'); requirePayloadString(payload, 'checkpointRef');
      requirePayloadDigest(payload, 'checkpointDigest'); requirePayloadPositiveInteger(payload, 'assignmentAttempt');
      requirePayloadPositiveInteger(payload, 'assignmentFence'); requirePayloadPositiveInteger(payload, 'takeoverFence');
      if (payload.takeoverFence !== Number(payload.assignmentFence) + 1) {
        throw new Error('Invalid Workroom event payload: preemption takeover fence');
      }
      return;
    case 'scheduler.preemption_timed_out':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'reservedTaskKey'); requirePayloadString(payload, 'blockerId');
      requirePayloadString(payload, 'owner'); requirePayloadNumber(payload, 'deadline');
      requirePayloadString(payload, 'reason');
      if (canonicalWorkroomJson(payload.allowedSuccessors) !== canonicalWorkroomJson(['replan', 'cancel_run'])) {
        throw new Error('Invalid Workroom event payload: preemption timeout successors');
      }
      return;
    case 'run.cancel_requested':
    case 'run.cancelled':
      requirePayloadString(payload, 'reason'); return;
    case 'task.planned':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadBoolean(payload, 'required'); requirePayloadPositiveInteger(payload, 'maxAttempts');
      if (payload.approvalGate !== undefined) {
        const gate = requirePayloadRecord(payload, 'approvalGate');
        requirePayloadString(gate, 'id'); requirePayloadEnum(gate, 'kind', ['sponsor']);
        requirePayloadString(gate, 'owner'); requirePayloadPositiveInteger(gate, 'decisionTimeoutMs');
        requirePayloadString(gate, 'policyRevisionId'); requirePayloadDigest(gate, 'policyDigest');
        if (!Array.isArray(gate.allowedActions)
          || canonicalWorkroomJson(gate.allowedActions) !== canonicalWorkroomJson(['approve', 'reject', 'replan', 'cancel'])) {
          throw new Error('Invalid Workroom event payload: approvalGate allowedActions');
        }
      }
      return;
    case 'task.blocked':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId');
      requirePayloadEnum(payload, 'kind', ['dependency', 'approval', 'capability', 'external', 'human_input']);
      requirePayloadString(payload, 'owner'); requirePayloadString(payload, 'reason');
      requirePayloadNumber(payload, 'deadline'); return;
    case 'task.blocker_resolved':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId'); return;
    case 'task.cancel_requested':
    case 'task.cancelled':
    case 'task.failed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.accepted':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reportRef');
      assertPersistedAcceptanceRecord(
        payload.record,
        String(payload.taskKey),
        String(payload.reportRef),
        sequence,
      ); return;
    case 'task.acceptance_pinned': {
      requirePayloadString(payload, 'taskKey');
      const contract = requirePayloadRecord(payload, 'contract');
      assertAcceptanceContract(
        contract as unknown as import('../acceptance-policy.js').WorkroomAcceptanceContract,
        String(payload.taskKey),
        Number(contract.taskRevision),
      );
      return;
    }
    case 'task.acceptance_blocked':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reportRef');
      requirePayloadString(payload, 'reason'); requirePayloadRecord(payload, 'evaluation'); return;
    case 'reviewer.assigned':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason');
      validateAcceptanceWait(requirePayloadRecord(payload, 'assignment'), String(payload.taskKey), true); return;
    case 'reviewer.expired':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId'); return;
    case 'reviewer.claimed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'reviewerPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadRecord(payload, 'authorization'); return;
    case 'reviewer.verdict_recorded':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadEnum(payload, 'outcome', ['passed', 'rework']);
      requirePayloadRecord(payload, 'verdict'); requirePayloadRecord(payload, 'authorization'); return;
    case 'sponsor_gate.opened':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason');
      validateAcceptanceWait(requirePayloadRecord(payload, 'gate'), String(payload.taskKey), false); return;
    case 'sponsor_gate.expired':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'gateId'); return;
    case 'sponsor_gate.decided':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'gateId');
      requirePayloadString(payload, 'sponsorPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadString(payload, 'reason'); requirePayloadString(payload, 'candidateHash');
      requirePayloadEnum(payload, 'decision', ['approve', 'reject', 'request_changes', 'cancel']);
      requirePayloadRecord(payload, 'authorization'); return;
    case 'task.rework_requested':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.revised':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadString(payload, 'reason'); requirePayloadPositiveInteger(payload, 'maxAttempts'); return;
    case 'task.plan_revised':
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'expectedTaskRevision');
      requirePayloadPositiveInteger(payload, 'newTaskRevision'); requirePayloadString(payload, 'title');
      requirePayloadBoolean(payload, 'required'); requirePayloadPositiveInteger(payload, 'maxAttempts');
      requirePayloadString(payload, 'role'); requirePayloadString(payload, 'reason');
      return;
    case 'assignment.claimed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'owner'); requirePayloadEnum(payload, 'role', ['executor', 'reviewer', 'integration']);
      requirePayloadPositiveInteger(payload, 'taskRevision'); requirePayloadPositiveInteger(payload, 'attempt');
      requirePayloadPositiveInteger(payload, 'assignmentRevision'); requirePayloadPositiveInteger(payload, 'fence');
      requirePayloadDigest(payload, 'envelopeDigest');
      requirePayloadNumber(payload, 'leaseExpiresAt'); return;
    case 'assignment.started':
    case 'assignment.lease_expired':
      requirePayloadString(payload, 'assignmentId'); return;
    case 'assignment.progress':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'progress',
      ], type);
      validateProgress(requirePayloadRecord(payload, 'progress'));
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'progress',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        progress: payload.progress,
      });
      return;
    case 'assignment.heartbeat':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'leaseExpiresAt',
      ], type);
      requirePayloadNumber(payload, 'leaseExpiresAt');
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'heartbeat',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
      });
      return;
    case 'assignment.checkpointed':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
        'checkpointRef', 'checkpointDigest',
      ], type);
      requirePayloadString(payload, 'checkpointRef'); requirePayloadDigest(payload, 'checkpointDigest');
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'checkpoint',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        checkpoint: { ref: payload.checkpointRef, digest: payload.checkpointDigest },
      });
      return;
    case 'assignment.checkpoint_requested':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadDigest(payload, 'envelopeDigest'); requirePayloadString(payload, 'reservedTaskKey');
      requirePayloadNumber(payload, 'requestedAt'); requirePayloadNumber(payload, 'deadline');
      requirePayloadPositiveInteger(payload, 'takeoverFence'); requirePayloadString(payload, 'owner');
      if (Number(payload.deadline) <= Number(payload.requestedAt)
        || canonicalWorkroomJson(payload.allowedSuccessors) !== canonicalWorkroomJson(['replan', 'cancel_run'])) {
        throw new Error('Invalid Workroom event payload: checkpoint request recovery metadata');
      }
      return;
    case 'assignment.preempted':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'checkpointRef'); requirePayloadDigest(payload, 'checkpointDigest');
      requirePayloadEnum(payload, 'outcome', ['interrupted']); return;
    case 'assignment.execution_completed':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
        'reportRef', 'reportDigest', 'candidateRef', 'candidateHash',
        ...(payload.completionReceiptDigest === undefined
          ? []
          : ['completionReceiptDigest']),
      ], type);
      requirePayloadString(payload, 'reportRef'); requirePayloadDigest(payload, 'reportDigest');
      requirePayloadString(payload, 'candidateRef'); requirePayloadDigest(payload, 'candidateHash');
      if (payload.completionReceiptDigest !== undefined) {
        requirePayloadDigest(payload, 'completionReceiptDigest');
      }
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'execution_completed',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        completion: {
          report: { ref: payload.reportRef, digest: payload.reportDigest },
          candidate: { ref: payload.candidateRef, hash: payload.candidateHash },
          ...(payload.completionReceiptDigest === undefined
            ? {}
            : { completionReceiptDigest: payload.completionReceiptDigest }),
        },
      });
      return;
    case 'assignment.cancel_requested':
      requirePayloadString(payload, 'assignmentId'); requirePayloadNumber(payload, 'controlDeadline'); return;
    case 'assignment.cancelled':
      requirePayloadString(payload, 'assignmentId');
      requirePayloadEnum(payload, 'outcome', ['interrupted', 'committed', 'outcome_unknown']); return;
    case 'clock.advanced':
      requirePayloadNumber(payload, 'now'); return;
  }
}

function validateAssignmentObservationHeader(payload: Readonly<Record<string, unknown>>): void {
  requirePayloadString(payload, 'assignmentId');
  requirePayloadString(payload, 'observationId');
  requirePayloadDigest(payload, 'observationDigest');
  requirePayloadDigest(payload, 'envelopeDigest');
}

function assertPersistedAssignmentObservationDigest(
  payload: Readonly<Record<string, unknown>>,
  observation: Readonly<Record<string, unknown>>,
): void {
  if (digestCanonicalWorkroomValue(observation) !== payload.observationDigest) {
    throw new Error('Invalid Workroom event payload: observationDigest does not match body');
  }
}

function validateProgress(progress: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(progress);
  if (keys.some(key => !['summary', 'completedUnits', 'totalUnits'].includes(key))) {
    throw new Error('Invalid Workroom event payload: progress keys');
  }
  requirePayloadString(progress, 'summary');
  const completed = progress.completedUnits;
  const total = progress.totalUnits;
  if (completed !== undefined && (!Number.isSafeInteger(completed) || (completed as number) < 0)) {
    throw new Error('Invalid Workroom event payload: completedUnits');
  }
  if (total !== undefined && (!Number.isSafeInteger(total) || (total as number) < 1)) {
    throw new Error('Invalid Workroom event payload: totalUnits');
  }
  if (typeof completed === 'number' && typeof total === 'number' && completed > total) {
    throw new Error('Invalid Workroom event payload: completedUnits exceeds totalUnits');
  }
}

function assertExactPayloadKeys(
  payload: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  type: WorkroomEvent['type'],
): void {
  const actual = Object.keys(payload).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`Invalid Workroom event payload keys: ${type}`);
  }
}

export function assertExactRecordKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

function validateAcceptanceWait(value: Record<string, unknown>, taskKey: string, reviewer: boolean): void {
  for (const key of ['id', 'taskKey', 'candidateHash', 'contractId', 'owner']) {
    requirePayloadString(value, key);
  }
  requirePayloadPositiveInteger(value, 'taskRevision');
  requirePayloadEnum(value, 'riskTier', ['low', 'medium', 'high', 'critical']);
  requirePayloadEnum(value, 'route', ['reviewer_required', 'sponsor_required', 'reviewer_then_sponsor']);
  if (value.taskKey !== taskKey) throw new Error('Invalid Workroom event payload: wait taskKey');
  requirePayloadNumber(value, 'deadline');
  requirePayloadEnum(value, 'status', ['open']);
  requirePayloadRecord(value, 'evaluation');
  const policy = requirePayloadRecord(value, 'policy');
  requirePayloadString(policy, 'id'); requirePayloadString(policy, 'digest');
  requirePayloadPositiveInteger(policy, 'revision');
  if (reviewer) requirePayloadString(value, 'producerPrincipalId');
  if (!Array.isArray(value.allowedActions) || value.allowedActions.length === 0
    || value.allowedActions.some(action => !isNonEmptyString(action)
      || !ACCEPTANCE_WAIT_ACTIONS.has(action))) {
    throw new Error('Invalid Workroom event payload: allowedActions');
  }
}

const ACCEPTANCE_WAIT_ACTIONS = new Set([
  'claim', 'submit_verdict', 'approve', 'reject', 'request_changes',
  'reassign', 'reopen', 'rebase', 'replan', 'cancel',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requirePayloadString(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isNonEmptyString(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadNumber(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isFiniteNumber(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadDigest(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (typeof payload[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(payload[key])) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}

function requirePayloadRecord(payload: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  if (!isRecord(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
  return payload[key];
}

function requirePayloadPositiveInteger(payload: Readonly<Record<string, unknown>>, key: string): void {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}

function requirePayloadBoolean(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (typeof payload[key] !== 'boolean') throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadEnum(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly string[],
): void {
  if (typeof payload[key] !== 'string' || !values.includes(payload[key])) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}
