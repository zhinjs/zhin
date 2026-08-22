#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #4. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  baselineReport,
  comparableProjection,
  conflictingReport,
  correctiveReport,
  dispatchProjectMemory,
  expiringAssumptionReport,
  initialProjectMemoryJournal,
  recallProjectMemory,
  rebuildFromAcceptedSources,
  replayProjectMemory,
  unsafeUnacceptedReport,
  type ProjectMemoryCommand,
  type ProjectMemoryEvent,
  type TaskReport,
} from './project-memory.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
let journal: readonly ProjectMemoryEvent[] = initialProjectMemoryJournal();
let lastMessage = 'Submit a Task Report. execution_completed alone must not update Project State.';
let recallText = '-';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    const command = commandFor(answer);
    if (command) {
      journal = dispatchProjectMemory(journal, command);
      lastMessage = `Applied ${command.type}.`;
    } else if (answer === 's') {
      recallText = JSON.stringify(recallProjectMemory(replayProjectMemory(journal), 'node'));
      lastMessage = 'Recalled current Project State + accepted Task Memories with provenance.';
    } else if (answer === 'R') {
      const rebuilt = rebuildFromAcceptedSources(journal);
      const equal = JSON.stringify(comparableProjection(replayProjectMemory(journal)))
        === JSON.stringify(comparableProjection(replayProjectMemory(rebuilt)));
      lastMessage = equal
        ? 'Rebuild passed: accepted sources reconstruct identical Project/Task memory.'
        : 'Rebuild FAILED.';
    } else {
      lastMessage = `Unknown action: ${answer || '(empty)'}`;
    }
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

rl.close();

function commandFor(key: string): ProjectMemoryCommand | undefined {
  const state = replayProjectMemory(journal);
  if (key === '1') return submitIfMissing(baselineReport());
  if (key === '2') return submitIfMissing(conflictingReport());
  if (key === '3') {
    const current = Object.values(state.facts)
      .filter((fact) => fact.key === 'runtime.node.support' && fact.status !== 'stale')
      .map((fact) => fact.id);
    return submitIfMissing(correctiveReport(current));
  }
  if (key === '4') return submitIfMissing(expiringAssumptionReport(state.now));
  if (key === 'u') return submitIfMissing(unsafeUnacceptedReport());
  if (key === 'a') {
    const report = pendingReports()[0];
    if (!report) throw new Error('no execution_completed report awaits acceptance');
    return {
      type: 'accept_report',
      reportId: report.id,
      acceptedClaimIds: report.claims.map((claim) => claim.id),
      acceptedBy: 'acceptance-policy:prototype',
    };
  }
  if (key === 'x') {
    const report = pendingReports()[0];
    if (!report) throw new Error('no pending report to reject');
    return { type: 'reject_report', reportId: report.id, reason: 'Reviewer rejected candidate output' };
  }
  if (key === 'r') {
    const disputed = state.snapshot.entries.find((entry) => entry.status === 'disputed');
    if (!disputed) throw new Error('no disputed Project State entry');
    const winner = disputed.sourceFactIds[0];
    if (!winner) throw new Error('dispute has no candidate fact');
    return { type: 'resolve_conflict', key: disputed.key, winnerFactId: winner, acceptedBy: 'run-sponsor:alice' };
  }
  if (key === 't') return { type: 'advance_clock', seconds: 45 };
  return undefined;
}

function submitIfMissing(report: TaskReport): ProjectMemoryCommand {
  const state = replayProjectMemory(journal);
  if (state.reports[report.id]) throw new Error(`report already submitted: ${report.id}`);
  return { type: 'submit_report', report };
}

function pendingReports(): TaskReport[] {
  const state = replayProjectMemory(journal);
  return Object.values(state.reports).filter((report) => state.reportDisposition[report.id] === 'execution_completed');
}

function render(): void {
  console.clear();
  const state = replayProjectMemory(journal);
  console.log(`${bold}Project State Memory — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Only accepted source events may project Task Memory or Project State.${reset}\n`);
  console.log(`${bold}PROJECT${reset} id=${state.projectId} stateRevision=${state.snapshot.revision} sourceSeq=${state.snapshot.sourceSequence} now=${state.now}`);
  console.log(`${bold}REPORTS / ACCEPTANCE${reset}`);
  if (Object.keys(state.reports).length === 0) console.log('  (none)');
  for (const report of Object.values(state.reports)) {
    console.log(`  ${report.id} task=${report.taskKey}@${report.taskRevision} disposition=${state.reportDisposition[report.id]} context=${state.executionContexts[`${report.taskKey}@${report.taskRevision}`]}`);
    console.log(`    summary=${report.summary}`);
  }
  console.log(`${bold}CURRENT PROJECT STATE${reset}`);
  if (state.snapshot.entries.length === 0) console.log('  (none)');
  for (const entry of state.snapshot.entries) {
    console.log(`  ${entry.key} status=${entry.status} values=[${entry.values.join(' | ')}]`);
    console.log(`    facts=[${entry.sourceFactIds.join(',')}] evidence=[${entry.evidenceRefs.join(',')}]`);
  }
  console.log(`${bold}TASK MEMORIES${reset}`);
  if (Object.keys(state.taskMemories).length === 0) console.log('  (none)');
  for (const memory of Object.values(state.taskMemories)) {
    console.log(`  ${memory.id} source=${memory.sourceReportId}/${memory.sourceAcceptanceId} hash=${memory.sourceHash}`);
    console.log(`    ${memory.summary} claims=[${memory.claimKeys.join(',')}]`);
  }
  console.log(`${bold}HOT/RELEASED CONTEXT${reset} ${JSON.stringify(state.executionContexts)}`);
  console.log(`${bold}RECALL${reset} ${recallText}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-8)) console.log(`  #${entry.seq} ${entry.type} ${JSON.stringify(entry.payload)}`);
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [1] baseline report [2] conflicting report [3] corrective rework [4] expiring assumption');
  console.log('  [u] unsafe unaccepted report [a] accept oldest [x] reject oldest [r] resolve dispute');
  console.log('  [t] +45s [s] recall node [R] rebuild from accepted sources [q] quit');
}
