#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #11. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  admissionBlockers,
  dispatchPortfolio,
  initialPortfolioJournal,
  projectBudget,
  replayPortfolio,
  requestStatus,
  type PortfolioEvent,
} from './portfolio-admission.ts';
import {
  fixturePolicy,
  portfolioKernel,
  request,
  scheduler,
  sponsor,
  usageGateway,
  workroomKernel,
} from './fixtures.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const projects = ['project:software', 'project:content', 'project:support'] as const;
const counters: Record<(typeof projects)[number], number> = {
  'project:software': 0,
  'project:content': 0,
  'project:support': 0,
};
const rl = createInterface({ input, output });

let journal: readonly PortfolioEvent[] = initialPortfolioJournal(fixturePolicy());
let selected = 0;
let lastMessage = 'Submit opaque Workroom heads, then let Portfolio decide shared capacity.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === '[' || answer === ']') {
      selected = (selected + (answer === '[' ? projects.length - 1 : 1)) % projects.length;
      lastMessage = `Selected ${projects[selected]}.`;
      continue;
    }
    if (answer === 'R') {
      const copy = JSON.parse(JSON.stringify(journal)) as PortfolioEvent[];
      lastMessage = JSON.stringify(replayPortfolio(copy)) === JSON.stringify(replayPortfolio(journal))
        ? 'Replay check passed.'
        : 'Replay check FAILED.';
      continue;
    }
    handle(answer);
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

rl.close();

function handle(key: string): void {
  const state = replayPortfolio(journal);
  const projectId = projects[selected]!;
  switch (key) {
    case 'n': {
      const order = ++counters[projectId];
      const item = request(`request:${projectId}:${order}`, projectId, order);
      journal = dispatchPortfolio(journal, { type: 'submit_request', actor: scheduler(projectId), request: item });
      lastMessage = `Workroom Scheduler submitted opaque head ${item.id}.`;
      return;
    }
    case 'd': {
      const previousLength = journal.length;
      journal = dispatchPortfolio(journal, { type: 'decide_admission', actor: portfolioKernel });
      lastMessage = journal.length === previousLength ? 'No admissible grant/reclaim changed.' : 'Portfolio made one deterministic decision.';
      return;
    }
    case 'c': {
      const grant = Object.values(state.grants).find((item) => item.status === 'offered' && item.projectId === projectId);
      if (!grant) throw new Error(`no offered grant for ${projectId}`);
      journal = dispatchPortfolio(journal, {
        type: 'consume_grant', actor: workroomKernel(projectId), grantId: grant.id,
        assignmentRef: `assignment:${grant.requestId}`,
      });
      lastMessage = `Owning Workroom bound ${grant.id}; Portfolio did not claim a Task.`;
      return;
    }
    case 's': {
      const grant = Object.values(state.grants).find((item) => (
        item.projectId === projectId
        && ['consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown'].includes(item.status)
      ));
      if (!grant) throw new Error(`no consumed/unknown grant for ${projectId}`);
      journal = dispatchPortfolio(journal, {
        type: 'settle_usage', actor: usageGateway, grantId: grant.id,
        actualCostMicros: Math.max(1, Math.floor(grant.reservedCostMicros * 0.75)),
        settlementRef: `usage://${grant.id}`,
      });
      lastMessage = `Trusted Usage Gateway settled ${grant.id}.`;
      return;
    }
    case 'k': {
      const reclaim = Object.values(state.reclaims).find((item) => item.projectId === projectId && item.status === 'pending');
      if (!reclaim) throw new Error(`no pending reclaim for ${projectId}`);
      journal = dispatchPortfolio(journal, {
        type: 'acknowledge_reclaim', actor: workroomKernel(projectId), reclaimId: reclaim.id,
        outcome: 'checkpointed',
      });
      lastMessage = `Owning Workroom checkpointed; ${reclaim.grantId} released capacity only.`;
      return;
    }
    case 't':
    case 'T':
      journal = dispatchPortfolio(journal, {
        type: 'advance_clock', actor: portfolioKernel, ticks: key === 't' ? 1 : 5,
      });
      lastMessage = `Kernel clock advanced ${key === 't' ? 1 : 5} tick(s).`;
      return;
    case 'p':
    case 'h':
    case 'a': {
      const current = state.policy.projects[projectId]!;
      const status = key === 'p' ? 'paused' : key === 'h' ? 'reclaim_checkpointable' : 'active';
      journal = dispatchPortfolio(journal, {
        type: 'update_project_policy', actor: sponsor,
        policy: { ...current, revision: current.revision + 1, status },
      });
      lastMessage = `Sponsor set ${projectId} admission=${status}; no Task status was written.`;
      return;
    }
    case 'o': {
      const pending = Object.values(state.requests).find((item) => (
        item.projectId === projectId && requestStatus(state, item.id) === 'pending'
      ));
      if (!pending) throw new Error(`no pending request for ${projectId}`);
      journal = dispatchPortfolio(journal, {
        type: 'set_priority_override', actor: sponsor,
        override: {
          id: `override:${pending.id}:${state.sequence}`,
          projectId,
          requestId: pending.id,
          lane: 'urgent',
          expiresAt: state.now + 3,
        },
      });
      lastMessage = `Sponsor issued a three-tick urgent override for exact request ${pending.id}.`;
      return;
    }
    default:
      lastMessage = `Unknown action: ${key || '(empty)'}`;
  }
}

