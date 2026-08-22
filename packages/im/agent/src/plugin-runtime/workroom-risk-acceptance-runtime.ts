import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomAcceptedReportReader } from '../workroom/accepted-source-memory-application.js';
import {
  freezeAcceptanceContract,
  type WorkroomAcceptanceCheckResult,
  type WorkroomAcceptanceContractPinInput,
  type WorkroomAcceptanceCriterion,
  type WorkroomAcceptanceDecision,
  type WorkroomAcceptanceDecisionInput,
  type WorkroomAcceptancePolicyDecisionPort,
  type WorkroomAcceptancePolicySnapshot,
  type WorkroomAcceptanceRoute,
  type WorkroomRiskTier,
} from '../workroom/acceptance-policy.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface WorkroomTrustedFactSource {
  readonly sourceType: 'project-profile' | 'workflow-plan' | 'capability-snapshot' | 'artifact-header' | 'effect-intent' | 'report-header';
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly issuer: string;
  readonly policyRevision: number;
}

export interface WorkroomAcceptancePolicyFacts {
  readonly profileRef: string;
  readonly profileDigest: string;
  readonly policy: WorkroomAcceptancePolicySnapshot;
  readonly kind: 'task_result' | 'integration_candidate' | 'effect_intent';
  readonly criteria: readonly WorkroomAcceptanceCriterion[];
  readonly requiredEvidence: readonly string[];
  readonly minimumRoute: 'baseline' | 'reviewer_required' | 'sponsor_required' | 'reviewer_then_sponsor';
  readonly reviewerOwner: string;
  readonly sponsorOwner: string;
  readonly reviewerTimeoutMs: number;
  readonly sponsorTimeoutMs: number;
  readonly binding: WorkroomTrustedFactSource;
}

export interface WorkroomAcceptancePolicyFactsPort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
  }>): Promise<WorkroomAcceptancePolicyFacts>;
}

export interface WorkroomConservativeRiskDimensions {
  readonly sideEffect: 'none' | 'local' | 'external' | 'unknown';
  readonly reversibility: 'discard_only' | 'compensatable' | 'irreversible' | 'unknown';
  readonly dataClass: 'public' | 'internal' | 'confidential' | 'restricted' | 'unknown';
  readonly blastRadius: 'single_artifact' | 'project' | 'organization' | 'external' | 'unknown';
  readonly capabilityTags: readonly string[];
  readonly uncertainty: 'known' | 'unknown';
}

export interface WorkroomTrustedRiskFacts {
  readonly candidateHash: string;
  readonly facts: WorkroomConservativeRiskDimensions;
  readonly sources: readonly WorkroomTrustedFactSource[];
}

export interface WorkroomTrustedRiskFactsPort {
  assess(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    candidateHash: string;
    reportRef: string;
    reportDigest: string;
    artifactRefs: readonly string[];
    planRef: string;
    planRevision: number;
    policy: WorkroomAcceptancePolicySnapshot;
  }>): Promise<WorkroomTrustedRiskFacts>;
}

export interface WorkroomTrustedAcceptanceCheckRunnerPort {
  run(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    criterion: WorkroomAcceptanceCriterion;
    candidateHash: string;
    reportRef: string;
    evidenceRefs: readonly string[];
    policy: WorkroomAcceptancePolicySnapshot;
  }>): Promise<WorkroomAcceptanceCheckResult>;
}

export type WorkroomAcceptanceEffectState =
  | 'pending_authorization'
  | 'authorized'
  | 'committed'
  | 'failed'
  | 'outcome_unknown'
  | 'cancelled';

export interface WorkroomAcceptanceEffectStateFacts {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly candidateHash: string;
  readonly intentRef: string;
  readonly intentDigest: string;
  readonly state: WorkroomAcceptanceEffectState;
  readonly authorizationDigest?: string;
  readonly receiptDigest?: string;
}

export interface WorkroomAcceptanceEffectStatePort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    candidateHash: string;
  }>): Promise<WorkroomAcceptanceEffectStateFacts | null>;
}

