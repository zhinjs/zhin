import {
  assertPinnedAcceptanceContract,
  createGatedAcceptanceRecord,
  type WorkroomAcceptanceDecision,
  type WorkroomAcceptancePolicySnapshot,
  type WorkroomAcceptanceWaitRequest,
} from './acceptance-policy.js';
import type {
  WorkroomEventDraft,
  WorkroomEventType,
  WorkroomReviewerAssignmentState,
  WorkroomRunState,
  WorkroomSponsorGateState,
  WorkroomTaskState,
} from './kernel-contracts.js';

export type WorkroomAcceptanceControlAction =
  | 'claim_review'
  | 'submit_review'
  | 'decide_sponsor';

export type WorkroomAcceptanceControlRole = 'reviewer' | 'sponsor';

/** Exact authority question asked at the authenticated Workroom control boundary. */
export interface WorkroomAcceptanceAuthorizationInput {
  readonly action: WorkroomAcceptanceControlAction;
  readonly principalId: string;
  readonly requiredRole: WorkroomAcceptanceControlRole;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly targetId: string;
  readonly expectedSequence: number;
}

interface WorkroomAcceptanceAuthorizationEcho {
  readonly action: WorkroomAcceptanceControlAction;
  readonly principalId: string;
  readonly role: WorkroomAcceptanceControlRole;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly targetId: string;
  readonly expectedSequence: number;
}

export type WorkroomAcceptanceAuthorizationDecision =
  | Readonly<WorkroomAcceptanceAuthorizationEcho & {
      readonly authorized: true;
      readonly authorizedBy: string;
    }>
  | Readonly<WorkroomAcceptanceAuthorizationEcho & {
      readonly authorized: false;
      readonly reason: string;
    }>;

/** Trusted membership/RBAC seam. Decisions are data and are re-bound by the pure reducers below. */
export interface WorkroomAcceptanceAuthorityPort {
  authorize(
    input: Readonly<WorkroomAcceptanceAuthorizationInput>,
  ): WorkroomAcceptanceAuthorizationDecision | Promise<WorkroomAcceptanceAuthorizationDecision>;
}

export type ReviewerCriterionVerdictStatus = 'passed' | 'failed' | 'needs_evidence';

export interface ReviewerCriterionVerdict {
  readonly criterionId: string;
  readonly status: ReviewerCriterionVerdictStatus;
  readonly evidenceRefs: readonly string[];
  readonly reason?: string;
}

export interface ReviewerVerdict {
  readonly candidateHash: string;
  readonly criteria: readonly ReviewerCriterionVerdict[];
  readonly acceptedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reason?: string;
}

export type WorkroomSponsorDecision = 'approve' | 'reject' | 'request_changes' | 'cancel';

export type WorkroomAcceptanceEventFactory = (
  type: WorkroomEventType,
  payload: Record<string, unknown>,
) => WorkroomEventDraft;

export interface ReviewerClaimInput {
  readonly assignmentId: string;
  readonly principalId: string;
  readonly authorization: WorkroomAcceptanceAuthorizationDecision;
}

export interface ReviewerVerdictInput extends ReviewerClaimInput {
  readonly verdict: ReviewerVerdict;
}

export interface SponsorGateDecisionInput {
  readonly gateId: string;
  readonly principalId: string;
  readonly candidateHash: string;
  readonly decision: WorkroomSponsorDecision;
  readonly reason: string;
  readonly authorization: WorkroomAcceptanceAuthorizationDecision;
}

export function decideReviewerClaim(
  state: WorkroomRunState,
  input: Readonly<ReviewerClaimInput>,
  event: WorkroomAcceptanceEventFactory,
): readonly WorkroomEventDraft[] {
  const assignment = requireCurrentReviewer(state, input.assignmentId, ['open']);
  assertWaitBinding(state, assignment);
  assertAuthorized(state, assignment.taskKey, assignment.id, input.principalId, 'reviewer', 'claim_review', input.authorization);
  if (assignment.producerPrincipalId === input.principalId) {
    throw new Error('Producer cannot review its own Candidate');
  }
  return Object.freeze([event('reviewer.claimed', {
    taskKey: assignment.taskKey,
    assignmentId: assignment.id,
    reviewerPrincipalId: input.principalId,
    authorizedBy: authorizedBy(input.authorization),
    authorization: input.authorization,
  })]);
}

