import type {
  WorkroomAssignmentState,
  WorkroomEventDraft,
  WorkroomRunState,
  WorkroomTaskState,
} from './kernel-contracts.js';

export type WorkroomRiskTier = 'low' | 'medium' | 'high' | 'critical';
export type WorkroomAcceptanceRoute =
  | 'auto_accept'
  | 'reviewer_required'
  | 'sponsor_required'
  | 'reviewer_then_sponsor'
  | 'rework'
  | 'policy_blocked';

export interface WorkroomAcceptancePolicySnapshot {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
}

export interface WorkroomAcceptanceCriterion {
  readonly id: string;
  readonly kind: 'deterministic' | 'judgment';
  readonly description: string;
}

export interface WorkroomAcceptanceContract {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly kind: 'task_result' | 'integration_candidate' | 'effect_intent';
  readonly policy: WorkroomAcceptancePolicySnapshot;
  readonly criteria: readonly WorkroomAcceptanceCriterion[];
  readonly requiredEvidence: readonly string[];
}

export interface WorkroomAcceptanceCandidate {
  readonly id: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly producerAssignmentId: string;
  readonly producerPrincipalId: string;
  readonly reportRef: string;
  readonly hash: string;
  readonly claimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface WorkroomTrustedRiskAssessment {
  readonly id: string;
  readonly candidateHash: string;
  readonly tier: WorkroomRiskTier;
  readonly factsHash: string;
  readonly assessor: string;
  readonly sourceRefs: readonly string[];
}

export interface WorkroomAcceptanceCheckResult {
  readonly id: string;
  readonly criterionId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'expired';
  readonly candidateHash: string;
  readonly runner: string;
  readonly runnerVersion: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkroomAcceptanceWaitAction =
  | 'claim'
  | 'submit_verdict'
  | 'approve'
  | 'reject'
  | 'request_changes'
  | 'reassign'
  | 'reopen'
  | 'rebase'
  | 'replan'
  | 'cancel';

export interface WorkroomAcceptanceWaitRequest {
  readonly owner: string;
  readonly deadline: number;
  readonly allowedActions: readonly WorkroomAcceptanceWaitAction[];
}

export interface WorkroomAcceptanceDecisionInput {
  readonly projectId: string;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly contract: WorkroomAcceptanceContract;
  readonly priorExpiredWait?: Readonly<{
    candidateHash: string;
    riskTier: WorkroomRiskTier;
    route: Extract<WorkroomAcceptanceRoute, 'reviewer_required' | 'sponsor_required' | 'reviewer_then_sponsor'>;
  }>;
  readonly task: Readonly<{
    key: WorkroomTaskState['key'];
    revision: WorkroomTaskState['revision'];
    reportRef: string;
  }>;
  readonly assignment: Readonly<{
    id: WorkroomAssignmentState['id'];
    owner: WorkroomAssignmentState['owner'];
    reportRef: string;
  }>;
}

export interface WorkroomAcceptanceContractPinInput {
  readonly projectId: string;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly task: Readonly<{
    key: WorkroomTaskState['key'];
    title: WorkroomTaskState['title'];
    revision: WorkroomTaskState['revision'];
  }>;
}

export interface WorkroomAcceptanceDecision {
  readonly version: 1;
  readonly disposition: 'accepted' | 'rework' | 'policy_blocked';
  readonly route: WorkroomAcceptanceRoute;
  readonly candidate: WorkroomAcceptanceCandidate;
  readonly contract: WorkroomAcceptanceContract;
  readonly riskAssessment: WorkroomTrustedRiskAssessment;
  readonly checkResults: readonly WorkroomAcceptanceCheckResult[];
  readonly acceptedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly decidedBy: string;
  readonly reason?: string;
  readonly wait?: WorkroomAcceptanceWaitRequest;
  readonly nextWait?: WorkroomAcceptanceWaitRequest;
}

export interface WorkroomAcceptanceRecord extends WorkroomAcceptanceDecision {
  readonly id: string;
  readonly sourceSequence: number;
  readonly acceptanceSequence: number;
  readonly candidateHash: string;
  readonly contractId: string;
  readonly policy: WorkroomAcceptancePolicySnapshot;
  readonly reviewerAssignmentId?: string;
  readonly reviewerPrincipalId?: string;
  readonly sponsorGateId?: string;
  readonly sponsorPrincipalId?: string;
}

/**
 * Trusted, generation-owned seam. It resolves exact refs through policy,
 * artifact, risk and check stores; callers cannot supply an acceptance result.
 */
export interface WorkroomAcceptancePolicyDecisionPort {
  pinContract(
    input: WorkroomAcceptanceContractPinInput,
  ): WorkroomAcceptanceContract | Promise<WorkroomAcceptanceContract>;
  decide(
    input: WorkroomAcceptanceDecisionInput,
  ): WorkroomAcceptanceDecision | Promise<WorkroomAcceptanceDecision>;
}

export function createAcceptanceContractPinInput(
  state: WorkroomRunState,
  taskKey: string,
): WorkroomAcceptanceContractPinInput {
  const task = state.tasks[taskKey];
  if (!task) throw new Error(`Task ${taskKey} not found`);
  if (task.status !== 'ready') throw new Error(`Task ${taskKey} is ${task.status}`);
  if (task.acceptanceContract) throw new Error(`Task ${taskKey} Acceptance Contract is already pinned`);
  return Object.freeze({
    projectId: state.projectId,
    runId: state.runId,
    expectedSequence: state.sequence,
    now: state.now,
    task: Object.freeze({ key: task.key, title: task.title, revision: task.revision }),
  });
}

export function assertAcceptanceContract(
  value: WorkroomAcceptanceContract,
  taskKey: string,
  taskRevision: number,
): void {
  requireStrings([
    value.id, value.digest, value.taskKey, value.policy.id, value.policy.digest,
  ]);
  if (value.taskKey !== taskKey || value.taskRevision !== taskRevision) {
    throw new Error('Acceptance Contract does not match the current Task revision');
  }
  if (!Number.isSafeInteger(value.taskRevision) || value.taskRevision < 1
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 1) {
    throw new Error('Task, Acceptance Contract and Policy revisions must be positive integers');
  }
  if (!['task_result', 'integration_candidate', 'effect_intent'].includes(value.kind)) {
    throw new Error('Acceptance Contract kind is invalid');
  }
  if (value.criteria.length === 0) throw new Error('Acceptance Contract requires explicit criteria');
  const ids = new Set<string>();
  for (const criterion of value.criteria) {
    requireStrings([criterion.id, criterion.description]);
    if (criterion.kind !== 'deterministic' && criterion.kind !== 'judgment') {
      throw new Error('Acceptance Contract criterion kind is invalid');
    }
    if (ids.has(criterion.id)) throw new Error('Acceptance Contract criterion IDs must be unique');
    ids.add(criterion.id);
  }
  assertUniqueStrings(value.requiredEvidence, 'required evidence refs');
}

export function createAcceptanceDecisionInput(
  state: WorkroomRunState,
  taskKey: string,
): WorkroomAcceptanceDecisionInput {
  const task = state.tasks[taskKey];
  if (!task) throw new Error(`Task ${taskKey} not found`);
  if (task.status !== 'awaiting_acceptance') throw new Error(`Task ${taskKey} is ${task.status}`);
  const review = task.currentReviewerAssignmentId
    ? state.reviewerAssignments[task.currentReviewerAssignmentId]
    : undefined;
  const sponsorGate = task.currentSponsorGateId
    ? state.sponsorGates[task.currentSponsorGateId]
    : undefined;
  if (review?.status === 'open' || sponsorGate?.status === 'open') {
    throw new Error(`Task ${taskKey} already has an open Acceptance wait`);
  }
  const expiredWait = review?.status === 'expired' ? review : sponsorGate?.status === 'expired' ? sponsorGate : undefined;
  if (!task.reportRef || !task.currentAssignmentId) {
    throw new Error(`Task ${taskKey} has no completed execution candidate`);
  }
  const assignment = state.assignments[task.currentAssignmentId];
  if (!assignment || assignment.status !== 'execution_completed' || assignment.reportRef !== task.reportRef) {
    throw new Error(`Task ${taskKey} has no matching completed Assignment`);
  }
  return Object.freeze({
    projectId: state.projectId,
    runId: state.runId,
    expectedSequence: state.sequence,
    now: state.now,
    contract: freezeAcceptanceContract(task.acceptanceContract ?? failUnpinnedContract(taskKey)),
    ...(expiredWait ? {
      priorExpiredWait: Object.freeze({
        candidateHash: expiredWait.candidateHash,
        riskTier: expiredWait.riskTier,
        route: expiredWait.route,
      }),
    } : {}),
    task: Object.freeze({ key: task.key, revision: task.revision, reportRef: task.reportRef }),
    assignment: Object.freeze({ id: assignment.id, owner: assignment.owner, reportRef: assignment.reportRef }),
  });
}

export function decideTaskAcceptance(
  input: WorkroomAcceptanceDecisionInput,
  decision: WorkroomAcceptanceDecision,
  event: (type: WorkroomEventDraft['type'], payload: Record<string, unknown>) => WorkroomEventDraft,
): readonly WorkroomEventDraft[] {
  assertDecisionBindings(input, decision);
  assertExpiredWaitContinuity(input, decision);
  if (decision.disposition === 'accepted') {
    if (decision.wait) throw new Error('Accepted decisions cannot retain an Acceptance wait');
    assertSafeAutoAcceptance(decision);
    const record = createAcceptanceRecord(input, decision);
    return [event('task.accepted', {
      taskKey: input.task.key,
      reportRef: input.task.reportRef,
      record,
    })];
  }
  const reason = requireString(decision.reason, 'acceptance decision reason');
  if (decision.disposition === 'rework') {
    if (decision.wait) throw new Error('Rework decisions cannot retain an Acceptance wait');
    if (decision.route !== 'rework') throw new Error('Rework disposition requires the rework route');
    if (!decision.checkResults.some(result => result.status !== 'passed')) {
      throw new Error('Rework requires a non-passing trusted check');
    }
    return [event('task.rework_requested', {
      taskKey: input.task.key,
      reason,
      evaluation: freezeDecision(decision),
    })];
  }
  if (decision.route === 'auto_accept' || decision.route === 'rework') {
    throw new Error('Policy-blocked disposition requires a gated or blocked route');
  }
  if (decision.route === 'reviewer_required' || decision.route === 'reviewer_then_sponsor') {
    assertGatedRouteFloor(decision);
    assertGatedAcceptancePrerequisites(decision);
    const wait = requireAcceptanceWait(input, decision.wait, 'reviewer');
    if (decision.route === 'reviewer_then_sponsor') {
      requireAcceptanceWait(input, decision.nextWait, 'sponsor');
    } else if (decision.nextWait) {
      throw new Error('Reviewer-only acceptance cannot retain an unused Sponsor wait');
    }
    return [event('reviewer.assigned', {
      taskKey: input.task.key,
      reason,
      assignment: Object.freeze({
        id: `review:${decision.candidate.id}:${input.expectedSequence + 1}`,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        candidateHash: decision.candidate.hash,
        riskTier: decision.riskAssessment.tier,
        route: decision.route,
        contractId: decision.contract.id,
        policy: Object.freeze({ ...decision.contract.policy }),
        producerPrincipalId: decision.candidate.producerPrincipalId,
        owner: wait.owner,
        deadline: wait.deadline,
        allowedActions: Object.freeze([...wait.allowedActions]),
        evaluation: freezeDecision(decision),
        status: 'open' as const,
      }),
    })];
  }
  if (decision.route === 'sponsor_required') {
    assertGatedRouteFloor(decision);
    assertGatedAcceptancePrerequisites(decision);
    const wait = requireAcceptanceWait(input, decision.wait, 'sponsor');
    if (decision.nextWait) throw new Error('Sponsor-only acceptance cannot retain an unused next wait');
    return [event('sponsor_gate.opened', {
      taskKey: input.task.key,
      reason,
      gate: Object.freeze({
        id: `sponsor:${decision.candidate.id}:${input.expectedSequence + 1}`,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        candidateHash: decision.candidate.hash,
        riskTier: decision.riskAssessment.tier,
        route: decision.route,
        contractId: decision.contract.id,
        policy: Object.freeze({ ...decision.contract.policy }),
        owner: wait.owner,
        deadline: wait.deadline,
        allowedActions: Object.freeze([...wait.allowedActions]),
        evaluation: freezeDecision(decision),
        status: 'open' as const,
      }),
    })];
  }
  if (decision.wait) throw new Error('Policy-blocked decisions cannot retain an unused Acceptance wait');
  return [event('task.acceptance_blocked', {
    taskKey: input.task.key,
    reportRef: input.task.reportRef,
    reason,
    evaluation: freezeDecision(decision),
  })];
}

function assertExpiredWaitContinuity(
  input: WorkroomAcceptanceDecisionInput,
  decision: WorkroomAcceptanceDecision,
): void {
  const prior = input.priorExpiredWait;
  if (!prior) return;
  if (decision.candidate.hash !== prior.candidateHash) {
    throw new Error('Fresh evaluation does not match the expired Acceptance wait candidate');
  }
  if (decision.disposition === 'accepted') {
    throw new Error('Fresh evaluation cannot bypass an expired Acceptance wait');
  }
  if (decision.disposition === 'rework' || decision.route === 'policy_blocked') return;
  if (RISK_RANK[decision.riskAssessment.tier] < RISK_RANK[prior.riskTier]) {
    throw new Error('Fresh evaluation cannot lower the expired Acceptance wait risk tier');
  }
  const nextHasReviewer = decision.route === 'reviewer_required'
    || decision.route === 'reviewer_then_sponsor';
  const nextHasSponsor = decision.route === 'sponsor_required'
    || decision.route === 'reviewer_then_sponsor';
  const priorNeedsReviewer = prior.route === 'reviewer_required'
    || prior.route === 'reviewer_then_sponsor';
  const priorNeedsSponsor = prior.route === 'sponsor_required'
    || prior.route === 'reviewer_then_sponsor';
  if ((priorNeedsReviewer && !nextHasReviewer) || (priorNeedsSponsor && !nextHasSponsor)) {
    throw new Error('Fresh evaluation cannot weaken an expired Acceptance route');
  }
}

const RISK_RANK: Readonly<Record<WorkroomRiskTier, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

function requireAcceptanceWait(
  input: WorkroomAcceptanceDecisionInput,
  wait: WorkroomAcceptanceWaitRequest | undefined,
  kind: 'reviewer' | 'sponsor',
): WorkroomAcceptanceWaitRequest {
  if (!wait) throw new Error('Gated acceptance requires an owner, deadline and allowed actions');
  requireStrings([wait.owner]);
  if (!Number.isFinite(wait.deadline) || wait.deadline <= input.now) {
    throw new Error('Acceptance wait deadline must be in the future');
  }
  assertUniqueStrings(wait.allowedActions, 'acceptance wait actions', true);
  const allowed = new Set<WorkroomAcceptanceWaitAction>([
    'claim', 'submit_verdict', 'approve', 'reject', 'request_changes',
    'reassign', 'reopen', 'rebase', 'replan', 'cancel',
  ]);
  if (wait.allowedActions.some(action => !allowed.has(action))) {
    throw new Error('Acceptance wait contains an unsupported action');
  }
  const required = kind === 'sponsor'
    ? ['approve', 'reject', 'request_changes', 'reopen', 'rebase', 'replan', 'cancel'] as const
    : ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const;
  if (required.some(action => !wait.allowedActions.includes(action))) {
    throw new Error('Acceptance wait is missing required recovery actions');
  }
  return wait;
}

function assertGatedRouteFloor(decision: WorkroomAcceptanceDecision): void {
  const hasReviewer = decision.route === 'reviewer_required'
    || decision.route === 'reviewer_then_sponsor';
  const hasSponsor = decision.route === 'sponsor_required'
    || decision.route === 'reviewer_then_sponsor';
  const requiresReviewer = decision.riskAssessment.tier === 'medium'
    || decision.contract.criteria.some(criterion => criterion.kind === 'judgment');
  const requiresSponsor = decision.riskAssessment.tier === 'high'
    || decision.riskAssessment.tier === 'critical';
  if (requiresReviewer && !hasReviewer) {
    throw new Error('Acceptance route cannot remove the baseline Reviewer requirement');
  }
  if (requiresSponsor && !hasSponsor) {
    throw new Error('Acceptance route cannot remove the baseline Sponsor requirement');
  }
}

function createAcceptanceRecord(
  input: WorkroomAcceptanceDecisionInput,
  decision: WorkroomAcceptanceDecision,
): WorkroomAcceptanceRecord {
  return Object.freeze({
    ...freezeDecision(decision),
    id: `acceptance:${decision.candidate.id}:${decision.candidate.hash}`,
    sourceSequence: input.expectedSequence,
    acceptanceSequence: input.expectedSequence + 1,
    candidateHash: decision.candidate.hash,
    contractId: decision.contract.id,
    policy: Object.freeze({ ...decision.contract.policy }),
  });
}

export function createGatedAcceptanceRecord(input: Readonly<{
  decision: WorkroomAcceptanceDecision;
  sourceSequence: number;
  acceptanceSequence: number;
  acceptedClaimIds: readonly string[];
  rejectedClaimIds: readonly string[];
  reviewer?: Readonly<{ assignmentId: string; principalId: string }>;
  sponsor?: Readonly<{ gateId: string; principalId: string }>;
}>): WorkroomAcceptanceRecord {
  const decision = freezeDecision({
    ...input.decision,
    disposition: 'accepted',
    acceptedClaimIds: input.acceptedClaimIds,
    rejectedClaimIds: input.rejectedClaimIds,
    wait: undefined,
    nextWait: undefined,
  });
  assertGatedAcceptanceProof(decision, input.reviewer, input.sponsor);
  return Object.freeze({
    ...decision,
    id: `acceptance:${decision.candidate.id}:${decision.candidate.hash}`,
    sourceSequence: input.sourceSequence,
    acceptanceSequence: input.acceptanceSequence,
    candidateHash: decision.candidate.hash,
    contractId: decision.contract.id,
    policy: Object.freeze({ ...decision.contract.policy }),
    ...(input.reviewer ? {
      reviewerAssignmentId: input.reviewer.assignmentId,
      reviewerPrincipalId: input.reviewer.principalId,
    } : {}),
    ...(input.sponsor ? {
      sponsorGateId: input.sponsor.gateId,
      sponsorPrincipalId: input.sponsor.principalId,
    } : {}),
  });
}

export function assertPersistedAcceptanceRecord(
  value: unknown,
  taskKey: string,
  reportRef: string,
  acceptanceSequence: number,
): asserts value is WorkroomAcceptanceRecord {
  try {
    const record = expectRecord(value);
    const candidate = expectRecord(record.candidate);
    const contract = expectRecord(record.contract);
    const policy = expectRecord(contract.policy);
    const riskAssessment = expectRecord(record.riskAssessment);
    const criteria = expectRecordArray(contract.criteria);
    const checkResults = expectRecordArray(record.checkResults);
    expectStringArray(candidate.claimIds);
    expectStringArray(candidate.evidenceRefs);
    expectStringArray(contract.requiredEvidence);
    expectStringArray(riskAssessment.sourceRefs);
    expectStringArray(record.acceptedClaimIds);
    expectStringArray(record.rejectedClaimIds);
    for (const criterion of criteria) requireStrings([criterion.id, criterion.description]);
    for (const result of checkResults) {
      expectStringArray(result.evidenceRefs);
      requireStrings([result.id, result.criterionId, result.runner, result.runnerVersion]);
    }
    if (!Number.isSafeInteger(candidate.taskRevision)) throw new Error('invalid candidate task revision');
    const decision = record as unknown as WorkroomAcceptanceDecision;
    if (decision.disposition !== 'accepted') throw new Error('invalid accepted disposition');
    if (decision.contract.kind !== 'task_result' && decision.contract.kind !== 'integration_candidate') {
      throw new Error('invalid accepted candidate kind');
    }
    const input: WorkroomAcceptanceDecisionInput = {
      projectId: 'persisted',
      runId: 'persisted',
      expectedSequence: 0,
      now: 0,
      contract: decision.contract,
      task: {
        key: taskKey,
        revision: candidate.taskRevision as number,
        reportRef,
      },
      assignment: {
        id: requireString(candidate.producerAssignmentId, 'producer Assignment id'),
        owner: requireString(candidate.producerPrincipalId, 'producer principal id'),
        reportRef,
      },
    };
    assertDecisionBindings(input, decision);
    if (decision.route === 'auto_accept') assertSafeAutoAcceptance(decision);
    else assertPersistedGatedAcceptanceProof(record, decision);
    const expectedId = `acceptance:${decision.candidate.id}:${decision.candidate.hash}`;
    if (record.id !== expectedId
      || record.sourceSequence !== acceptanceSequence - 1
      || record.acceptanceSequence !== acceptanceSequence
      || record.candidateHash !== decision.candidate.hash
      || record.contractId !== decision.contract.id) {
      throw new Error('acceptance identity is not bound to the Candidate');
    }
    const recordPolicy = expectRecord(record.policy);
    if (recordPolicy.id !== policy.id
      || recordPolicy.revision !== policy.revision
      || recordPolicy.digest !== policy.digest) {
      throw new Error('acceptance Policy snapshot does not match the Contract');
    }
  } catch (error) {
    throw new Error('Invalid Workroom Acceptance Record', { cause: error });
  }
}

function assertPersistedGatedAcceptanceProof(
  record: Record<string, unknown>,
  decision: WorkroomAcceptanceDecision,
): void {
  const reviewer = record.reviewerAssignmentId === undefined && record.reviewerPrincipalId === undefined
    ? undefined
    : {
        assignmentId: requireString(record.reviewerAssignmentId, 'Reviewer Assignment id'),
        principalId: requireString(record.reviewerPrincipalId, 'Reviewer principal id'),
      };
  const sponsor = record.sponsorGateId === undefined && record.sponsorPrincipalId === undefined
    ? undefined
    : {
        gateId: requireString(record.sponsorGateId, 'Sponsor Gate id'),
        principalId: requireString(record.sponsorPrincipalId, 'Sponsor principal id'),
      };
  assertGatedAcceptanceProof(decision, reviewer, sponsor);
}

function assertGatedAcceptanceProof(
  decision: WorkroomAcceptanceDecision,
  reviewer?: Readonly<{ assignmentId: string; principalId: string }>,
  sponsor?: Readonly<{ gateId: string; principalId: string }>,
): void {
  if (decision.route === 'auto_accept' || decision.route === 'rework' || decision.route === 'policy_blocked') {
    throw new Error('Gated Acceptance Record has an invalid route');
  }
  if ((decision.route === 'reviewer_required' || decision.route === 'reviewer_then_sponsor') && !reviewer) {
    throw new Error('Gated Acceptance Record is missing Reviewer proof');
  }
  if ((decision.route === 'sponsor_required' || decision.route === 'reviewer_then_sponsor') && !sponsor) {
    throw new Error('Gated Acceptance Record is missing Sponsor proof');
  }
  assertGatedRouteFloor(decision);
  assertGatedAcceptancePrerequisites(decision);
  if (!sameStringSet(
    [...decision.acceptedClaimIds, ...decision.rejectedClaimIds],
    decision.candidate.claimIds,
  )) {
    throw new Error('Gated acceptance must disposition every Candidate claim');
  }
  if (decision.decidedBy !== `acceptance-policy:${decision.contract.policy.id}`) {
    throw new Error('Acceptance Record decider does not match the pinned Policy snapshot');
  }
}

function assertGatedAcceptancePrerequisites(decision: WorkroomAcceptanceDecision): void {
  const results = new Map(decision.checkResults.map(result => [result.criterionId, result]));
  if (decision.contract.criteria.some(criterion =>
    criterion.kind === 'deterministic' && results.get(criterion.id)?.status !== 'passed')) {
    throw new Error('Sponsor or Reviewer cannot waive a deterministic Acceptance criterion');
  }
  if (decision.contract.requiredEvidence.some(ref => !decision.candidate.evidenceRefs.includes(ref))) {
    throw new Error('Gated acceptance is missing required evidence');
  }
}

function assertDecisionBindings(
  input: WorkroomAcceptanceDecisionInput,
  decision: WorkroomAcceptanceDecision,
): void {
  if (decision.version !== 1) throw new Error('Unsupported Acceptance Decision version');
  const candidate = decision.candidate;
  const contract = decision.contract;
  requireStrings([
    candidate.id, candidate.hash, candidate.reportRef, candidate.producerAssignmentId,
    candidate.producerPrincipalId, contract.id, contract.digest, contract.policy.id,
    contract.policy.digest, decision.riskAssessment.id, decision.riskAssessment.factsHash,
    decision.riskAssessment.assessor, decision.decidedBy,
  ]);
  if (candidate.taskKey !== input.task.key || candidate.taskRevision !== input.task.revision) {
    throw new Error('Acceptance Candidate does not match the current Task revision');
  }
  if (candidate.reportRef !== input.task.reportRef
    || candidate.producerAssignmentId !== input.assignment.id
    || candidate.producerPrincipalId !== input.assignment.owner) {
    throw new Error('Acceptance Candidate does not match the completed Assignment');
  }
  if (contract.taskKey !== input.task.key || contract.taskRevision !== input.task.revision) {
    throw new Error('Acceptance Contract does not match the current Task revision');
  }
  assertPinnedAcceptanceContract(contract, input.contract);
  if (!Number.isSafeInteger(contract.revision) || contract.revision < 1
    || !Number.isSafeInteger(contract.policy.revision) || contract.policy.revision < 1) {
    throw new Error('Acceptance Contract and Policy revisions must be positive integers');
  }
  if (decision.riskAssessment.candidateHash !== candidate.hash) {
    throw new Error('Risk Assessment is stale for the Acceptance Candidate');
  }
  assertUniqueStrings(candidate.claimIds, 'candidate claim IDs', true);
  assertUniqueStrings(candidate.evidenceRefs, 'candidate evidence refs');
  assertUniqueStrings(contract.requiredEvidence, 'required evidence refs');
  assertUniqueStrings(decision.acceptedClaimIds, 'accepted claim IDs');
  assertUniqueStrings(decision.rejectedClaimIds, 'rejected claim IDs');
  const criteria = new Set<string>();
  for (const criterion of contract.criteria) {
    requireStrings([criterion.id, criterion.description]);
    if (criteria.has(criterion.id)) throw new Error('Acceptance Contract criterion IDs must be unique');
    criteria.add(criterion.id);
  }
  if (criteria.size === 0) throw new Error('Acceptance Contract requires explicit criteria');
  const checked = new Set<string>();
  for (const result of decision.checkResults) {
    requireStrings([result.id, result.criterionId, result.runner, result.runnerVersion]);
    if (result.candidateHash !== candidate.hash) throw new Error('Check Result is stale for the Acceptance Candidate');
    if (!criteria.has(result.criterionId)) throw new Error('Check Result references an unknown criterion');
    if (checked.has(result.criterionId)) throw new Error('Acceptance Decision has duplicate criterion results');
    checked.add(result.criterionId);
  }
  const claims = new Set(candidate.claimIds);
  for (const claimId of [...decision.acceptedClaimIds, ...decision.rejectedClaimIds]) {
    if (!claims.has(claimId)) throw new Error('Acceptance Decision references an unknown claim');
  }
  if (decision.acceptedClaimIds.some(id => decision.rejectedClaimIds.includes(id))) {
    throw new Error('A claim cannot be both accepted and rejected');
  }
}

function assertSafeAutoAcceptance(decision: WorkroomAcceptanceDecision): void {
  if (decision.route !== 'auto_accept' || decision.riskAssessment.tier !== 'low') {
    throw new Error('Only low-risk candidates may use automatic acceptance');
  }
  if (decision.contract.kind === 'effect_intent') {
    throw new Error('Effect Intents require authorization, not Task acceptance');
  }
  if (decision.contract.criteria.some(criterion => criterion.kind !== 'deterministic')) {
    throw new Error('Judgment criteria require an independent Reviewer');
  }
  const results = new Map(decision.checkResults.map(result => [result.criterionId, result]));
  if (decision.contract.criteria.some(criterion => results.get(criterion.id)?.status !== 'passed')) {
    throw new Error('Automatic acceptance requires every deterministic check to pass');
  }
  if (decision.contract.requiredEvidence.some(ref => !decision.candidate.evidenceRefs.includes(ref))) {
    throw new Error('Automatic acceptance is missing required evidence');
  }
  if (!sameStringSet(decision.acceptedClaimIds, decision.candidate.claimIds)
    || decision.rejectedClaimIds.length > 0) {
    throw new Error('Automatic acceptance must disposition every Candidate claim as accepted');
  }
  if (decision.decidedBy !== `acceptance-policy:${decision.contract.policy.id}`) {
    throw new Error('Acceptance Record decider does not match the pinned Policy snapshot');
  }
}

function freezeCandidate(value: WorkroomAcceptanceCandidate): WorkroomAcceptanceCandidate {
  return Object.freeze({
    ...value,
    claimIds: Object.freeze([...value.claimIds]),
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  });
}

export function freezeAcceptanceContract(value: WorkroomAcceptanceContract): WorkroomAcceptanceContract {
  return Object.freeze({
    ...value,
    policy: Object.freeze({ ...value.policy }),
    criteria: Object.freeze(value.criteria.map(item => Object.freeze({ ...item }))),
    requiredEvidence: Object.freeze([...value.requiredEvidence]),
  });
}

function freezeRisk(value: WorkroomTrustedRiskAssessment): WorkroomTrustedRiskAssessment {
  return Object.freeze({ ...value, sourceRefs: Object.freeze([...value.sourceRefs]) });
}

function freezeChecks(values: readonly WorkroomAcceptanceCheckResult[]): readonly WorkroomAcceptanceCheckResult[] {
  return Object.freeze(values.map(value => Object.freeze({
    ...value,
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  })));
}

function freezeDecision(value: WorkroomAcceptanceDecision): WorkroomAcceptanceDecision {
  return Object.freeze({
    ...value,
    candidate: freezeCandidate(value.candidate),
    contract: freezeAcceptanceContract(value.contract),
    riskAssessment: freezeRisk(value.riskAssessment),
    checkResults: freezeChecks(value.checkResults),
    acceptedClaimIds: Object.freeze([...value.acceptedClaimIds]),
    rejectedClaimIds: Object.freeze([...value.rejectedClaimIds]),
    ...(value.wait ? {
      wait: Object.freeze({
        ...value.wait,
        allowedActions: Object.freeze([...value.wait.allowedActions]),
      }),
    } : {}),
    ...(value.nextWait ? {
      nextWait: Object.freeze({
        ...value.nextWait,
        allowedActions: Object.freeze([...value.nextWait.allowedActions]),
      }),
    } : {}),
  });
}

function requireStrings(values: readonly unknown[]): void {
  if (values.some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error('Acceptance Decision contains an empty identifier');
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function assertUniqueStrings(values: readonly string[], label: string, required = false): void {
  requireStrings(values);
  if (required && values.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value));
}

export function assertPinnedAcceptanceContract(
  actual: WorkroomAcceptanceContract,
  pinned: WorkroomAcceptanceContract,
): void {
  const matches = actual.id === pinned.id
    && actual.revision === pinned.revision
    && actual.digest === pinned.digest
    && actual.taskKey === pinned.taskKey
    && actual.taskRevision === pinned.taskRevision
    && actual.kind === pinned.kind
    && actual.policy.id === pinned.policy.id
    && actual.policy.revision === pinned.policy.revision
    && actual.policy.digest === pinned.policy.digest
    && JSON.stringify(actual.criteria) === JSON.stringify(pinned.criteria)
    && JSON.stringify(actual.requiredEvidence) === JSON.stringify(pinned.requiredEvidence);
  if (!matches) {
    throw new Error('Acceptance Decision does not match the pinned Contract and Policy snapshot');
  }
}

function failUnpinnedContract(taskKey: string): never {
  throw new Error(`Task ${taskKey} Acceptance Contract is not pinned`);
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record is required');
  return value as Record<string, unknown>;
}

function expectRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('record array is required');
  return value.map(expectRecord);
}

function expectStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('string array is required');
  }
  return value;
}
