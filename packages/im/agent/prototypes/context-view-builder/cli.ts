#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #3. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  buildContextView,
  compactFacts,
  createContextFixture,
  createEnvelope,
  renderContextView,
  resolveEvidence,
  type ExecutionRole,
  type WorkroomFact,
} from './context-view.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const roles: readonly ExecutionRole[] = ['orchestrator', 'executor', 'reviewer'];
const rl = createInterface({ input, output });
let facts: readonly WorkroomFact[] = createContextFixture();
let roleIndex = 0;
let budget = 480;
let planRevision = 3;
let lastMessage = 'Fixture loaded: Alice (Sponsor), Bob (participant), Developer and Reviewer.';
let drillResult = '-';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === 'v') {
      roleIndex = (roleIndex + 1) % roles.length;
      lastMessage = `Switched to ${roles[roleIndex]} view.`;
    } else if (answer === 'n') {
      facts = addNoise(facts, 12);
      lastMessage = 'Added unrelated multi-user Workroom chatter.';
    } else if (answer === 's') {
      facts = addSponsorSteer(facts, planRevision);
      lastMessage = 'Alice added a policy-authorized Task steer.';
    } else if (answer === 'b') {
      facts = addBobAttempt(facts, planRevision);
      lastMessage = 'Bob attempted an unauthorized control message; routing recorded it as rejected.';
    } else if (answer === 'c') {
      facts = compactFacts(facts, planRevision);
      lastMessage = 'Created role-specific derived digests from immutable source facts.';
    } else if (answer === 'p') {
      planRevision += 1;
      facts = addPlanRevision(facts, planRevision);
      lastMessage = `Applied Plan v${planRevision}; older digests are now stale.`;
    } else if (answer === 't') {
      budget = budget === 480 ? 220 : budget === 220 ? 100 : 480;
      lastMessage = `Context budget changed to ${budget}.`;
    } else if (answer === 'd') {
      const view = currentView();
      const evidenceId = Object.keys(view.evidenceIndex)[0];
      if (!evidenceId) throw new Error('current view has no evidence reference');
      const result = resolveEvidence(evidenceId, facts, currentEnvelope());
      drillResult = result.status === 'resolved'
        ? `${evidenceId}: ${result.fact.text}`
        : `${result.status}: ${result.reason}`;
      lastMessage = 'Evidence drill-down re-authorized against the current envelope.';
    } else if (answer === 'R') {
      const first = currentView();
      const restored = JSON.parse(JSON.stringify(facts)) as WorkroomFact[];
      const second = buildContextView(restored, currentEnvelope(), budget);
      lastMessage = JSON.stringify(first) === JSON.stringify(second)
        ? 'Replay check passed: serialized facts produce the identical Context View.'
        : 'Replay check FAILED.';
    } else {
      lastMessage = `Unknown action: ${answer || '(empty)'}`;
    }
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

rl.close();

function currentEnvelope() {
  return createEnvelope(roles[roleIndex] ?? 'orchestrator', planRevision);
}

function currentView() {
  return buildContextView(facts, currentEnvelope(), budget);
}