export const workroomAcceptancePolicyFactsToken = createToken<WorkroomAcceptancePolicyFactsPort>(
  'zhin.agent.workroom-acceptance-policy-facts',
  'Generation/Profile-owned pinned Workroom Acceptance policy facts',
);
export const workroomTrustedRiskFactsToken = createToken<WorkroomTrustedRiskFactsPort>(
  'zhin.agent.workroom-trusted-risk-facts',
  'Trusted Plan/Capability/Artifact/Effect Workroom Risk Facts',
);
export const workroomAcceptanceCheckRunnerToken = createToken<WorkroomTrustedAcceptanceCheckRunnerPort>(
  'zhin.agent.workroom-acceptance-check-runner',
  'Trusted deterministic Workroom Acceptance check runner',
);

export interface PinnedWorkroomAcceptancePolicyOptions {
  readonly policies: WorkroomAcceptancePolicyFactsPort;
  readonly reports: WorkroomAcceptedReportReader;
  readonly risk: WorkroomTrustedRiskFactsPort;
  readonly checks: WorkroomTrustedAcceptanceCheckRunnerPort;
  readonly effects?: WorkroomAcceptanceEffectStatePort;
}

/** Pure routing policy over pinned facts. Model output never supplies risk, route, or authority. */
export class PinnedWorkroomAcceptancePolicy implements WorkroomAcceptancePolicyDecisionPort {
  constructor(readonly options: PinnedWorkroomAcceptancePolicyOptions) {}

  async pinContract(input: WorkroomAcceptanceContractPinInput) {
    const facts = validatePolicyFacts(await this.options.policies.resolve({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
    }));
    const body = deepFreeze({
      id: `acceptance-contract:${input.projectId}:${input.runId}:${input.task.key}:${input.task.revision}:${facts.policy.digest}`,
      revision: 1,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      kind: facts.kind,
      policy: facts.policy,
      criteria: facts.criteria,
      requiredEvidence: facts.requiredEvidence,
    });
    return freezeAcceptanceContract({ ...body, digest: digest(body) });
  }

