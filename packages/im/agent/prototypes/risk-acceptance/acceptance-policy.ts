/**
 * PROTOTYPE — delete after decision-map ticket #7 is absorbed.
 *
 * A replayable acceptance policy. Model agents may submit candidates and
 * recommendations; only this policy projection may accept/authorize them.
 */

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export type CandidateKind = 'task_result' | 'integration_candidate' | 'effect_intent';
export type CandidatePhase =
  | 'awaiting_checks'
  | 'awaiting_review'
  | 'awaiting_sponsor'
  | 'gate_expired'
  | 'accepted'
  | 'authorized'
  | 'rework'
  | 'policy_blocked'
  | 'cancelled'
  | 'stale';
export type AcceptanceRoute =
  | 'auto_accept'
  | 'reviewer_required'
  | 'sponsor_required'
  | 'reviewer_then_sponsor'
  | 'rework'
  | 'policy_blocked';

export interface Principal {
  readonly id: string;
  readonly role: 'executor' | 'orchestrator' | 'reviewer' | 'sponsor' | 'check_runner' | 'kernel';
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly kind: 'deterministic' | 'judgment';
  readonly description: string;
}

export interface AcceptanceContract {
  readonly id: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly kind: CandidateKind;
  readonly policyId: string;
  readonly criteria: readonly AcceptanceCriterion[];
  readonly requiredEvidence: readonly string[];
}

export interface RiskFacts {
  readonly effect: 'none' | 'isolated_local' | 'canonical_write' | 'external';
  readonly reversibility: 'discard_only' | 'compensatable' | 'irreversible';
  readonly dataClass: 'public' | 'internal' | 'sensitive' | 'restricted';
  readonly blastRadius: 'assignment' | 'project' | 'external';
  readonly capabilityTags: readonly string[];
  readonly unknowns: readonly string[];
}

