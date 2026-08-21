/** Executable acceptance scenarios for decision-map ticket #7 (not production tests). */
import assert from 'node:assert/strict';
import {
  dispatchAcceptance,
  initialAcceptanceJournal,
  replayAcceptance,
  type AcceptanceCommand,
  type AcceptanceContract,
  type AcceptanceEvent,
  type Candidate,
  type Principal,
  type RiskFacts,
} from './acceptance-policy.ts';

const executor: Principal = { id: 'agent:executor-alice', role: 'executor' };
const orchestrator: Principal = { id: 'agent:orchestrator', role: 'orchestrator' };
const reviewer: Principal = { id: 'agent:reviewer-bob', role: 'reviewer' };
const sponsor: Principal = { id: 'human:sponsor', role: 'sponsor' };
const runner: Principal = { id: 'check:ci', role: 'check_runner' };
const kernel: Principal = { id: 'workroom:kernel', role: 'kernel' };

function harness(): { dispatch: (command: AcceptanceCommand) => void; journal: () => readonly AcceptanceEvent[] } {
  let journal: readonly AcceptanceEvent[] = initialAcceptanceJournal();
  return {
    dispatch(command) { journal = dispatchAcceptance(journal, command); },
    journal: () => journal,
  };
}

function contract(id: string, kind: AcceptanceContract['kind'], judgment = false): AcceptanceContract {
  return {
    id,
    taskKey: id,
    taskRevision: 1,
    kind,
    policyId: 'risk-policy-v1',
    criteria: [
      { id: 'ci', kind: 'deterministic', description: 'Pinned CI suite passes for the candidate hash' },
      ...(judgment ? [{ id: 'quality', kind: 'judgment' as const, description: 'Domain quality meets the brief' }] : []),
    ],
    requiredEvidence: ['artifact://report'],
  };
}

function risk(overrides: Partial<RiskFacts> = {}): RiskFacts {
  return {
    effect: 'none',
    reversibility: 'discard_only',
    dataClass: 'public',
    blastRadius: 'assignment',
    capabilityTags: [],
    unknowns: [],
    ...overrides,
  };
}

function candidate(id: string, contractId: string): Candidate {
  return {
    id,
    contractId,
    producerAssignmentId: `assignment:${id}`,
    producerAgentId: executor.id,
    hash: `sha256:${id}`,
    claimIds: [`claim:${id}:verified`, `claim:${id}:commentary`],
    evidenceRefs: ['artifact://report'],
  };
}

function recordRisk(dispatch: (command: AcceptanceCommand) => void, value: Candidate, facts: RiskFacts): void {
  dispatch({
    type: 'record_risk', actor: kernel, candidateId: value.id,
    assessment: { id: `risk:${value.id}`, candidateHash: value.hash, facts, assessor: kernel.id, sourceRefs: ['plan://risk', 'capability://snapshot'] },
  });
}

function recordPassingCi(dispatch: (command: AcceptanceCommand) => void, value: Candidate): void {
  dispatch({
    type: 'record_check', actor: runner, candidateId: value.id,
    result: {
      id: `check:${value.id}:ci`, criterionId: 'ci', status: 'passed', candidateHash: value.hash,
      runner: runner.id, runnerVersion: 'ci-suite@42', evidenceRefs: [`ci://${value.id}`],
    },
  });
}

// Low risk + fully deterministic => policy auto-accepts. Executor cannot invoke it.
{
  const h = harness();
  const c = contract('contract:docs', 'task_result');
  const value = candidate('candidate:docs', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  assert.throws(() => h.dispatch({
    type: 'record_risk', actor: executor, candidateId: value.id,
    assessment: { id: 'risk:forged', candidateHash: value.hash, facts: risk(), assessor: executor.id, sourceRefs: [] },
  }), /only Kernel/u);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  assert.equal(replayAcceptance(h.journal()).candidates[value.id]?.phase, 'policy_blocked', 'missing trusted Risk Assessment must fail closed');
  recordRisk(h.dispatch, value, risk());
  recordPassingCi(h.dispatch, value);
  assert.throws(() => h.dispatch({ type: 'evaluate', actor: executor, candidateId: value.id }), /Executor cannot/u);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  const state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'accepted');
  assert.equal(Object.keys(state.reviewerAssignments).length, 0, 'small deterministic work must not pay Reviewer cost');
  assert.equal(Object.keys(state.sponsorGates).length, 0);
  const record = Object.values(state.records)[0]!;
  assert.equal(record.decidedBy, 'acceptance-policy:risk-policy-v1');
  assert.equal(record.route, 'auto_accept');
}