  async decide(input: WorkroomAcceptanceDecisionInput): Promise<WorkroomAcceptanceDecision> {
    const facts = validatePolicyFacts(await this.options.policies.resolve({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
    }));
    assertPinnedFacts(input, facts);
    const report = await this.options.reports.read({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.task.key,
      reportRef: input.assignment.reportRef,
      candidateHash: input.assignment.candidateHash,
      purpose: 'acceptance-evaluation',
    });
    if (!report) throw new Error('Governed Workroom Task Report is unavailable for Acceptance');
    if (report.ref !== input.assignment.reportRef
      || report.candidateHash !== input.assignment.candidateHash
      || report.projectId !== input.projectId
      || report.runId !== input.runId
      || report.taskKey !== input.task.key
      || report.taskRevision !== input.task.revision) {
      throw new Error('Governed Workroom Task Report binding drift');
    }
    const claimIds = unique(report.claims.map(claim => claim.id), 'Report claim IDs');
    const evidenceRefs = unique(report.claims.flatMap(claim => claim.evidenceRefs), 'Report evidence refs');
    const artifactRefs = unique(report.claims.flatMap(claim => claim.artifactRefs), 'Report artifact refs');
    const riskFacts = validateRiskFacts(await this.options.risk.assess({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      candidateHash: input.assignment.candidateHash,
      reportRef: input.assignment.reportRef,
      reportDigest: input.assignment.reportDigest,
      artifactRefs,
      planRef: report.planRef,
      planRevision: report.planRevision,
      policy: input.contract.policy,
    }), input.assignment.candidateHash, input.contract.policy.revision);
    if (facts.kind === 'effect_intent'
      && !riskFacts.sources.some(source => source.sourceType === 'effect-intent')) {
      throw new Error('Effect Acceptance requires an exact trusted Effect Intent risk header');
    }
    const tier = assessRiskTier(riskFacts.facts);
    const riskAssessment = deepFreeze({
      id: `risk:${input.assignment.candidateHash}:${digest(riskFacts)}`,
      candidateHash: input.assignment.candidateHash,
      tier,
      factsHash: digest(riskFacts),
      assessor: 'kernel-risk-lattice:1',
      sourceRefs: Object.freeze(riskFacts.sources.map(source => source.sourceRef).sort()),
    });
    const checkResults = await Promise.all(input.contract.criteria
      .filter(criterion => criterion.kind === 'deterministic')
      .map(async criterion => validateCheckResult(await this.options.checks.run({
        projectId: input.projectId,
        runId: input.runId,
        taskKey: input.task.key,
        criterion,
        candidateHash: input.assignment.candidateHash,
        reportRef: input.assignment.reportRef,
        evidenceRefs,
        policy: input.contract.policy,
      }), criterion.id, input.assignment.candidateHash)));
    const candidate = deepFreeze({
      id: input.assignment.candidateRef,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      producerAssignmentId: input.assignment.id,
      producerPrincipalId: input.assignment.owner,
      reportRef: input.assignment.reportRef,
      hash: input.assignment.candidateHash,
      claimIds,
      evidenceRefs,
    });
    const base = {
      version: 1 as const,
      candidate,
      contract: input.contract,
      riskAssessment,
      checkResults: Object.freeze(checkResults),
      acceptedClaimIds: Object.freeze([]),
      rejectedClaimIds: Object.freeze([]),
      decidedBy: `acceptance-policy:${input.contract.policy.id}`,
    };
    const failed = checkResults.find(result => result.status === 'failed');
    if (failed) return deepFreeze({
      ...base, disposition: 'rework' as const, route: 'rework' as const,
      reason: `Trusted Acceptance check failed: ${failed.id}`,
    });
    const unavailable = checkResults.find(result => result.status === 'error' || result.status === 'expired');
    if (unavailable) return deepFreeze({
      ...base, disposition: 'policy_blocked' as const, route: 'policy_blocked' as const,
      reason: `Trusted Acceptance check unavailable: ${unavailable.id}`,
    });
    if (facts.kind === 'effect_intent') {
      if (!this.options.effects) return deepFreeze({
        ...base, disposition: 'policy_blocked' as const, route: 'policy_blocked' as const,
        reason: 'Effect Ledger acceptance state is unavailable; Effect is not committed',
      });
      const effect = validateEffectState(await this.options.effects.resolve({
        projectId: input.projectId,
        runId: input.runId,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        candidateHash: input.assignment.candidateHash,
      }), input);
      if (effect.state === 'failed') return deepFreeze({
        ...base, disposition: 'rework' as const, route: 'rework' as const,
        reason: 'Trusted Effect Ledger recorded a failed outcome',
      });
      if (effect.state !== 'committed') return deepFreeze({
        ...base, disposition: 'policy_blocked' as const, route: 'policy_blocked' as const,
        reason: effect.state === 'outcome_unknown'
          ? 'Effect outcome is unknown and requires reconciliation'
          : `Effect is ${effect.state}; only a trusted committed receipt can continue Acceptance`,
      });
    }
    const route = acceptanceRoute(tier, input.contract.criteria, facts.minimumRoute);
    if (route === 'auto_accept') return deepFreeze({
      ...base, disposition: 'accepted' as const, route,
      acceptedClaimIds: claimIds,
      rejectedClaimIds: Object.freeze([]),
    });
    const reviewer = route === 'reviewer_required' || route === 'reviewer_then_sponsor';
    const sponsor = route === 'sponsor_required' || route === 'reviewer_then_sponsor';
    return deepFreeze({
      ...base,
      disposition: 'policy_blocked' as const,
      route,
      reason: `Acceptance requires ${reviewer && sponsor ? 'Reviewer and Sponsor' : reviewer ? 'Reviewer' : 'Sponsor'}`,
      wait: reviewer
        ? reviewerWait(facts.reviewerOwner, input.now + facts.reviewerTimeoutMs)
        : sponsorWait(facts.sponsorOwner, input.now + facts.sponsorTimeoutMs),
      ...(reviewer && sponsor
        ? { nextWait: sponsorWait(facts.sponsorOwner, input.now + facts.sponsorTimeoutMs) }
        : {}),
    });
  }
}