export function decideReviewerVerdict(
  state: WorkroomRunState,
  input: Readonly<ReviewerVerdictInput>,
  event: WorkroomAcceptanceEventFactory,
): readonly WorkroomEventDraft[] {
  const assignment = requireCurrentReviewer(state, input.assignmentId, ['claimed']);
  assertWaitBinding(state, assignment);
  assertAuthorized(state, assignment.taskKey, assignment.id, input.principalId, 'reviewer', 'submit_review', input.authorization);
  if (assignment.reviewerPrincipalId !== input.principalId) {
    throw new Error('Reviewer verdict principal does not match the Reviewer claim');
  }
  const evaluation = requireEvaluation(assignment);
  assertVerdictBindings(evaluation, input.verdict);

  const verdict = freezeVerdict(input.verdict);
  const verdictEvent = event('reviewer.verdict_recorded', {
    taskKey: assignment.taskKey,
    assignmentId: assignment.id,
    reviewerPrincipalId: input.principalId,
    authorizedBy: authorizedBy(input.authorization),
    authorization: input.authorization,
    outcome: requiresReviewerRework(verdict) ? 'rework' : 'passed',
    verdict,
  });
  const requiresRework = requiresReviewerRework(verdict);
  if (requiresRework) {
    return Object.freeze([verdictEvent, event('task.rework_requested', {
      taskKey: assignment.taskKey,
      reason: verdict.reason?.trim() || reviewerFailureReason(verdict),
      evaluation,
    })]);
  }

  if (evaluation.route === 'reviewer_required') {
    const record = createGatedAcceptanceRecord({
      decision: evaluation,
      sourceSequence: state.sequence + 1,
      acceptanceSequence: state.sequence + 2,
      acceptedClaimIds: verdict.acceptedClaimIds,
      rejectedClaimIds: verdict.rejectedClaimIds,
      reviewer: { assignmentId: assignment.id, principalId: input.principalId },
    });
    return Object.freeze([verdictEvent, event('task.accepted', {
      taskKey: assignment.taskKey,
      reportRef: evaluation.candidate.reportRef,
      record,
    })]);
  }
  if (evaluation.route !== 'reviewer_then_sponsor') {
    throw new Error('Reviewer verdict does not match a Reviewer-gated Acceptance route');
  }
  const wait = requireNextSponsorWait(state, evaluation);
  const gateId = `sponsor:${evaluation.candidate.id}:${state.sequence + 2}`;
  return Object.freeze([verdictEvent, event('sponsor_gate.opened', {
    taskKey: assignment.taskKey,
    reason: evaluation.reason ?? 'Reviewer passed; Sponsor authority is required',
    gate: freezeSponsorGate({
      id: gateId,
      taskKey: assignment.taskKey,
      taskRevision: assignment.taskRevision,
      candidateHash: evaluation.candidate.hash,
      riskTier: evaluation.riskAssessment.tier,
      route: evaluation.route,
      contractId: evaluation.contract.id,
      policy: evaluation.contract.policy,
      owner: wait.owner,
      deadline: wait.deadline,
      allowedActions: wait.allowedActions,
      status: 'open',
      evaluation,
      reviewerAssignmentId: assignment.id,
    }),
  })]);
}

export function decideSponsorGate(
  state: WorkroomRunState,
  input: Readonly<SponsorGateDecisionInput>,
  event: WorkroomAcceptanceEventFactory,
): readonly WorkroomEventDraft[] {
  const gate = requireCurrentSponsorGate(state, input.gateId);
  assertWaitBinding(state, gate);
  assertAuthorized(state, gate.taskKey, gate.id, input.principalId, 'sponsor', 'decide_sponsor', input.authorization);
  if (gate.candidateHash !== input.candidateHash) {
    throw new Error('Sponsor decision is stale for the current Candidate hash');
  }
  const evaluation = requireEvaluation(gate);
  const reason = requireText(input.reason, 'Sponsor decision reason');
  if (!gate.allowedActions.includes(input.decision === 'request_changes' ? 'request_changes' : input.decision)) {
    throw new Error(`Sponsor Gate does not allow ${input.decision}`);
  }
  const decisionEvent = event('sponsor_gate.decided', {
    taskKey: gate.taskKey,
    gateId: gate.id,
    sponsorPrincipalId: input.principalId,
    authorizedBy: authorizedBy(input.authorization),
    authorization: input.authorization,
    decision: input.decision,
    reason,
    candidateHash: input.candidateHash,
  });

  if (input.decision === 'approve') {
    const reviewer = gate.reviewerAssignmentId
      ? requirePassedReviewer(state, gate.reviewerAssignmentId)
      : undefined;
    const reviewerVerdict = reviewer ? requireStoredReviewerVerdict(reviewer) : undefined;
    const record = createGatedAcceptanceRecord({
      decision: evaluation,
      sourceSequence: state.sequence + 1,
      acceptanceSequence: state.sequence + 2,
      acceptedClaimIds: reviewerVerdict?.acceptedClaimIds ?? evaluation.candidate.claimIds,
      rejectedClaimIds: reviewerVerdict?.rejectedClaimIds ?? [],
      ...(reviewer ? {
        reviewer: {
          assignmentId: reviewer.id,
          principalId: requireText(reviewer.reviewerPrincipalId, 'Reviewer principal id'),
        },
      } : {}),
      sponsor: { gateId: gate.id, principalId: input.principalId },
    });
    return Object.freeze([decisionEvent, event('task.accepted', {
      taskKey: gate.taskKey,
      reportRef: evaluation.candidate.reportRef,
      record,
    })]);
  }
  if (input.decision === 'cancel') {
    return Object.freeze([decisionEvent, event('task.cancelled', {
      taskKey: gate.taskKey,
      reason,
    })]);
  }
  return Object.freeze([decisionEvent, event('task.rework_requested', {
    taskKey: gate.taskKey,
    reason,
    evaluation,
  })]);
}

