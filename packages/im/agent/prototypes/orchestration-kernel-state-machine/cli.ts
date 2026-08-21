#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #1. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  allowedTaskActions,
  dispatch,
  initialJournal,
  replay,
  type BlockerKind,
  type KernelCommand,
  type KernelEvent,
  type TaskState,
} from './machine';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
let journal: readonly KernelEvent[] = initialJournal();
let selected = 0;
let lastMessage = 'Prototype ready. Add a task to begin.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === '[') {
      selected = Math.max(0, selected - 1);
      lastMessage = 'Selected previous task.';
      continue;
    }
    if (answer === ']') {
      selected = Math.min(Math.max(0, taskList().length - 1), selected + 1);
      lastMessage = 'Selected next task.';
      continue;
    }
    if (answer === 'R') {
      const first = replay(journal);
      const second = replay(JSON.parse(JSON.stringify(journal)) as KernelEvent[]);
      lastMessage = JSON.stringify(first) === JSON.stringify(second)
        ? 'Replay check passed: journal reconstructs identical state.'
        : 'Replay check FAILED.';
      continue;
    }
    const command = await commandFor(answer);
    if (!command) {
      lastMessage = `Unknown action: ${answer || '(empty)'}`;
      continue;
    }
    journal = dispatch(journal, command);
    lastMessage = `Applied ${command.type}.`;
    selected = Math.min(selected, Math.max(0, taskList().length - 1));
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

rl.close();

async function commandFor(key: string): Promise<KernelCommand | undefined> {
  if (key === 'n') {
    const title = (await rl.question('task title> ')).trim() || `Task ${taskList().length + 1}`;
    return { type: 'plan_task', title };
  }
  if (key === 'X') return { type: 'cancel_run', reason: 'Sponsor cancelled the run' };
  if (key === 't') return { type: 'advance_clock', seconds: 15 };
  const task = selectedTask();
  if (!task) throw new Error('add/select a task first');
  switch (key) {
    case 'b': return {
      type: 'block_task',
      taskId: task.id,
      kind: 'approval' satisfies BlockerKind,
      owner: 'sponsor',
      reason: 'high-risk action requires approval',
    };
    case 'r': return { type: 'resolve_blocker', taskId: task.id };
    case 'c': return { type: 'claim_task', taskId: task.id, owner: 'agent:developer', role: 'executor' };
    case 's': return { type: 'start_assignment', taskId: task.id };
    case 'h': return { type: 'heartbeat', taskId: task.id };
    case 'p': return { type: 'request_preempt', taskId: task.id };
    case 'k': return { type: 'checkpoint_pause', taskId: task.id };
    case 'u': return { type: 'resume_task', taskId: task.id };
    case 'f': return { type: 'complete_execution', taskId: task.id };
    case 'a': return { type: 'accept_task', taskId: task.id };
    case 'j': return { type: 'request_rework', taskId: task.id, reason: 'review requested changes' };
    case 'x': return { type: 'cancel_task', taskId: task.id, reason: 'Sponsor cancelled the task' };
    case 'y': return { type: 'ack_cancel', taskId: task.id, outcome: 'interrupted' };
    default: return undefined;
  }
}

function taskList(): TaskState[] {
  return Object.values(replay(journal).tasks);
}

function selectedTask(): TaskState | undefined {
  return taskList()[selected];
}

function render(): void {
  console.clear();
  const state = replay(journal);
  const tasks = Object.values(state.tasks);
  const assignments = Object.values(state.assignments);
  console.log(`${bold}Orchestration Kernel v2 — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Event journal is the only authority; all state below is replayed.${reset}\n`);
  console.log(`${bold}RUN${reset} id=${state.runId} status=${state.status} now=${state.now}s cancelRequested=${state.cancelRequested}`);
  console.log(`${bold}TASKS${reset}`);
  if (tasks.length === 0) console.log('  (none)');
  tasks.forEach((task, index) => {
    const marker = index === selected ? '▶' : ' ';
    const blocker = task.blockers[0];
    console.log(`${marker} ${task.id} ${task.status} rev=${task.revision} attempt=${task.attempt}/${task.maxAttempts} ${task.title}`);
    console.log(`    allowed=[${allowedTaskActions(task).join(', ')}] report=${task.reportRef ?? '-'} reason=${task.terminalReason ?? '-'}`);
    if (blocker) {
      console.log(`    blocker=${blocker.kind} owner=${blocker.owner} deadline=${blocker.deadline}s reason=${blocker.reason}`);
    }
  });
  console.log(`${bold}ASSIGNMENTS${reset}`);
  if (assignments.length === 0) console.log('  (none)');
  for (const assignment of assignments) {
    console.log(`  ${assignment.id} role=${assignment.role} owner=${assignment.owner} status=${assignment.status}`);
    console.log(`    lease=${assignment.leaseExpiresAt}s controlDeadline=${assignment.controlDeadline ?? '-'} checkpoint=${assignment.checkpointRef ?? '-'} outcome=${assignment.outcome ?? '-'}`);
  }
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-6)) {
    console.log(`  #${entry.seq} ${entry.type} ${JSON.stringify(entry.payload)}`);
  }
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [n] new task   [[]/[]] select   [b] block   [r] resolve   [c] claim   [s] start');
  console.log('  [h] heartbeat  [p] preempt     [k] checkpoint/pause      [u] resume');
  console.log('  [f] finish execution           [a] accept  [j] rework    [x] cancel task');
  console.log('  [y] ack cancel [X] cancel run  [t] +15s    [R] replay    [q] quit');
}