function render(): void {
  console.clear();
  const state = replayPortfolio(journal);
  console.log(`${bold}Portfolio Admission — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Opaque Workroom heads → atomic Resource Bundle → fenced Capacity Grant.${reset}\n`);
  console.log(`${bold}PORTFOLIO${reset} now=${state.now} policy=v${state.policy.revision} journal=#${state.sequence}`);
  console.log(`${bold}PROJECTS${reset}`);
  projects.forEach((projectId, index) => {
    const policy = state.policy.projects[projectId]!;
    const budget = projectBudget(state, projectId);
    const marker = index === selected ? '▶' : ' ';
    console.log(`${marker} ${projectId} lane=${policy.lane} weight=${policy.weight} status=${policy.status} policy=v${policy.revision}`);
    console.log(`    budget spent=${budget.spentMicros} reserved=${budget.reservedMicros} available=${budget.availableMicros}`);
  });
  console.log(`${bold}REQUESTS${reset}`);
  if (Object.keys(state.requests).length === 0) console.log('  (none)');
  for (const item of Object.values(state.requests)) {
    const blockers = requestStatus(state, item.id) === 'pending' ? admissionBlockers(state, item.id) : [];
    console.log(`  ${item.id} project=${item.projectId} local=${item.workRef.localOrder} status=${requestStatus(state, item.id)}`);
    console.log(`    bundle=[${item.demands.map((demand) => `${demand.poolId}:${demand.capacityUnits}`).join(', ')}] blockers=${blockers.join(',') || '-'}`);
  }
  console.log(`${bold}GRANTS / RECLAIMS${reset}`);
  if (Object.keys(state.grants).length === 0) console.log('  (none)');
  for (const grant of Object.values(state.grants)) {
    console.log(`  ${grant.id}/f${grant.fence} ${grant.status} ${grant.projectId} <- ${grant.requestId} lane=${grant.laneAtIssue} reserve=${grant.reservedCostMicros}`);
  }
  for (const reclaim of Object.values(state.reclaims)) {
    console.log(`  ${reclaim.id} ${reclaim.status}: return ${reclaim.grantId} for ${reclaim.reservedForRequestId ?? 'Project pause'} by t=${reclaim.deadline}`);
  }
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-6)) console.log(`  #${entry.seq} ${entry.type} actor=${entry.actor.role}`);
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [[]/[]] Project [n] submit head [o] urgent override [d] decide [c] consume grant [s] settle usage');
  console.log('  [p] pause [h] pause+reclaim safe [a] activate [k] checkpoint reclaim [t] +1 [T] +5 [R] replay [q] quit');
}