function assertAuthorized(
  state: WorkroomRunState,
  taskKey: string,
  targetId: string,
  principalId: string,
  role: WorkroomAcceptanceControlRole,
  action: WorkroomAcceptanceControlAction,
  decision: WorkroomAcceptanceAuthorizationDecision,
): void {
  const expected = {
    action, principalId, role, projectId: state.projectId, runId: state.runId,
    taskKey, targetId, expectedSequence: state.sequence,
  } as const;
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (decision[key] !== expected[key]) throw new Error(`Acceptance authorization is stale for ${key}`);
  }
  if (!decision.authorized) throw new Error(`Acceptance authority denied: ${requireText(decision.reason, 'deny reason')}`);
  requireText(decision.authorizedBy, 'authorizedBy');
}

function authorizedBy(decision: WorkroomAcceptanceAuthorizationDecision): string {
  if (!decision.authorized) throw new Error(`Acceptance authority denied: ${decision.reason}`);
  return requireText(decision.authorizedBy, 'authorizedBy');
}

function assertWaitBinding(
  state: WorkroomRunState,
  wait: WorkroomReviewerAssignmentState | WorkroomSponsorGateState,
): void {
  const task = requireTask(state, wait.taskKey);
  const evaluation = requireEvaluation(wait);
  if (task.status !== 'awaiting_acceptance' || task.revision !== wait.taskRevision) {
    throw new Error('Acceptance control target is stale for the current Task revision');
  }
  if (wait.candidateHash !== evaluation.candidate.hash
    || wait.contractId !== evaluation.contract.id
    || !samePolicy(wait.policy, evaluation.contract.policy)) {
    throw new Error('Acceptance control target does not match its Candidate, Contract or Policy');
  }
  if (!task.acceptanceContract) throw new Error('Acceptance control Task has no pinned Contract');
  assertPinnedAcceptanceContract(evaluation.contract, task.acceptanceContract);
  if (!Number.isFinite(wait.deadline) || wait.deadline <= state.now) {
    throw new Error('Acceptance control deadline has expired');
  }
}

function requireCurrentReviewer(
  state: WorkroomRunState,
  id: string,
  statuses: readonly WorkroomReviewerAssignmentState['status'][],
): WorkroomReviewerAssignmentState {
  const assignment = state.reviewerAssignments[id];
  if (!assignment || !statuses.includes(assignment.status)) {
    throw new Error(`Current Reviewer Assignment ${id} is not ${statuses.join(' or ')}`);
  }
  const task = requireTask(state, assignment.taskKey);
  if (task.currentReviewerAssignmentId !== id) throw new Error('Reviewer Assignment is not the current Task target');
  return assignment;
}

function requireCurrentSponsorGate(state: WorkroomRunState, id: string): WorkroomSponsorGateState {
  const gate = state.sponsorGates[id];
  if (!gate || gate.status !== 'open') throw new Error(`Open Sponsor Gate ${id} not found`);
  const task = requireTask(state, gate.taskKey);
  if (task.currentSponsorGateId !== id) throw new Error('Sponsor Gate is not the current Task target');
  return gate;
}

function requirePassedReviewer(state: WorkroomRunState, id: string): WorkroomReviewerAssignmentState {
  const reviewer = state.reviewerAssignments[id];
  if (!reviewer || reviewer.status !== 'passed') throw new Error('Sponsor Gate is missing a passed Reviewer verdict');
  return reviewer;
}

