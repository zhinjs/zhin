#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #7. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  dispatchAcceptance,
  initialAcceptanceJournal,
  replayAcceptance,
  type AcceptanceCommand,
  type AcceptanceContract,
  type AcceptanceEvent,
  type Candidate,
  type RiskFacts,
} from './acceptance-policy.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
let journal: readonly AcceptanceEvent[] = initialAcceptanceJournal();
let activeId: string | undefined;
let lastMessage = 'Choose a risk profile. Every scenario starts with a fresh immutable policy snapshot.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === 'l') load('low');
    else if (answer === 'm') load('medium');
    else if (answer === 'h') load('high');
    else if (answer === 'j') load('high_judgment');
    else if (answer === 'u') load('unknown');
    else if (answer === 'c') check('passed');
    else if (answer === 'f') check('failed');
    else if (answer === 'e') evaluate('orchestrator');
    else if (answer === 'x') evaluate('executor');
    else if (answer === 'r') review();
    else if (answer === 'a') sponsorDecision('approve');
    else if (answer === 'd') sponsorDecision('request_changes');
    else if (answer === 't') expireWait();
    else if (answer === 'o') reopen();
    else if (answer === 'k') cancel();
    else lastMessage = `Unknown action: ${answer || '(empty)'}`;
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function dispatch(command: AcceptanceCommand): void {
  journal = dispatchAcceptance(journal, command);
}

function load(profile: 'low' | 'medium' | 'high' | 'high_judgment' | 'unknown'): void {
  journal = initialAcceptanceJournal();
  const judgment = profile === 'high_judgment';
  const kind = profile === 'high' ? 'effect_intent' : 'task_result';
  const contract: AcceptanceContract = {
    id: `contract:${profile}`,
    taskKey: `task:${profile}`,
    taskRevision: 1,
    kind,
    policyId: 'risk-policy-v1',
    criteria: [
      { id: 'ci', kind: 'deterministic', description: 'Pinned check passes for this candidate hash' },
      ...(judgment ? [{ id: 'quality', kind: 'judgment' as const, description: 'Human-facing quality meets the brief' }] : []),
    ],
    requiredEvidence: ['artifact://report'],
  };
  const riskByProfile: Record<typeof profile, RiskFacts> = {
    low: facts(),
    medium: facts({ effect: 'canonical_write', reversibility: 'compensatable', blastRadius: 'project' }),
    high: facts({ effect: 'external', reversibility: 'irreversible', blastRadius: 'external', capabilityTags: ['send'] }),
    high_judgment: facts({ effect: 'external', reversibility: 'compensatable', blastRadius: 'external', capabilityTags: ['publish'] }),
    unknown: facts({ unknowns: ['recipient data classification'] }),
  };
  const candidate: Candidate = {
    id: `candidate:${profile}`,
    contractId: contract.id,
    producerAssignmentId: `assignment:${profile}`,
    producerAgentId: 'agent:executor',
    hash: `sha256:${profile}`,
    claimIds: [`claim:${profile}:result`, `claim:${profile}:note`],
    evidenceRefs: ['artifact://report'],
  };
  dispatch({ type: 'register_contract', contract });
  dispatch({ type: 'submit_candidate', actor: { id: 'agent:executor', role: 'executor' }, candidate });
  dispatch({
    type: 'record_risk', actor: { id: 'workroom:kernel', role: 'kernel' }, candidateId: candidate.id,
    assessment: {
      id: `risk:${candidate.id}`, candidateHash: candidate.hash, facts: riskByProfile[profile],
      assessor: 'workroom:kernel', sourceRefs: ['plan://risk', 'capability://snapshot'],
    },
  });
  activeId = candidate.id;
  lastMessage = `${profile} candidate submitted by Executor; it is not accepted.`;
}

function facts(overrides: Partial<RiskFacts> = {}): RiskFacts {
  return {
    effect: 'none', reversibility: 'discard_only', dataClass: 'public', blastRadius: 'assignment',
    capabilityTags: [], unknowns: [], ...overrides,
  };
}

function active() {
  if (!activeId) throw new Error('load a profile first');
  const value = replayAcceptance(journal).candidates[activeId]?.candidate;
  if (!value) throw new Error('active candidate missing');
  return value;
}

function check(status: 'passed' | 'failed'): void {
  const value = active();
  dispatch({
    type: 'record_check', actor: { id: 'check:ci', role: 'check_runner' }, candidateId: value.id,
    result: { id: `check:${value.id}:ci`, criterionId: 'ci', status, candidateHash: value.hash, runner: 'check:ci', runnerVersion: 'ci@42', evidenceRefs: [`ci://${status}`] },
  });
  lastMessage = `Trusted runner recorded ${status}; no Agent may rewrite it.`;
}

function evaluate(role: 'executor' | 'orchestrator'): void {
  const value = active();
  dispatch({ type: 'evaluate', actor: { id: `agent:${role}`, role }, candidateId: value.id });
  lastMessage = 'Pinned policy evaluated risk, checks and criterion kinds; inspect the chosen route.';
}