// A deterministic failure is hard: it requests rework and cannot be waived by Sponsor.
{
  const h = harness();
  const c = contract('contract:broken', 'task_result');
  const value = candidate('candidate:broken', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk());
  h.dispatch({
    type: 'record_check', actor: runner, candidateId: value.id,
    result: { id: `check:${value.id}:ci`, criterionId: 'ci', status: 'failed', candidateHash: value.hash, runner: runner.id, runnerVersion: 'ci-suite@42', evidenceRefs: ['ci://failure'] },
  });
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  const state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'rework');
  assert.equal(Object.keys(state.sponsorGates).length, 0, 'Sponsor cannot waive a failed acceptance criterion');
}

// Medium risk creates a separate, read-only Reviewer Assignment; a producer cannot review itself.
{
  const h = harness();
  const c = contract('contract:integration', 'integration_candidate');
  const value = candidate('candidate:integration', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk({ effect: 'canonical_write', reversibility: 'compensatable', blastRadius: 'project' }));
  recordPassingCi(h.dispatch, value);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  let state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'awaiting_review');
  const assignment = Object.values(state.reviewerAssignments)[0]!;
  const verdict = {
    reviewerAssignmentId: assignment.id,
    reviewerAgentId: reviewer.id,
    candidateHash: value.hash,
    criteria: {},
    acceptedClaimIds: [value.claimIds[0]!],
    rejectedClaimIds: [value.claimIds[1]!],
    evidenceRefs: ['review://integration'],
  } as const;
  assert.throws(() => h.dispatch({ type: 'claim_review', actor: { id: executor.id, role: 'reviewer' }, candidateId: value.id }), /different principals/u);
  h.dispatch({ type: 'claim_review', actor: reviewer, candidateId: value.id });
  h.dispatch({ type: 'submit_review', actor: reviewer, candidateId: value.id, verdict });
  state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'accepted');
  const record = Object.values(state.records)[0]!;
  assert.deepEqual(record.acceptedClaimIds, [value.claimIds[0]]);
  assert.deepEqual(record.rejectedClaimIds, [value.claimIds[1]]);
}

// High, irreversible effect skips Reviewer when all criteria are mechanical, but cannot execute before Sponsor.
{
  const h = harness();
  const c = contract('contract:email', 'effect_intent');
  const value = candidate('candidate:email', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk({ effect: 'external', reversibility: 'irreversible', blastRadius: 'external', capabilityTags: ['send'] }));
  recordPassingCi(h.dispatch, value);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  let state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'awaiting_sponsor');
  assert.equal(Object.keys(state.reviewerAssignments).length, 0);
  let gate = Object.values(state.sponsorGates)[0]!;
  assert.throws(() => h.dispatch({ type: 'sponsor_decide', actor: sponsor, gateId: gate.id, candidateHash: 'sha256:forged', decision: 'approve', reason: 'ship' }), /current candidate hash/u);
  h.dispatch({ type: 'advance_clock', actor: kernel, now: gate.deadline + 1 });
  assert.equal(replayAcceptance(h.journal()).candidates[value.id]?.phase, 'gate_expired');
  h.dispatch({ type: 'reopen_gate', actor: orchestrator, candidateId: value.id });
  state = replayAcceptance(h.journal());
  gate = Object.values(state.sponsorGates).find(item => item.status === 'open')!;
  h.dispatch({ type: 'sponsor_decide', actor: sponsor, gateId: gate.id, candidateHash: value.hash, decision: 'approve', reason: 'approved exact recipient and content' });
  state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'authorized', 'effect approval authorizes an intent; it does not claim the effect already happened');
  assert.equal(Object.values(state.records)[0]?.disposition, 'authorized');
}