function validateEffectState(
  value: WorkroomAcceptanceEffectStateFacts | null,
  input: WorkroomAcceptanceDecisionInput,
): WorkroomAcceptanceEffectStateFacts {
  if (!value) throw new Error('Exact Effect Intent is unavailable from the trusted Ledger');
  if (value.projectId !== input.projectId
    || value.runId !== input.runId
    || value.taskKey !== input.task.key
    || value.taskRevision !== input.task.revision
    || value.candidateHash !== input.assignment.candidateHash) {
    throw new Error('Effect Ledger Acceptance binding is stale');
  }
  required(value.intentRef, 'Effect Intent ref');
  requiredDigest(value.intentDigest, 'Effect Intent digest');
  enumValue(value.state, [
    'pending_authorization', 'authorized', 'committed', 'failed', 'outcome_unknown', 'cancelled',
  ], 'Effect Ledger Acceptance state');
  if (value.state === 'authorized' && !value.authorizationDigest) {
    throw new Error('Authorized Effect state lacks trusted Authorization digest');
  }
  if (value.state === 'committed' && (!value.authorizationDigest || !value.receiptDigest)) {
    throw new Error('Committed Effect state lacks trusted Authorization/receipt digest');
  }
  if (value.authorizationDigest) requiredDigest(value.authorizationDigest, 'Effect Authorization digest');
  if (value.receiptDigest) requiredDigest(value.receiptDigest, 'Effect receipt digest');
  return deepFreeze(value);
}

function reviewerWait(owner: string, deadline: number) {
  return deepFreeze({
    owner, deadline,
    allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
  });
}

function sponsorWait(owner: string, deadline: number) {
  return deepFreeze({
    owner, deadline,
    allowedActions: ['approve', 'reject', 'request_changes', 'reopen', 'rebase', 'replan', 'cancel'] as const,
  });
}

function acceptanceRoute(
  tier: WorkroomRiskTier,
  criteria: readonly WorkroomAcceptanceCriterion[],
  floor: WorkroomAcceptancePolicyFacts['minimumRoute'],
): Extract<WorkroomAcceptanceRoute, 'auto_accept' | 'reviewer_required' | 'sponsor_required' | 'reviewer_then_sponsor'> {
  let reviewer = tier === 'medium' || criteria.some(criterion => criterion.kind === 'judgment');
  let sponsor = tier === 'high' || tier === 'critical';
  reviewer ||= floor === 'reviewer_required' || floor === 'reviewer_then_sponsor';
  sponsor ||= floor === 'sponsor_required' || floor === 'reviewer_then_sponsor';
  return reviewer && sponsor ? 'reviewer_then_sponsor'
    : reviewer ? 'reviewer_required'
      : sponsor ? 'sponsor_required'
        : 'auto_accept';
}

export function assessRiskTier(facts: WorkroomConservativeRiskDimensions): WorkroomRiskTier {
  enumValue(facts.sideEffect, ['none', 'local', 'external', 'unknown'], 'Risk side effect');
  enumValue(facts.reversibility, ['discard_only', 'compensatable', 'irreversible', 'unknown'], 'Risk reversibility');
  enumValue(facts.dataClass, ['public', 'internal', 'confidential', 'restricted', 'unknown'], 'Risk data class');
  enumValue(facts.blastRadius, ['single_artifact', 'project', 'organization', 'external', 'unknown'], 'Risk blast radius');
  enumValue(facts.uncertainty, ['known', 'unknown'], 'Risk uncertainty');
  const tags = new Set(facts.capabilityTags);
  if (facts.uncertainty === 'unknown'
    || facts.sideEffect === 'unknown'
    || facts.reversibility === 'unknown'
    || facts.dataClass === 'unknown'
    || facts.blastRadius === 'unknown'
    || facts.reversibility === 'irreversible'
    || facts.dataClass === 'restricted'
    || tags.has('payment')) return 'critical';
  if (facts.sideEffect === 'external'
    || facts.blastRadius === 'external'
    || tags.has('deploy') || tags.has('send') || tags.has('publish')) return 'high';
  if (facts.sideEffect === 'local'
    || facts.reversibility === 'compensatable'
    || facts.dataClass === 'confidential'
    || facts.blastRadius === 'project'
    || facts.blastRadius === 'organization'
    || tags.size > 0) return 'medium';
  return 'low';
}

