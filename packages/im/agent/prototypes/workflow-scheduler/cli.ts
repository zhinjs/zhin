#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #2. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  dispatchScheduler,
  initialSchedulerJournal,
  replayScheduler,
  type SchedulerCommand,
  type SchedulerEvent,
  type ScheduledTask,
} from './scheduler.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
let journal: readonly SchedulerEvent[] = initialSchedulerJournal(1);
let selected = 0;
let lastMessage = 'Create an inbox item, then let the Orchestrator propose a Plan Revision.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === '[' || answer === ']') {
      const delta = answer === '[' ? -1 : 1;
      selected = Math.max(0, Math.min(Math.max(0, taskList().length - 1), selected + delta));
      lastMessage = 'Task selection changed.';
      continue;
    }
    if (answer === 'R') {
      const first = replayScheduler(journal);
      const second = replayScheduler(JSON.parse(JSON.stringify(journal)) as SchedulerEvent[]);
      lastMessage = JSON.stringify(first) === JSON.stringify(second)
        ? 'Replay check passed.'
        : 'Replay check FAILED.';
      continue;
    }
    const command = commandFor(answer);
    if (!command) {
      lastMessage = `Unknown action: ${answer || '(empty)'}`;
      continue;
    }
    journal = dispatchScheduler(journal, command);
    lastMessage = `Applied ${command.type}.`;
    selected = Math.min(selected, Math.max(0, taskList().length - 1));
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

rl.close();

function commandFor(key: string): SchedulerCommand | undefined {
  const state = replayScheduler(journal);
  const task = selectedTask();
  const pendingRevision = Object.values(state.revisions).find((revision) => revision.status === 'approval_required');
  switch (key) {
    case 'i': return { type: 'receive_inbox', title: `Normal request ${Object.keys(state.inbox).length + 1}`, sponsorLane: 'normal' };
    case 'I': return { type: 'receive_inbox', title: `Urgent sponsor request ${Object.keys(state.inbox).length + 1}`, sponsorLane: 'urgent' };
    case 'p': {
      const inbox = Object.values(state.inbox).find((item) => item.status === 'pending_plan');
      if (!inbox) throw new Error('no pending inbox item');
      return {
        type: 'propose_task',
        baseRevision: state.currentPlanRevision,
        title: inbox.title,
        requestedLane: inbox.sponsorLane,
        localRank: 50,
        requirement: 'required',
        preemptibility: 'checkpointable',
        sourceInboxId: inbox.id,
        reason: 'Orchestrator planned inbox item',
      };
    }
    case 'd': {
      if (!task) throw new Error('select a parent task');
      return {
        type: 'propose_task',
        baseRevision: state.currentPlanRevision,
        title: `Depends on ${task.id}`,
        requestedLane: task.sponsorLane,
        localRank: 40,
        requirement: 'required',
        dependencies: [task.id],
        preemptibility: 'checkpointable',
        parentTaskId: task.id,
        reason: 'Orchestrator inserted a dependent subtask',
      };
    }
    case 'e': {
      if (!task) throw new Error('select a source task');
      return {
        type: 'propose_task',
        baseRevision: state.currentPlanRevision,
        title: `Escalated child of ${task.id}`,
        requestedLane: 'urgent',
        localRank: 90,
        requirement: 'required',
        preemptibility: 'checkpointable',
        parentTaskId: task.id,
        reason: 'Orchestrator requested cross-lane escalation',
      };
    }
    case 'o': {
      if (!task) throw new Error('select a source task');
      return {
        type: 'propose_task',
        baseRevision: state.currentPlanRevision,
        title: `Optional follow-up for ${task.id}`,
        requestedLane: task.sponsorLane,
        localRank: 10,
        requirement: 'optional',
        preemptibility: 'atomic',
        parentTaskId: task.id,
        reason: 'Orchestrator added optional work',
      };
    }
    case 'A': {
      if (!pendingRevision) throw new Error('no revision awaits Sponsor approval');
      return { type: 'approve_revision', revisionId: pendingRevision.id };
    }
    case 'z': {
      if (!pendingRevision) throw new Error('no revision awaits Sponsor decision');
      return { type: 'reject_revision', revisionId: pendingRevision.id, reason: 'Sponsor rejected escalation' };
    }
    case 's': return { type: 'schedule' };
    case 'k': return { type: 'checkpoint_preemption' };
    case 'a': {
      const running = Object.values(state.tasks).find((item) => item.status === 'running');
      if (!running) throw new Error('no running task');
      return { type: 'accept_task', taskId: running.id };
    }
    case 'f': {
      const running = Object.values(state.tasks).find((item) => item.status === 'running');
      if (!running) throw new Error('no running task');
      return { type: 'fail_task', taskId: running.id, reason: 'execution failed' };
    }
    case 'x': {
      if (!task) throw new Error('select an optional task');
      return { type: 'skip_task', taskId: task.id, reason: 'optional work skipped by policy' };
    }
    case 't': return { type: 'advance_clock', seconds: 30 };
    default: return undefined;
  }
}