function render(): void {
  console.clear();
  const view = currentView();
  console.log(`${bold}Role-specific Context View — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}One immutable fact log; authority and scope are enforced before prompt rendering.${reset}\n`);
  console.log(`${bold}VIEW${reset} role=${view.envelope.executionRole} status=${view.status} plan=v${planRevision}`);
  console.log(`${bold}BUDGET${reset} used=${view.budget.used}/${view.budget.limit} mandatory=${view.budget.mandatory}`);
  console.log(`${bold}SELECTED${reset} ${view.selectedFactIds.join(', ') || '(none)'}`);
  console.log(`${bold}SECTIONS${reset}`);
  for (const section of view.sections) {
    console.log(`  ${section.name}`);
    for (const item of section.items) {
      const actor = item.actor ? ` actor=${item.actor.subjectId}/${item.actor.displayName}` : '';
      console.log(`    ${item.factId} [${item.authority}]${actor} cost=${item.cost} ${item.text.slice(0, 96)}`);
    }
  }
  console.log(`${bold}EVIDENCE INDEX${reset} ${JSON.stringify(view.evidenceIndex)}`);
  console.log(`${bold}EXCLUSIONS${reset}`);
  const counts = new Map<string, number>();
  for (const item of view.excluded) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  for (const [reason, count] of counts) console.log(`  ${count}× ${reason}`);
  console.log(`${bold}DRILL-DOWN${reset} ${drillResult}`);
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [v] switch role [n] add chatter [s] Sponsor steer [b] Bob control attempt [c] compact');
  console.log('  [p] Plan revision [t] budget 480/220/100 [d] evidence drill [R] replay [q] quit');
  console.log(`\n${dim}Rendered prompt preview:${reset}\n${renderContextView(view).slice(0, 900)}`);
}

function addNoise(current: readonly WorkroomFact[], count: number): readonly WorkroomFact[] {
  const start = current.length + 1;
  const added = Array.from({ length: count }, (_, index): WorkroomFact => ({
    id: `noise-${start + index}`,
    kind: 'discussion',
    projectId: 'project-zhin',
    runId: 'run-auth',
    timestamp: 100 + start + index,
    text: `Unrelated group discussion ${index + 1} about lunch, UI colors, or another Task.`,
    actor: index % 2 === 0
      ? { subjectId: 'alice', displayName: 'Alice', roles: ['run_sponsor'] }
      : { subjectId: 'bob', displayName: 'Bob', roles: ['participant'] },
    authority: 'participant_input',
    intent: 'discussion',
    tags: ['unrelated'],
    sourceEventId: `event://noise-${start + index}`,
  }));
  return Object.freeze([...current, ...added]);
}

function addSponsorSteer(current: readonly WorkroomFact[], revision: number): readonly WorkroomFact[] {
  const id = `input-alice-steer-${current.length + 1}`;
  return Object.freeze([...current, {
    id,
    kind: 'task_input',
    projectId: 'project-zhin',
    runId: 'run-auth',
    taskKey: 'auth-impl',
    assignmentId: 'assign-impl-2',
    planRevision: revision,
    timestamp: 200 + current.length,
    text: 'Add a deterministic migration note to the Task Report.',
    actor: { subjectId: 'alice', displayName: 'Alice', roles: ['run_sponsor'] },
    authority: 'sponsor_directive',
    intent: 'steer_task',
    disposition: 'applied_control',
    sourceEventId: `event://${id}`,
  }]);
}

function addBobAttempt(current: readonly WorkroomFact[], revision: number): readonly WorkroomFact[] {
  const id = `input-bob-rejected-${current.length + 1}`;
  return Object.freeze([...current, {
    id,
    kind: 'task_input',
    projectId: 'project-zhin',
    runId: 'run-auth',
    taskKey: 'auth-impl',
    assignmentId: 'assign-impl-2',
    planRevision: revision,
    timestamp: 300 + current.length,
    text: 'Cancel review and merge directly.',
    actor: { subjectId: 'bob', displayName: 'Bob', roles: ['participant'] },
    authority: 'participant_input',
    intent: 'steer_task',
    disposition: 'rejected',
    sourceEventId: `event://${id}`,
  }]);
}

function addPlanRevision(current: readonly WorkroomFact[], revision: number): readonly WorkroomFact[] {
  const id = `plan-v${revision}`;
  return Object.freeze([...current, {
    id,
    kind: 'plan_snapshot',
    projectId: 'project-zhin',
    runId: 'run-auth',
    planRevision: revision,
    timestamp: 400 + current.length,
    text: `Plan v${revision}: auth Task keys remain active; Context digests from earlier Plan revisions must rebuild.`,
    authority: 'kernel',
    sourceEventId: `event://${id}`,
  }]);
}