function review(): void {
  const value = active();
  const state = replayAcceptance(journal);
  const reviewAssignment = Object.values(state.reviewerAssignments).find(item => item.candidateId === value.id && item.status === 'unclaimed');
  if (!reviewAssignment) throw new Error('no unclaimed Reviewer Assignment; policy did not request one');
  dispatch({ type: 'claim_review', actor: { id: 'agent:reviewer', role: 'reviewer' }, candidateId: value.id });
  const contract = state.contracts[value.contractId]!;
  dispatch({
    type: 'submit_review', actor: { id: 'agent:reviewer', role: 'reviewer' }, candidateId: value.id,
    verdict: {
      reviewerAssignmentId: reviewAssignment.id,
      reviewerAgentId: 'agent:reviewer',
      candidateHash: value.hash,
      criteria: Object.fromEntries(contract.criteria.filter(item => item.kind === 'judgment').map(item => [item.id, 'passed'])),
      acceptedClaimIds: [value.claimIds[0]!],
      rejectedClaimIds: [value.claimIds[1]!],
      evidenceRefs: ['review://verdict'],
    },
  });
  lastMessage = 'Independent Reviewer dispositioned every claim; policy, not Reviewer prose, advances the candidate.';
}

function sponsorDecision(decision: 'approve' | 'request_changes'): void {
  const value = active();
  const gate = Object.values(replayAcceptance(journal).sponsorGates).find(item => item.candidateId === value.id && item.status === 'open');
  if (!gate) throw new Error('no open Sponsor Gate');
  dispatch({ type: 'sponsor_decide', actor: { id: 'human:sponsor', role: 'sponsor' }, gateId: gate.id, candidateHash: value.hash, decision, reason: decision === 'approve' ? 'approved exact digest and scope' : 'revise scope' });
  lastMessage = decision === 'approve' ? 'Exact candidate digest approved.' : 'Candidate returned to rework; prior approval cannot leak to a replacement.';
}

function expireWait(): void {
  const state = replayAcceptance(journal);
  const deadline = [
    ...Object.values(state.reviewerAssignments).filter(item => item.status === 'unclaimed' || item.status === 'running').map(item => item.deadline),
    ...Object.values(state.sponsorGates).filter(item => item.status === 'open').map(item => item.deadline),
  ].sort((a, b) => a - b)[0];
  if (!deadline) throw new Error('no bounded wait is open');
  dispatch({ type: 'advance_clock', actor: { id: 'workroom:kernel', role: 'kernel' }, now: deadline + 1 });
  lastMessage = 'Deadline expired into a recoverable state; re-open/reassign/replan/cancel remain possible.';
}

function reopen(): void {
  const value = active();
  const state = replayAcceptance(journal);
  if (state.candidates[value.id]?.phase === 'gate_expired') {
    dispatch({ type: 'reopen_gate', actor: { id: 'agent:orchestrator', role: 'orchestrator' }, candidateId: value.id });
    lastMessage = 'Orchestrator requested a fresh bounded Sponsor Gate for the same candidate digest.';
  } else {
    dispatch({ type: 'reassign_reviewer', actor: { id: 'agent:orchestrator', role: 'orchestrator' }, candidateId: value.id });
    lastMessage = 'Orchestrator replaced the expired Reviewer Assignment without changing the candidate.';
  }
}

function cancel(): void {
  const value = active();
  dispatch({ type: 'cancel_candidate', actor: { id: 'human:sponsor', role: 'sponsor' }, candidateId: value.id, reason: 'operator cancelled pending acceptance' });
  lastMessage = 'Pending acceptance cancelled without relying on the blocked Agent.';
}

function render(): void {
  console.clear();
  const state = replayAcceptance(journal);
  console.log(`${bold}Risk-tier Acceptance — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Facts → pinned policy → checks → optional Reviewer → optional Sponsor Gate → accepted/authorized.${reset}\n`);
  console.log(`${bold}POLICY MATRIX${reset}`);
  console.log('  low + mechanical       → auto_accept');
  console.log('  low + judgment/medium  → independent Reviewer');
  console.log('  high + mechanical      → Sponsor Gate');
  console.log('  high + judgment        → Reviewer, then Sponsor Gate');
  console.log('  failed/missing/unknown → rework or policy_blocked (never overridden)');
  console.log(`\n${bold}CANDIDATES${reset}`);
  for (const item of Object.values(state.candidates)) {
    console.log(`  ${item.candidate.id} phase=${item.phase} risk=${item.riskTier ?? '?'} route=${item.route ?? '?'} producer=${item.candidate.producerAgentId}`);
    if (item.reason) console.log(`    reason: ${item.reason}`);
  }
  console.log(`${bold}REVIEW / GATES / RECORDS${reset}`);
  for (const item of Object.values(state.reviewerAssignments)) console.log(`  ${item.id} status=${item.status} deadline=${item.deadline}`);
  for (const item of Object.values(state.sponsorGates)) console.log(`  ${item.id} status=${item.status} hash=${item.candidateHash} deadline=${item.deadline}`);
  for (const item of Object.values(state.records)) console.log(`  ${item.id} ${item.disposition} by=${item.decidedBy} claims=+${item.acceptedClaimIds.length}/-${item.rejectedClaimIds.length}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-8)) console.log(`  #${entry.seq} ${entry.type}`);
  console.log(`${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  load: [l] low [m] medium [h] high mechanical [j] high judgment [u] unknown');
  console.log('  act:  [c] check pass [f] check fail [e] evaluate [x] Executor self-evaluate');
  console.log('        [r] review pass [a] Sponsor approve [d] request changes [t] expire [o] reopen/reassign [k] cancel [q] quit');
}