function validatePolicyFacts(value: WorkroomAcceptancePolicyFacts): WorkroomAcceptancePolicyFacts {
  required(value.profileRef, 'Profile ref');
  requiredDigest(value.profileDigest, 'Profile digest');
  required(value.policy?.id, 'Policy id');
  requiredDigest(value.policy?.digest, 'Policy digest');
  positive(value.policy?.revision, 'Policy revision');
  validateSource(value.binding, value.policy.revision);
  if (value.binding.sourceType !== 'project-profile') throw new Error('Acceptance Policy facts are not Profile-owned');
  if (value.binding.sourceRef !== value.profileRef
    || value.binding.sourceDigest !== value.profileDigest) {
    throw new Error('Acceptance Policy facts are not bound to the exact Profile revision');
  }
  if (!['task_result', 'integration_candidate', 'effect_intent'].includes(value.kind)) throw new Error('Acceptance candidate kind is invalid');
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) throw new Error('Acceptance Policy requires criteria');
  unique(value.criteria.map(criterion => criterion.id), 'Acceptance criterion IDs');
  for (const criterion of value.criteria) {
    required(criterion.description, `Acceptance criterion ${criterion.id} description`);
    enumValue(criterion.kind, ['deterministic', 'judgment'], `Acceptance criterion ${criterion.id} kind`);
  }
  unique(value.requiredEvidence, 'Acceptance required evidence');
  required(value.reviewerOwner, 'Reviewer owner');
  required(value.sponsorOwner, 'Sponsor owner');
  positive(value.reviewerTimeoutMs, 'Reviewer timeout');
  positive(value.sponsorTimeoutMs, 'Sponsor timeout');
  enumValue(value.minimumRoute, [
    'baseline', 'reviewer_required', 'sponsor_required', 'reviewer_then_sponsor',
  ], 'Acceptance minimum route');
  return deepFreeze(value);
}

function assertPinnedFacts(input: WorkroomAcceptanceDecisionInput, facts: WorkroomAcceptancePolicyFacts): void {
  const expected = {
    kind: facts.kind,
    policy: facts.policy,
    criteria: facts.criteria,
    requiredEvidence: facts.requiredEvidence,
  };
  const actual = {
    kind: input.contract.kind,
    policy: input.contract.policy,
    criteria: input.contract.criteria,
    requiredEvidence: input.contract.requiredEvidence,
  };
  if (canonicalWorkroomJson(actual) !== canonicalWorkroomJson(expected)) {
    throw new Error('Current Profile Acceptance facts drifted from pinned Contract');
  }
}

function validateRiskFacts(
  value: WorkroomTrustedRiskFacts,
  candidateHash: string,
  policyRevision: number,
): WorkroomTrustedRiskFacts {
  if (value.candidateHash !== candidateHash) throw new Error('Risk Facts candidate binding is stale');
  if (!value.facts || !Array.isArray(value.sources) || value.sources.length === 0) {
    throw new Error('Risk Facts require trusted source lineage');
  }
  value.sources.forEach(source => validateSource(source, policyRevision));
  if (value.sources.some(source => source.sourceType === 'project-profile'
    || source.sourceType === 'report-header')) {
    throw new Error('Risk Facts cannot be sourced from Profile or Report metadata');
  }
  unique(value.sources.map(source => source.sourceRef), 'Risk Fact source refs');
  unique(value.facts.capabilityTags, 'Risk capability tags');
  assessRiskTier(value.facts);
  return deepFreeze(value);
}

function validateSource(source: WorkroomTrustedFactSource, policyRevision: number): void {
  enumValue(source?.sourceType, [
    'project-profile', 'workflow-plan', 'capability-snapshot', 'artifact-header',
    'effect-intent', 'report-header',
  ], 'Trusted fact source type');
  required(source?.sourceRef, 'Trusted fact source ref');
  requiredDigest(source?.sourceDigest, 'Trusted fact source digest');
  required(source?.issuer, 'Trusted fact source issuer');
  if (source?.policyRevision !== policyRevision) throw new Error('Trusted fact source Policy revision drift');
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function validateCheckResult(
  result: WorkroomAcceptanceCheckResult,
  criterionId: string,
  candidateHash: string,
): WorkroomAcceptanceCheckResult {
  if (result.criterionId !== criterionId || result.candidateHash !== candidateHash) {
    throw new Error('Trusted Check Result binding drift');
  }
  required(result.id, 'Check Result id');
  required(result.runner, 'Check Result runner');
  required(result.runnerVersion, 'Check Result runner version');
  unique(result.evidenceRefs, 'Check Result evidence refs');
  if (!['passed', 'failed', 'error', 'expired'].includes(result.status)) {
    throw new Error('Trusted Check Result status is invalid');
  }
  return deepFreeze(result);
}

function unique(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const result = values.map(value => required(value, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...result].sort());
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}