function requireStoredReviewerVerdict(reviewer: WorkroomReviewerAssignmentState): ReviewerVerdict {
  const value = reviewer.verdict as Partial<ReviewerVerdict> | undefined;
  if (!value
    || typeof value.candidateHash !== 'string'
    || !Array.isArray(value.criteria)
    || !Array.isArray(value.acceptedClaimIds)
    || !Array.isArray(value.rejectedClaimIds)
    || !Array.isArray(value.evidenceRefs)) {
    throw new Error('Passed Reviewer Assignment is missing its typed verdict');
  }
  return value as ReviewerVerdict;
}

function requireTask(state: WorkroomRunState, key: string): WorkroomTaskState {
  const task = state.tasks[key];
  if (!task) throw new Error(`Task ${key} not found`);
  return task;
}

function requireEvaluation(
  wait: WorkroomReviewerAssignmentState | WorkroomSponsorGateState,
): WorkroomAcceptanceDecision {
  if (!wait.evaluation) throw new Error('Acceptance control target is missing its pinned evaluation');
  return wait.evaluation;
}

function assertVerdictBindings(decision: WorkroomAcceptanceDecision, verdict: ReviewerVerdict): void {
  if (verdict.candidateHash !== decision.candidate.hash) {
    throw new Error('Reviewer verdict is stale for the current Candidate hash');
  }
  assertExactIds(verdict.criteria.map(item => item.criterionId), decision.contract.criteria.map(item => item.id), 'criteria');
  assertExactIds(
    [...verdict.acceptedClaimIds, ...verdict.rejectedClaimIds],
    decision.candidate.claimIds,
    'claims',
  );
  if (verdict.acceptedClaimIds.some(id => verdict.rejectedClaimIds.includes(id))) {
    throw new Error('Reviewer verdict cannot both accept and reject a claim');
  }
  for (const criterion of verdict.criteria) {
    if (criterion.status === 'passed' && criterion.evidenceRefs.length === 0) {
      throw new Error(`Passed criterion ${criterion.criterionId} requires evidence`);
    }
    assertUniqueText(criterion.evidenceRefs, `criterion ${criterion.criterionId} evidence`);
  }
  assertUniqueText(verdict.evidenceRefs, 'Reviewer verdict evidence');
}

function requireNextSponsorWait(
  state: WorkroomRunState,
  decision: WorkroomAcceptanceDecision,
): WorkroomAcceptanceWaitRequest {
  const wait = decision.nextWait;
  if (!wait || !wait.owner.trim() || wait.deadline <= state.now) {
    throw new Error('Reviewer-then-Sponsor route requires a current Sponsor wait');
  }
  for (const action of ['approve', 'reject', 'request_changes', 'cancel'] as const) {
    if (!wait.allowedActions.includes(action)) throw new Error(`Sponsor wait is missing ${action}`);
  }
  return wait;
}

function freezeVerdict(value: ReviewerVerdict): ReviewerVerdict {
  return Object.freeze({
    ...value,
    criteria: Object.freeze(value.criteria.map(item => Object.freeze({
      ...item,
      evidenceRefs: Object.freeze([...item.evidenceRefs]),
    }))),
    acceptedClaimIds: Object.freeze([...value.acceptedClaimIds]),
    rejectedClaimIds: Object.freeze([...value.rejectedClaimIds]),
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  });
}

function freezeSponsorGate(value: WorkroomSponsorGateState): WorkroomSponsorGateState {
  return Object.freeze({
    ...value,
    policy: Object.freeze({ ...value.policy }),
    allowedActions: Object.freeze([...value.allowedActions]),
  });
}

function reviewerFailureReason(verdict: ReviewerVerdict): string {
  const failed = verdict.criteria.filter(item => item.status !== 'passed').map(item => item.criterionId);
  return `Reviewer requested rework for criteria: ${failed.join(', ')}`;
}

function requiresReviewerRework(verdict: ReviewerVerdict): boolean {
  return verdict.criteria.some(item => item.status !== 'passed');
}

function samePolicy(left: WorkroomAcceptancePolicySnapshot, right: WorkroomAcceptancePolicySnapshot): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function assertExactIds(actual: readonly string[], expected: readonly string[], label: string): void {
  assertUniqueText(actual, `Reviewer verdict ${label}`);
  if (actual.length !== expected.length || actual.some(id => !expected.includes(id))) {
    throw new Error(`Reviewer verdict must disposition every ${label.slice(0, -1)}`);
  }
}

function assertUniqueText(values: readonly string[], label: string): void {
  for (const value of values) requireText(value, label);
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