// High risk plus judgment requires Reviewer then Sponsor. Changes stale the old review/gate.
{
  const h = harness();
  const c = contract('contract:launch', 'task_result', true);
  const first = candidate('candidate:launch-v1', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: first });
  recordRisk(h.dispatch, first, risk({ effect: 'external', reversibility: 'compensatable', blastRadius: 'external', capabilityTags: ['publish'] }));
  recordPassingCi(h.dispatch, first);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: first.id });
  let state = replayAcceptance(h.journal());
  const review = Object.values(state.reviewerAssignments)[0]!;
  h.dispatch({ type: 'claim_review', actor: reviewer, candidateId: first.id });
  h.dispatch({
    type: 'submit_review', actor: reviewer, candidateId: first.id,
    verdict: {
      reviewerAssignmentId: review.id, reviewerAgentId: reviewer.id, candidateHash: first.hash,
      criteria: { quality: 'passed' }, acceptedClaimIds: first.claimIds, rejectedClaimIds: [], evidenceRefs: ['review://launch'],
    },
  });
  state = replayAcceptance(h.journal());
  const gate = Object.values(state.sponsorGates)[0]!;
  assert.equal(state.candidates[first.id]?.phase, 'awaiting_sponsor');
  h.dispatch({ type: 'sponsor_decide', actor: sponsor, gateId: gate.id, candidateHash: first.hash, decision: 'request_changes', reason: 'remove embargoed detail' });
  const replacement = { ...first, id: 'candidate:launch-v2', hash: 'sha256:launch-v2', producerAssignmentId: 'assignment:launch-v2' };
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: replacement });
  recordRisk(h.dispatch, replacement, risk({ effect: 'external', reversibility: 'compensatable', blastRadius: 'external', capabilityTags: ['publish'] }));
  h.dispatch({ type: 'supersede_candidate', actor: orchestrator, candidateId: first.id, replacementCandidateId: replacement.id });
  state = replayAcceptance(h.journal());
  assert.equal(state.candidates[first.id]?.phase, 'stale');
  assert.equal(state.candidates[replacement.id]?.phase, 'awaiting_checks');
  assert.throws(() => h.dispatch({ type: 'sponsor_decide', actor: sponsor, gateId: gate.id, candidateHash: first.hash, decision: 'approve', reason: 'late click' }), /open Sponsor Gate/u);
}

// Incomplete risk and timed-out review are bounded blockers with an always-available cancel path.
{
  const h = harness();
  const c = contract('contract:unknown', 'task_result');
  const value = candidate('candidate:unknown', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk({ unknowns: ['recipient data classification'] }));
  recordPassingCi(h.dispatch, value);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  assert.equal(replayAcceptance(h.journal()).candidates[value.id]?.phase, 'policy_blocked');
  h.dispatch({ type: 'cancel_candidate', actor: sponsor, candidateId: value.id, reason: 'cannot establish safe scope' });
  assert.equal(replayAcceptance(h.journal()).candidates[value.id]?.phase, 'cancelled');
}

{
  const h = harness();
  const c = contract('contract:review-timeout', 'task_result', true);
  const value = candidate('candidate:review-timeout', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk());
  recordPassingCi(h.dispatch, value);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  const assignment = Object.values(replayAcceptance(h.journal()).reviewerAssignments)[0]!;
  h.dispatch({ type: 'advance_clock', actor: kernel, now: assignment.deadline + 1 });
  let state = replayAcceptance(h.journal());
  assert.equal(state.reviewerAssignments[assignment.id]?.status, 'expired');
  assert.equal(state.candidates[value.id]?.phase, 'policy_blocked');
  h.dispatch({ type: 'reassign_reviewer', actor: orchestrator, candidateId: value.id });
  state = replayAcceptance(h.journal());
  assert.equal(Object.values(state.reviewerAssignments).filter(item => item.status === 'unclaimed').length, 1);
  h.dispatch({ type: 'cancel_candidate', actor: orchestrator, candidateId: value.id, reason: 'review unavailable' });
  state = replayAcceptance(h.journal());
  assert.equal(state.candidates[value.id]?.phase, 'cancelled');
}

// A new policy snapshot never mutates an in-flight contract's replay semantics.
{
  const h = harness();
  const c = contract('contract:pinned-policy', 'task_result');
  const value = candidate('candidate:pinned-policy', c.id);
  h.dispatch({ type: 'register_contract', contract: c });
  h.dispatch({
    type: 'register_policy', actor: kernel,
    policy: {
      id: 'risk-policy-v2', reviewerDeadlineMs: 5_000, sponsorDeadlineMs: 5_000,
      additionalReviewerTiers: ['high', 'critical'], additionalSponsorTiers: [],
      deniedCapabilityTags: ['payment'],
    },
  });
  h.dispatch({ type: 'submit_candidate', actor: executor, candidate: value });
  recordRisk(h.dispatch, value, risk());
  recordPassingCi(h.dispatch, value);
  h.dispatch({ type: 'evaluate', actor: orchestrator, candidateId: value.id });
  const record = Object.values(replayAcceptance(h.journal()).records)[0]!;
  assert.equal(record.policyId, 'risk-policy-v1');
}

console.log('Risk acceptance scenarios passed: deterministic auto-accept, hard rework, independent Reviewer, hash-bound Sponsor authorization, expiry/reopen/cancel, stale replacement, claim disposition and pinned policy replay.');
