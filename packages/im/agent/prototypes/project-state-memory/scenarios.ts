/** Executable acceptance scenarios for decision-map ticket #4 (not a production test). */
import assert from 'node:assert/strict';
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
  type ProjectMemoryEvent,
  type TaskReport,
} from './project-memory.ts';

let journal: readonly ProjectMemoryEvent[] = initialProjectMemoryJournal();

function dispatch(command: Parameters<typeof dispatchProjectMemory>[1]): void {
  journal = dispatchProjectMemory(journal, command);
}

function submit(report: TaskReport): void {
  dispatch({ type: 'submit_report', report });
}

function accept(report: TaskReport): void {
  dispatch({
    type: 'accept_report',
    reportId: report.id,
    acceptedClaimIds: report.claims.map((claim) => claim.id),
    acceptedBy: 'acceptance-policy:scenario',
  });
}

const unsafe = unsafeUnacceptedReport();
submit(unsafe);
let state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.length, 0, 'execution_completed must not change Project State');
assert.equal(Object.keys(state.taskMemories).length, 0, 'unaccepted output must not create Task Memory');
assert.equal(state.executionContexts['deploy-attempt@1'], 'hot');
dispatch({ type: 'reject_report', reportId: unsafe.id, reason: 'not accepted' });
state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.length, 0, 'rejection must not change Project State');

const baseline = baselineReport();
submit(baseline);
accept(baseline);
state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.find((entry) => entry.key === 'runtime.node.support')?.status, 'verified');
assert.equal(state.executionContexts['auth-research@1'], 'released');
assert.equal(Object.values(state.taskMemories)[0]?.summary.includes(baseline.summary), false,
  'Task Memory must not copy a free-form report summary');

let partialJournal: readonly ProjectMemoryEvent[] = initialProjectMemoryJournal('project-partial');
partialJournal = dispatchProjectMemory(partialJournal, { type: 'submit_report', report: baselineReport() });
partialJournal = dispatchProjectMemory(partialJournal, {
  type: 'accept_report',
  reportId: baselineReport().id,
  acceptedClaimIds: ['node22'],
  acceptedBy: 'acceptance-policy:scenario',
});
const partialState = replayProjectMemory(partialJournal);
const partialAcceptance = Object.values(partialState.acceptances)[0];
const partialMemory = Object.values(partialState.taskMemories)[0];
assert.deepEqual(partialAcceptance?.rejectedClaimIds, ['pr-only']);
assert.equal(partialState.snapshot.entries.some((entry) => entry.key === 'release.mode'), false);
assert.equal(partialMemory?.summary.includes('release.mode'), false,
  'a rejected claim must not leak through Task Memory');

const conflict = conflictingReport();
submit(conflict);
accept(conflict);
state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.find((entry) => entry.key === 'runtime.node.support')?.status, 'disputed');

const disputedIds = Object.values(state.facts)
  .filter((fact) => fact.key === 'runtime.node.support' && fact.status === 'disputed')
  .map((fact) => fact.id);
const correction = correctiveReport(disputedIds);
submit(correction);
accept(correction);
state = replayProjectMemory(journal);
const nodeState = state.snapshot.entries.find((entry) => entry.key === 'runtime.node.support');
assert.deepEqual(nodeState?.values, ['20,22']);
assert.equal(nodeState?.status, 'verified');
assert.equal(disputedIds.every((id) => state.facts[id]?.status === 'stale'), true);

const assumption = expiringAssumptionReport(state.now);
submit(assumption);
accept(assumption);
state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.find((entry) => entry.key === 'migration.deadline')?.status, 'assumed');
dispatch({ type: 'advance_clock', seconds: 45 });
state = replayProjectMemory(journal);
assert.equal(state.snapshot.entries.find((entry) => entry.key === 'migration.deadline')?.status, 'stale');

const recall = recallProjectMemory(state, 'node');
assert.equal(recall.currentState.some((entry) => entry.key === 'runtime.node.support'), true);
assert.equal(recall.taskMemories.length >= 3, true);
assert.equal(recall.evidenceRefs.includes('evidence:matrix-v2'), true);

const rebuilt = replayProjectMemory(rebuildFromAcceptedSources(journal));
assert.deepEqual(comparableProjection(rebuilt), comparableProjection(state),
  'accepted sources must rebuild an identical projection');

let resolutionJournal: readonly ProjectMemoryEvent[] = initialProjectMemoryJournal('project-resolution');
for (const report of [baselineReport(), conflictingReport()]) {
  resolutionJournal = dispatchProjectMemory(resolutionJournal, { type: 'submit_report', report });
  resolutionJournal = dispatchProjectMemory(resolutionJournal, {
    type: 'accept_report',
    reportId: report.id,
    acceptedClaimIds: report.claims.map((claim) => claim.id),
    acceptedBy: 'acceptance-policy:scenario',
  });
}
let resolutionState = replayProjectMemory(resolutionJournal);
const winner = Object.values(resolutionState.facts)
  .find((fact) => fact.key === 'runtime.node.support' && fact.value === '22');
assert.ok(winner);
resolutionJournal = dispatchProjectMemory(resolutionJournal, {
  type: 'resolve_conflict',
  key: 'runtime.node.support',
  winnerFactId: winner.id,
  acceptedBy: 'run-sponsor:scenario',
});
resolutionState = replayProjectMemory(resolutionJournal);
assert.equal(resolutionState.snapshot.entries.find((entry) => entry.key === 'runtime.node.support')?.status, 'verified');
assert.deepEqual(
  comparableProjection(replayProjectMemory(rebuildFromAcceptedSources(resolutionJournal))),
  comparableProjection(resolutionState),
);

console.log('Project State Memory scenarios passed: unaccepted/rejected isolation, acceptance, conflict, rework, expiry, recall, context release, rebuild.');