export interface Candidate {
  readonly id: string;
  readonly contractId: string;
  readonly producerAssignmentId: string;
  readonly producerAgentId: string;
  readonly hash: string;
  readonly claimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface RiskAssessment {
  readonly id: string;
  readonly candidateHash: string;
  readonly facts: RiskFacts;
  readonly assessor: string;
  readonly sourceRefs: readonly string[];
}

export interface CheckResult {
  readonly id: string;
  readonly criterionId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'expired';
  readonly candidateHash: string;
  readonly runner: string;
  readonly runnerVersion: string;
  readonly evidenceRefs: readonly string[];
}

export interface ReviewVerdict {
  readonly reviewerAssignmentId: string;
  readonly reviewerAgentId: string;
  readonly candidateHash: string;
  readonly criteria: Readonly<Record<string, 'passed' | 'failed' | 'needs_evidence'>>;
  readonly acceptedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PolicySnapshot {
  readonly id: string;
  readonly reviewerDeadlineMs: number;
  readonly sponsorDeadlineMs: number;
  readonly additionalReviewerTiers: readonly RiskTier[];
  readonly additionalSponsorTiers: readonly RiskTier[];
  readonly deniedCapabilityTags: readonly string[];
}

export interface ReviewerAssignment {
  readonly id: string;
  readonly candidateId: string;
  readonly producerAgentId: string;
  readonly deadline: number;
  readonly status: 'unclaimed' | 'running' | 'passed' | 'rework' | 'expired' | 'cancelled' | 'stale';
  readonly ownerAgentId?: string;
}

export interface SponsorGate {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateHash: string;
  readonly contractId: string;
  readonly policyId: string;
  readonly ownerRole: 'sponsor';
  readonly deadline: number;
  readonly allowedActions: readonly ('approve' | 'reject' | 'request_changes' | 'cancel')[];
  readonly status: 'open' | 'approved' | 'rejected' | 'changes_requested' | 'expired' | 'cancelled' | 'stale';
}

export interface AcceptanceRecord {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateHash: string;
  readonly contractId: string;
  readonly policyId: string;
  readonly riskTier: RiskTier;
  readonly route: AcceptanceRoute;
  readonly disposition: 'accepted' | 'authorized';
  readonly acceptedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly checkResultIds: readonly string[];
  readonly reviewerAssignmentId?: string;
  readonly sponsorGateId?: string;
  readonly decidedBy: string;
}

export interface CandidateDecision {
  readonly candidate: Candidate;
  readonly phase: CandidatePhase;
  readonly riskTier?: RiskTier;
  readonly route?: AcceptanceRoute;
  readonly reason?: string;
  readonly checkResults: Readonly<Record<string, CheckResult>>;
  readonly riskAssessment?: RiskAssessment;
  readonly reviewerAssignmentId?: string;
  readonly sponsorGateId?: string;
  readonly acceptanceId?: string;
  readonly reviewedAcceptedClaimIds?: readonly string[];
  readonly reviewedRejectedClaimIds?: readonly string[];
}

export interface AcceptanceState {
  readonly sequence: number;
  readonly now: number;
  readonly policies: Readonly<Record<string, PolicySnapshot>>;
  readonly contracts: Readonly<Record<string, AcceptanceContract>>;
  readonly candidates: Readonly<Record<string, CandidateDecision>>;
  readonly reviewerAssignments: Readonly<Record<string, ReviewerAssignment>>;
  readonly sponsorGates: Readonly<Record<string, SponsorGate>>;
  readonly records: Readonly<Record<string, AcceptanceRecord>>;
}

export type AcceptanceEvent = Readonly<{
  seq: number;
  at: number;
  type:
    | 'policy.registered'
    | 'contract.registered'
    | 'candidate.submitted'
    | 'risk.assessed'
    | 'check.recorded'
    | 'policy.evaluated'
    | 'reviewer.assigned'
    | 'reviewer.claimed'
    | 'reviewer.verdict_recorded'
    | 'reviewer.expired'
    | 'sponsor_gate.opened'
    | 'sponsor_gate.decided'
    | 'sponsor_gate.expired'
    | 'candidate.accepted'
    | 'effect.authorized'
    | 'candidate.rework_requested'
    | 'candidate.policy_blocked'
    | 'candidate.cancelled'
    | 'candidate.superseded'
    | 'clock.advanced';
  payload: Readonly<Record<string, unknown>>;
}>;

export type AcceptanceCommand =
  | Readonly<{ type: 'register_policy'; actor: Principal; policy: PolicySnapshot }>
  | Readonly<{ type: 'register_contract'; contract: AcceptanceContract }>
  | Readonly<{ type: 'submit_candidate'; actor: Principal; candidate: Candidate }>
  | Readonly<{ type: 'record_risk'; actor: Principal; candidateId: string; assessment: RiskAssessment }>
  | Readonly<{ type: 'record_check'; actor: Principal; candidateId: string; result: CheckResult }>
  | Readonly<{ type: 'evaluate'; actor: Principal; candidateId: string }>
  | Readonly<{ type: 'claim_review'; actor: Principal; candidateId: string }>
  | Readonly<{ type: 'submit_review'; actor: Principal; candidateId: string; verdict: ReviewVerdict }>
  | Readonly<{
      type: 'sponsor_decide'; actor: Principal; gateId: string; candidateHash: string;
      decision: 'approve' | 'reject' | 'request_changes' | 'cancel'; reason: string;
    }>
  | Readonly<{ type: 'advance_clock'; actor: Principal; now: number }>
  | Readonly<{ type: 'reopen_gate'; actor: Principal; candidateId: string }>
  | Readonly<{ type: 'reassign_reviewer'; actor: Principal; candidateId: string }>
  | Readonly<{ type: 'cancel_candidate'; actor: Principal; candidateId: string; reason: string }>
  | Readonly<{ type: 'supersede_candidate'; actor: Principal; candidateId: string; replacementCandidateId: string }>;

type EventDraft = Omit<AcceptanceEvent, 'seq' | 'at'>;

export function initialAcceptanceJournal(
  policy: PolicySnapshot = {
    id: 'risk-policy-v1',
    reviewerDeadlineMs: 60_000,
    sponsorDeadlineMs: 120_000,
    additionalReviewerTiers: [],
    additionalSponsorTiers: [],
    deniedCapabilityTags: [],
  },
  now = 1_000,
): readonly AcceptanceEvent[] {
  return [Object.freeze({ seq: 0, at: now, type: 'policy.registered', payload: { policy } })];
}

export function dispatchAcceptance(
  journal: readonly AcceptanceEvent[],
  command: AcceptanceCommand,
): readonly AcceptanceEvent[] {
  const state = replayAcceptance(journal);
  const drafts = decide(state, command);
  return Object.freeze([
    ...journal,
    ...drafts.map((draft, index) => Object.freeze({
      ...draft,
      seq: journal.length + index,
      at: command.type === 'advance_clock' ? command.now : state.now,
    })),
  ]);
}

export function replayAcceptance(events: readonly AcceptanceEvent[]): AcceptanceState {
  if (events[0]?.type !== 'policy.registered' || events[0].seq !== 0) {
    throw new Error('acceptance journal must begin with policy.registered');
  }
  let state: AcceptanceState = {
    sequence: -1,
    now: events[0].at,
    policies: {},
    contracts: {},
    candidates: {},
    reviewerAssignments: {},
    sponsorGates: {},
    records: {},
  };
  for (const entry of events) {
    if (entry.seq !== state.sequence + 1) throw new Error('acceptance journal sequence is not contiguous');
    state = evolve(state, entry);
  }
  return state;
}

export function classifyRisk(facts: RiskFacts): RiskTier {
  let score = 0;
  const raise = (tier: RiskTier): void => { score = Math.max(score, ['low', 'medium', 'high', 'critical'].indexOf(tier)); };
  if (facts.effect === 'canonical_write') raise('medium');
  if (facts.effect === 'external') raise('high');
  if (facts.reversibility === 'compensatable') raise('medium');
  if (facts.reversibility === 'irreversible') raise('high');
  if (facts.dataClass === 'sensitive') raise('high');
  if (facts.dataClass === 'restricted') raise('critical');
  if (facts.blastRadius === 'project') raise('medium');
  if (facts.blastRadius === 'external') raise('high');
  if (facts.capabilityTags.some(tag => ['deploy', 'send', 'publish', 'payment', 'credential_write'].includes(tag))) raise('high');
  if (facts.capabilityTags.includes('payment')) raise('critical');
  if (facts.unknowns.length > 0) raise('critical');
  return (['low', 'medium', 'high', 'critical'] as const)[score]!;
}

function decide(state: AcceptanceState, command: AcceptanceCommand): readonly EventDraft[] {
  switch (command.type) {
    case 'register_policy': {
      if (command.actor.role !== 'kernel') throw new Error('only Kernel may register a policy snapshot');
      if (state.policies[command.policy.id]) throw new Error('policy snapshot already exists');
      return [event('policy.registered', { policy: command.policy })];
    }
    case 'register_contract': {
      if (state.contracts[command.contract.id]) throw new Error('acceptance contract already exists');
      if (!state.policies[command.contract.policyId]) throw new Error('acceptance contract references an unknown policy snapshot');
      if (command.contract.criteria.length === 0) throw new Error('acceptance contract requires explicit criteria');
      return [event('contract.registered', { contract: command.contract })];
    }
    case 'submit_candidate': {
      if (command.actor.role !== 'executor') throw new Error('only an Executor Assignment may submit a candidate');
      if (command.actor.id !== command.candidate.producerAgentId) throw new Error('candidate producer does not match authenticated principal');
      if (state.candidates[command.candidate.id]) throw new Error('candidate already exists');
      requireContract(state, command.candidate.contractId);
      return [event('candidate.submitted', { candidate: command.candidate })];
    }
    case 'record_risk': {
      if (command.actor.role !== 'kernel') throw new Error('only Kernel may record trusted Risk Facts');
      const decision = requireCandidate(state, command.candidateId, ['awaiting_checks', 'policy_blocked']);
      if (command.assessment.candidateHash !== decision.candidate.hash) throw new Error('Risk Assessment is stale for this candidate hash');
      if (command.assessment.assessor !== command.actor.id) throw new Error('risk assessor does not match authenticated principal');
      const contract = requireContract(state, decision.candidate.contractId);
      if (contract.kind === 'effect_intent' && command.assessment.facts.effect !== 'external') {
        throw new Error('effect intent Risk Assessment must declare an external effect');
      }
      return [event('risk.assessed', { candidateId: command.candidateId, assessment: command.assessment })];
    }
    case 'record_check': {
      if (command.actor.role !== 'check_runner') throw new Error('only a trusted check runner may record deterministic results');
      const decision = requireCandidate(state, command.candidateId, ['awaiting_checks', 'policy_blocked']);
      const contract = requireContract(state, decision.candidate.contractId);
      const criterion = contract.criteria.find(item => item.id === command.result.criterionId);
      if (!criterion || criterion.kind !== 'deterministic') throw new Error('check result does not match a deterministic criterion');
      if (command.result.candidateHash !== decision.candidate.hash) throw new Error('check result is stale for this candidate hash');
      if (command.result.runner !== command.actor.id) throw new Error('check runner does not match authenticated principal');
      return [event('check.recorded', { candidateId: command.candidateId, result: command.result })];
    }
    case 'evaluate': {
      if (command.actor.role === 'executor') throw new Error('Executor cannot accept or evaluate its own result');
      if (command.actor.role !== 'orchestrator' && command.actor.role !== 'kernel') {
        throw new Error('only the Orchestrator control plane may request policy evaluation');
      }
      const decision = requireCandidate(state, command.candidateId, ['awaiting_checks', 'policy_blocked', 'gate_expired']);
      return evaluateCandidate(state, decision);
    }
    case 'submit_review': {
      if (command.actor.role !== 'reviewer') throw new Error('review verdict requires Reviewer authority');
      const decision = requireCandidate(state, command.candidateId, ['awaiting_review']);
      const assignment = state.reviewerAssignments[decision.reviewerAssignmentId ?? ''];
      if (!assignment || assignment.status !== 'running') throw new Error('claimed Reviewer Assignment not found');
      if (assignment.ownerAgentId !== command.actor.id) throw new Error('review verdict does not match Reviewer lease owner');
      if (command.verdict.reviewerAssignmentId !== assignment.id || command.verdict.reviewerAgentId !== command.actor.id) {
        throw new Error('review verdict does not match authenticated Reviewer Assignment');
      }
      if (command.verdict.candidateHash !== decision.candidate.hash) throw new Error('review verdict is stale for this candidate hash');
      return decideReview(state, decision, command.verdict);
    }
    case 'claim_review': {
      if (command.actor.role !== 'reviewer') throw new Error('Reviewer Assignment requires Reviewer authority');
      const decision = requireCandidate(state, command.candidateId, ['awaiting_review']);
      const assignment = state.reviewerAssignments[decision.reviewerAssignmentId ?? ''];
      if (!assignment || assignment.status !== 'unclaimed') throw new Error('unclaimed Reviewer Assignment not found');
      if (command.actor.id === assignment.producerAgentId) throw new Error('producer and Reviewer must be different principals');
      return [event('reviewer.claimed', { assignmentId: assignment.id, ownerAgentId: command.actor.id })];
    }
    case 'sponsor_decide': {
      if (command.actor.role !== 'sponsor') throw new Error('Sponsor Gate requires Sponsor authority');
      const gate = state.sponsorGates[command.gateId];
      if (!gate || gate.status !== 'open') throw new Error('open Sponsor Gate not found');
      if (gate.candidateHash !== command.candidateHash) throw new Error('Sponsor approval is not bound to the current candidate hash');
      const decision = requireCandidate(state, gate.candidateId, ['awaiting_sponsor']);
      return decideSponsor(state, decision, gate, command.actor, command.decision, command.reason);
    }
    case 'advance_clock': {
      if (command.actor.role !== 'kernel') throw new Error('only Kernel clock may advance gate deadlines');
      if (command.now <= state.now) throw new Error('clock must advance');
      const drafts: EventDraft[] = [event('clock.advanced', { now: command.now })];
      for (const gate of Object.values(state.sponsorGates)) {
        if (gate.status === 'open' && gate.deadline <= command.now) drafts.push(event('sponsor_gate.expired', { gateId: gate.id, candidateId: gate.candidateId }));
      }
      for (const assignment of Object.values(state.reviewerAssignments)) {
        if ((assignment.status === 'unclaimed' || assignment.status === 'running') && assignment.deadline <= command.now) {
          drafts.push(event('reviewer.expired', { assignmentId: assignment.id, candidateId: assignment.candidateId }));
          drafts.push(event('candidate.policy_blocked', {
            candidateId: assignment.candidateId,
            route: 'policy_blocked',
            reason: 'Reviewer deadline expired; reassign, replan or cancel',
          }));
        }
      }
      return drafts;
    }
    case 'reopen_gate': {
      if (command.actor.role !== 'orchestrator') throw new Error('only Orchestrator may request a replacement gate');
      const decision = requireCandidate(state, command.candidateId, ['gate_expired']);
      return [openSponsorGate(state, decision)];
    }
    case 'reassign_reviewer': {
      if (command.actor.role !== 'orchestrator') throw new Error('only Orchestrator may request a replacement Reviewer');
      const decision = requireCandidate(state, command.candidateId, ['policy_blocked']);
      const prior = state.reviewerAssignments[decision.reviewerAssignmentId ?? ''];
      if (!prior || prior.status !== 'expired') throw new Error('candidate has no expired Reviewer Assignment');
      const contract = requireContract(state, decision.candidate.contractId);
      const policy = requirePolicy(state, contract.policyId);
      return [event('reviewer.assigned', {
        assignment: {
          id: `review:${decision.candidate.id}:${state.sequence + 1}`,
          candidateId: decision.candidate.id,
          producerAgentId: decision.candidate.producerAgentId,
          deadline: state.now + policy.reviewerDeadlineMs,
          status: 'unclaimed',
        } satisfies ReviewerAssignment,
      })];
    }
    case 'cancel_candidate': {
      if (command.actor.role !== 'orchestrator' && command.actor.role !== 'sponsor') throw new Error('cancel requires control authority');
      requireCandidate(state, command.candidateId, ['awaiting_checks', 'awaiting_review', 'awaiting_sponsor', 'gate_expired', 'policy_blocked', 'rework']);
      return [event('candidate.cancelled', { candidateId: command.candidateId, reason: command.reason })];
    }
    case 'supersede_candidate': {
      if (command.actor.role !== 'orchestrator') throw new Error('candidate supersession requires Orchestrator control authority');
      const current = requireCandidate(state, command.candidateId, ['awaiting_checks', 'awaiting_review', 'awaiting_sponsor', 'gate_expired', 'policy_blocked', 'rework']);
      const replacement = requireCandidate(state, command.replacementCandidateId, ['awaiting_checks']);
      if (current.candidate.id === replacement.candidate.id) throw new Error('candidate cannot supersede itself');
      if (current.candidate.contractId !== replacement.candidate.contractId) throw new Error('replacement must use the same contract revision');
      return [event('candidate.superseded', { candidateId: current.candidate.id, replacementId: replacement.candidate.id })];
    }
  }
}

function evaluateCandidate(state: AcceptanceState, decision: CandidateDecision): readonly EventDraft[] {
  const contract = requireContract(state, decision.candidate.contractId);
  const policy = requirePolicy(state, contract.policyId);
  if (!decision.riskAssessment) {
    return [
      event('policy.evaluated', { candidateId: decision.candidate.id, route: 'policy_blocked', riskTier: 'critical' }),
      event('candidate.policy_blocked', { candidateId: decision.candidate.id, route: 'policy_blocked', reason: 'trusted Risk Assessment missing' }),
    ];
  }
  const riskFacts = decision.riskAssessment.facts;
  const deterministic = contract.criteria.filter(item => item.kind === 'deterministic');
  const missing = deterministic.filter(item => !decision.checkResults[item.id]);
  const missingEvidence = contract.requiredEvidence.filter(ref => !decision.candidate.evidenceRefs.includes(ref));
  const invalid = deterministic.filter(item => {
    const result = decision.checkResults[item.id];
    return result && result.status !== 'passed';
  });
  if (invalid.length > 0) {
    return [
      event('policy.evaluated', { candidateId: decision.candidate.id, route: 'rework', riskTier: classifyRisk(riskFacts) }),
      event('candidate.rework_requested', { candidateId: decision.candidate.id, reason: `deterministic checks failed: ${invalid.map(item => item.id).join(', ')}` }),
    ];
  }
  const deniedCapabilities = riskFacts.capabilityTags.filter(tag => policy.deniedCapabilityTags.includes(tag));
  if (missing.length > 0 || missingEvidence.length > 0 || riskFacts.unknowns.length > 0 || deniedCapabilities.length > 0) {
    const reason = missing.length > 0
      ? `required checks missing: ${missing.map(item => item.id).join(', ')}`
      : missingEvidence.length > 0
        ? `required evidence missing: ${missingEvidence.join(', ')}`
        : deniedCapabilities.length > 0
          ? `capabilities denied by policy: ${deniedCapabilities.join(', ')}`
          : `risk facts incomplete: ${riskFacts.unknowns.join(', ')}`;
    return [
      event('policy.evaluated', { candidateId: decision.candidate.id, route: 'policy_blocked', riskTier: classifyRisk(riskFacts) }),
      event('candidate.policy_blocked', { candidateId: decision.candidate.id, route: 'policy_blocked', reason }),
    ];
  }

  const riskTier = classifyRisk(riskFacts);
  const needsReview = riskTier === 'medium'
    || contract.criteria.some(item => item.kind === 'judgment')
    || policy.additionalReviewerTiers.includes(riskTier);
  const needsSponsor = riskTier === 'high'
    || riskTier === 'critical'
    || policy.additionalSponsorTiers.includes(riskTier);
  const route: AcceptanceRoute = needsReview && needsSponsor
    ? 'reviewer_then_sponsor'
    : needsReview
      ? 'reviewer_required'
      : needsSponsor
        ? 'sponsor_required'
        : 'auto_accept';
  const drafts: EventDraft[] = [event('policy.evaluated', { candidateId: decision.candidate.id, route, riskTier })];
  if (needsReview) {
    drafts.push(event('reviewer.assigned', {
      assignment: {
        id: `review:${decision.candidate.id}:${state.sequence + drafts.length + 1}`,
        candidateId: decision.candidate.id,
        producerAgentId: decision.candidate.producerAgentId,
        deadline: state.now + policy.reviewerDeadlineMs,
        status: 'unclaimed',
      } satisfies ReviewerAssignment,
    }));
  } else if (needsSponsor) {
    drafts.push(openSponsorGate(state, { ...decision, riskTier, route }));
  } else {
    drafts.push(acceptEvent(state, decision, riskTier, route, undefined, undefined, decision.candidate.claimIds, []));
  }
  return drafts;
}

function decideReview(
  state: AcceptanceState,
  decision: CandidateDecision,
  verdict: ReviewVerdict,
): readonly EventDraft[] {
  const contract = requireContract(state, decision.candidate.contractId);
  const judgmentCriteria = contract.criteria.filter(item => item.kind === 'judgment');
  const missing = judgmentCriteria.filter(item => verdict.criteria[item.id] === undefined);
  if (missing.length > 0) throw new Error(`review verdict omitted criteria: ${missing.map(item => item.id).join(', ')}`);
  const unknownClaims = [...verdict.acceptedClaimIds, ...verdict.rejectedClaimIds]
    .filter(id => !decision.candidate.claimIds.includes(id));
  if (unknownClaims.length > 0) throw new Error(`review verdict references unknown claims: ${unknownClaims.join(', ')}`);
  const duplicateClaims = verdict.acceptedClaimIds.filter(id => verdict.rejectedClaimIds.includes(id));
  if (duplicateClaims.length > 0) throw new Error(`claim cannot be both accepted and rejected: ${duplicateClaims.join(', ')}`);
  const omittedClaims = decision.candidate.claimIds.filter(id => !verdict.acceptedClaimIds.includes(id) && !verdict.rejectedClaimIds.includes(id));
  if (omittedClaims.length > 0) throw new Error(`review verdict omitted claims: ${omittedClaims.join(', ')}`);
  const failed = Object.values(verdict.criteria).some(value => value !== 'passed');
  const drafts: EventDraft[] = [event('reviewer.verdict_recorded', { candidateId: decision.candidate.id, verdict, outcome: failed ? 'rework' : 'passed' })];
  if (failed) {
    drafts.push(event('candidate.rework_requested', { candidateId: decision.candidate.id, reason: 'Reviewer requested changes or evidence' }));
    return drafts;
  }
  if (decision.route === 'reviewer_then_sponsor') {
    drafts.push(openSponsorGate(state, decision));
  } else {
    drafts.push(acceptEvent(
      state,
      decision,
      decision.riskTier ?? classifyRisk(requireRiskAssessment(decision).facts),
      decision.route ?? 'reviewer_required',
      verdict.reviewerAssignmentId,
      undefined,
      verdict.acceptedClaimIds,
      verdict.rejectedClaimIds,
    ));
  }
  return drafts;
}

function decideSponsor(
  state: AcceptanceState,
  decision: CandidateDecision,
  gate: SponsorGate,
  sponsor: Principal,
  outcome: 'approve' | 'reject' | 'request_changes' | 'cancel',
  reason: string,
): readonly EventDraft[] {
  const drafts: EventDraft[] = [event('sponsor_gate.decided', { gateId: gate.id, candidateId: decision.candidate.id, outcome, sponsorId: sponsor.id, reason })];
  if (outcome === 'cancel') drafts.push(event('candidate.cancelled', { candidateId: decision.candidate.id, reason }));
  else if (outcome === 'reject' || outcome === 'request_changes') drafts.push(event('candidate.rework_requested', { candidateId: decision.candidate.id, reason }));
  else {
    const dispositionEvent = acceptEvent(
      state,
      decision,
      decision.riskTier ?? classifyRisk(requireRiskAssessment(decision).facts),
      decision.route ?? 'sponsor_required',
      decision.reviewerAssignmentId,
      gate.id,
      decision.reviewedAcceptedClaimIds ?? decision.candidate.claimIds,
      decision.reviewedRejectedClaimIds ?? [],
    );
    drafts.push(dispositionEvent);
  }
  return drafts;
}

function openSponsorGate(state: AcceptanceState, decision: CandidateDecision): EventDraft {
  const contract = requireContract(state, decision.candidate.contractId);
  const policy = requirePolicy(state, contract.policyId);
  const gate: SponsorGate = {
    id: `gate:${decision.candidate.id}:${state.sequence + 1}`,
    candidateId: decision.candidate.id,
    candidateHash: decision.candidate.hash,
    contractId: contract.id,
    policyId: policy.id,
    ownerRole: 'sponsor',
    deadline: state.now + policy.sponsorDeadlineMs,
    allowedActions: ['approve', 'reject', 'request_changes', 'cancel'],
    status: 'open',
  };
  return event('sponsor_gate.opened', { gate });
}

function acceptEvent(
  state: AcceptanceState,
  decision: CandidateDecision,
  riskTier: RiskTier,
  route: AcceptanceRoute,
  reviewerAssignmentId: string | undefined,
  sponsorGateId: string | undefined,
  acceptedClaimIds: readonly string[],
  rejectedClaimIds: readonly string[],
): EventDraft {
  const contract = requireContract(state, decision.candidate.contractId);
  const type = contract.kind === 'effect_intent' ? 'effect.authorized' : 'candidate.accepted';
  const record: AcceptanceRecord = {
    id: `acceptance:${decision.candidate.id}:${state.sequence + 1}`,
    candidateId: decision.candidate.id,
    candidateHash: decision.candidate.hash,
    contractId: contract.id,
    policyId: contract.policyId,
    riskTier,
    route,
    disposition: contract.kind === 'effect_intent' ? 'authorized' : 'accepted',
    acceptedClaimIds,
    rejectedClaimIds,
    checkResultIds: Object.values(decision.checkResults).map(item => item.id).sort(),
    ...(reviewerAssignmentId ? { reviewerAssignmentId } : {}),
    ...(sponsorGateId ? { sponsorGateId } : {}),
    decidedBy: `acceptance-policy:${contract.policyId}`,
  };
  return event(type, { candidateId: decision.candidate.id, record });
}

function evolve(state: AcceptanceState, entry: AcceptanceEvent): AcceptanceState {
  let policies = state.policies;
  let contracts = state.contracts;
  let candidates = state.candidates;
  let reviewerAssignments = state.reviewerAssignments;
  let sponsorGates = state.sponsorGates;
  let records = state.records;
  const payload = entry.payload;
  switch (entry.type) {
    case 'policy.registered': {
      const policy = payload.policy as PolicySnapshot;
      policies = { ...policies, [policy.id]: policy };
      break;
    }
    case 'contract.registered': {
      const contract = payload.contract as AcceptanceContract;
      contracts = { ...contracts, [contract.id]: contract };
      break;
    }
    case 'candidate.submitted': {
      const candidate = payload.candidate as Candidate;
      candidates = { ...candidates, [candidate.id]: { candidate, phase: 'awaiting_checks', checkResults: {} } };
      break;
    }
    case 'risk.assessed': {
      const id = String(payload.candidateId);
      const current = candidates[id];
      if (!current) throw new Error(`candidate not found during replay: ${id}`);
      candidates = { ...candidates, [id]: { ...current, phase: 'awaiting_checks', reason: undefined, riskAssessment: payload.assessment as RiskAssessment } };
      break;
    }
    case 'check.recorded': {
      const id = String(payload.candidateId);
      const current = candidates[id]!;
      const result = payload.result as CheckResult;
      candidates = { ...candidates, [id]: { ...current, phase: 'awaiting_checks', checkResults: { ...current.checkResults, [result.criterionId]: result } } };
      break;
    }
    case 'policy.evaluated': {
      const id = String(payload.candidateId);
      candidates = { ...candidates, [id]: { ...candidates[id]!, riskTier: payload.riskTier as RiskTier, route: payload.route as AcceptanceRoute } };
      break;
    }
    case 'reviewer.assigned': {
      const assignment = payload.assignment as ReviewerAssignment;
      reviewerAssignments = { ...reviewerAssignments, [assignment.id]: assignment };
      candidates = { ...candidates, [assignment.candidateId]: { ...candidates[assignment.candidateId]!, phase: 'awaiting_review', reviewerAssignmentId: assignment.id } };
      break;
    }
    case 'reviewer.claimed': {
      const id = String(payload.assignmentId);
      const assignment = reviewerAssignments[id];
      if (!assignment) throw new Error(`Reviewer Assignment not found during replay: ${id}`);
      reviewerAssignments = { ...reviewerAssignments, [id]: { ...assignment, status: 'running', ownerAgentId: String(payload.ownerAgentId) } };
      break;
    }
    case 'reviewer.verdict_recorded': {
      const id = String(payload.candidateId);
      const current = candidates[id]!;
      const verdict = payload.verdict as ReviewVerdict;
      candidates = { ...candidates, [id]: {
        ...current,
        reviewedAcceptedClaimIds: verdict.acceptedClaimIds,
        reviewedRejectedClaimIds: verdict.rejectedClaimIds,
      } };
      const assignment = reviewerAssignments[current.reviewerAssignmentId ?? ''];
      if (assignment) reviewerAssignments = { ...reviewerAssignments, [assignment.id]: { ...assignment, status: payload.outcome === 'passed' ? 'passed' : 'rework' } };
      break;
    }
    case 'reviewer.expired': {
      const id = String(payload.assignmentId);
      const assignment = reviewerAssignments[id]!;
      reviewerAssignments = { ...reviewerAssignments, [id]: { ...assignment, status: 'expired' } };
      break;
    }
    case 'sponsor_gate.opened': {
      const gate = payload.gate as SponsorGate;
      sponsorGates = { ...sponsorGates, [gate.id]: gate };
      candidates = { ...candidates, [gate.candidateId]: { ...candidates[gate.candidateId]!, phase: 'awaiting_sponsor', sponsorGateId: gate.id } };
      break;
    }
    case 'sponsor_gate.decided': {
      const gateId = String(payload.gateId);
      const gate = sponsorGates[gateId]!;
      const status = payload.outcome === 'approve' ? 'approved' : payload.outcome === 'request_changes' ? 'changes_requested' : payload.outcome as SponsorGate['status'];
      sponsorGates = { ...sponsorGates, [gateId]: { ...gate, status } };
      break;
    }
    case 'sponsor_gate.expired': {
      const gateId = String(payload.gateId);
      const gate = sponsorGates[gateId]!;
      sponsorGates = { ...sponsorGates, [gateId]: { ...gate, status: 'expired' } };
      candidates = { ...candidates, [gate.candidateId]: { ...candidates[gate.candidateId]!, phase: 'gate_expired', reason: 'Sponsor Gate expired; re-open, revise or cancel' } };
      break;
    }
    case 'candidate.accepted':
    case 'effect.authorized': {
      const id = String(payload.candidateId);
      const record = payload.record as AcceptanceRecord;
      records = { ...records, [record.id]: record };
      candidates = { ...candidates, [id]: { ...candidates[id]!, phase: entry.type === 'effect.authorized' ? 'authorized' : 'accepted', acceptanceId: record.id } };
      break;
    }
    case 'candidate.rework_requested': {
      const id = String(payload.candidateId);
      candidates = { ...candidates, [id]: { ...candidates[id]!, phase: 'rework', reason: String(payload.reason) } };
      break;
    }
    case 'candidate.policy_blocked': {
      const id = String(payload.candidateId);
      candidates = { ...candidates, [id]: { ...candidates[id]!, phase: 'policy_blocked', reason: String(payload.reason) } };
      break;
    }
    case 'candidate.cancelled': {
      const id = String(payload.candidateId);
      const current = candidates[id]!;
      candidates = { ...candidates, [id]: { ...current, phase: 'cancelled', reason: String(payload.reason) } };
      if (current.reviewerAssignmentId) {
        const assignment = reviewerAssignments[current.reviewerAssignmentId];
        if (assignment?.status === 'unclaimed' || assignment?.status === 'running') reviewerAssignments = { ...reviewerAssignments, [assignment.id]: { ...assignment, status: 'cancelled' } };
      }
      if (current.sponsorGateId) {
        const gate = sponsorGates[current.sponsorGateId];
        if (gate?.status === 'open') sponsorGates = { ...sponsorGates, [gate.id]: { ...gate, status: 'cancelled' } };
      }
      break;
    }
    case 'candidate.superseded': {
      const id = String(payload.candidateId);
      candidates = { ...candidates, [id]: { ...candidates[id]!, phase: 'stale', reason: `superseded by ${String(payload.replacementId)}` } };
      const current = candidates[id]!;
      if (current.reviewerAssignmentId) {
        const assignment = reviewerAssignments[current.reviewerAssignmentId];
        if (assignment) reviewerAssignments = { ...reviewerAssignments, [assignment.id]: { ...assignment, status: 'stale' } };
      }
      if (current.sponsorGateId) {
        const gate = sponsorGates[current.sponsorGateId];
        if (gate) sponsorGates = { ...sponsorGates, [gate.id]: { ...gate, status: 'stale' } };
      }
      break;
    }
    case 'clock.advanced': break;
  }
  return {
    sequence: entry.seq,
    now: entry.type === 'clock.advanced' ? Number(payload.now) : Math.max(state.now, entry.at),
    policies,
    contracts,
    candidates,
    reviewerAssignments,
    sponsorGates,
    records,
  };
}

function event(type: EventDraft['type'], payload: Record<string, unknown>): EventDraft {
  return Object.freeze({ type, payload: Object.freeze(payload) });
}

function requirePolicy(state: AcceptanceState, id: string): PolicySnapshot {
  const policy = state.policies[id];
  if (!policy) throw new Error(`policy not found: ${id}`);
  return policy;
}

function requireContract(state: AcceptanceState, id: string): AcceptanceContract {
  const contract = state.contracts[id];
  if (!contract) throw new Error(`contract not found: ${id}`);
  return contract;
}

function requireCandidate(
  state: AcceptanceState,
  id: string,
  phases?: readonly CandidatePhase[],
): CandidateDecision {
  const decision = state.candidates[id];
  if (!decision) throw new Error(`candidate not found: ${id}`);
  if (phases && !phases.includes(decision.phase)) throw new Error(`candidate ${id} is ${decision.phase}`);
  return decision;
}

function requireRiskAssessment(decision: CandidateDecision): RiskAssessment {
  if (!decision.riskAssessment) throw new Error(`candidate ${decision.candidate.id} has no Risk Assessment`);
  return decision.riskAssessment;
}