function taskList(): ScheduledTask[] {
  return Object.values(replayScheduler(journal).tasks);
}

function selectedTask(): ScheduledTask | undefined {
  return taskList()[selected];
}

function render(): void {
  console.clear();
  const state = replayScheduler(journal);
  const tasks = Object.values(state.tasks);
  console.log(`${bold}Workflow Scheduler — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Orchestrator proposes Plan Revisions; Scheduler alone chooses dispatch/preemption.${reset}\n`);
  console.log(`${bold}RUN${reset} status=${state.runStatus} plan=v${state.currentPlanRevision} now=${state.now}s capacity=${state.capacity}`);
  console.log(`${bold}POLICY${reset} v${state.policy.version} aging=${state.policy.agingStepSeconds}s preemptDeadline=${state.policy.preemptionDeadlineSeconds}s starvation=${JSON.stringify(state.policy.starvationBoundByLane)}`);
  console.log(`${bold}INBOX${reset}`);
  if (Object.keys(state.inbox).length === 0) console.log('  (none)');
  for (const item of Object.values(state.inbox)) {
    console.log(`  ${item.id} lane=${item.sponsorLane} status=${item.status} ${item.title}`);
  }
  console.log(`${bold}TASKS${reset}`);
  if (tasks.length === 0) console.log('  (none)');
  tasks.forEach((task, index) => {
    const marker = index === selected ? '▶' : ' ';
    console.log(`${marker} ${task.id} ${task.status} lane=${task.sponsorLane}/${task.localRank} ${task.requirement} ${task.preemptibility}`);
    console.log(`    deps=[${task.dependencies.join(',')}] readySince=${task.readySince ?? '-'} checkpoint=${task.checkpointRef ?? '-'} ${task.title}`);
  });
  console.log(`${bold}PLAN REVISIONS${reset}`);
  if (Object.keys(state.revisions).length === 0) console.log('  (none)');
  for (const revision of Object.values(state.revisions)) {
    console.log(`  ${revision.id} ${revision.status} base=v${revision.baseRevision} -> v${revision.targetRevision} authorized=${revision.authorizedLane} requested=${revision.task.sponsorLane}`);
    if (revision.approval) console.log(`    approval owner=${revision.approval.owner} deadline=${revision.approval.deadline}s actions=[${revision.approval.allowedActions.join(',')}]`);
  }
  console.log(`${bold}PREEMPTION${reset} ${state.preemption ? JSON.stringify(state.preemption) : '(none)'}`);
  console.log(`${bold}DISPATCH COUNTS${reset} ${JSON.stringify(state.dispatchedByLane)}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-7)) console.log(`  #${entry.seq} ${entry.type} ${JSON.stringify(entry.payload)}`);
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [i] normal inbox [I] urgent inbox [p] plan inbox [d] dependent child [e] escalate child');
  console.log('  [o] optional child [A] approve [z] reject revision [s] schedule [k] checkpoint [a] accept [f] fail');
  console.log('  [x] skip optional [t] +30s [[]/[]] select [R] replay [q] quit');
}
