/** Executable acceptance scenarios for decision-map ticket #6 (not production tests). */
import assert from 'node:assert/strict';
import {
  dispatchWorkspace,
  initialWorkspaceJournal,
  replayWorkspace,
  type WorkspaceCommand,
  type WorkspaceEvent,
} from './workspace-integration.ts';

let journal: readonly WorkspaceEvent[] = initialWorkspaceJournal();
const original = replayWorkspace(journal).targetFiles;

function dispatch(command: WorkspaceCommand): void {
  journal = dispatchWorkspace(journal, command);
}

function allocate(id: string, taskKey: string, assignmentId: string): void {
  dispatch({
    type: 'allocate_workspace', id, runId: 'run-1', taskKey, taskRevision: 1,
    assignmentId, attempt: 1, backend: 'git_worktree', mutable: true,
  });
}

function sealAndAccept(workspaceId: string): string {
  const workspace = replayWorkspace(journal).workspaces[workspaceId]!;
  dispatch({ type: 'seal_workspace', workspaceId, fence: workspace.fence, evidenceRefs: [`test://${workspaceId}`] });
  const changeSet = Object.values(replayWorkspace(journal).changeSets).find((entry) => entry.workspaceId === workspaceId)!;
  dispatch({ type: 'accept_change_set', changeSetId: changeSet.id, acceptanceId: `accept:${changeSet.id}` });
  return changeSet.id;
}

allocate('ws-a', 'auth', 'assignment-a');
allocate('ws-b', 'router', 'assignment-b');
dispatch({ type: 'write_workspace', workspaceId: 'ws-a', fence: 1, path: 'src/auth.ts', content: 'export const modes = ["token", "oauth"]' });
dispatch({ type: 'write_workspace', workspaceId: 'ws-b', fence: 1, path: 'src/router.ts', content: 'export const route = "modern"' });
let state = replayWorkspace(journal);
assert.deepEqual(state.targetFiles, original, 'parallel Assignment writes must not touch canonical target');
assert.notDeepEqual(state.workspaces['ws-a']?.changes, state.workspaces['ws-b']?.changes);

const changeA = sealAndAccept('ws-a');
const changeB = sealAndAccept('ws-b');
state = replayWorkspace(journal);
assert.deepEqual(state.targetFiles, original, 'accepted producer Change Sets must still not auto-integrate');
dispatch({ type: 'prepare_integration', id: 'integration-1', orderedChangeSetIds: [changeA, changeB] });
state = replayWorkspace(journal);
assert.equal(state.integrations['integration-1']?.status, 'awaiting_acceptance');
assert.equal(state.targetFiles['src/router.ts'], original['src/router.ts']);
dispatch({ type: 'accept_integration', integrationId: 'integration-1', acceptanceId: 'accept:integration-1' });
dispatch({ type: 'request_integration_commit', integrationId: 'integration-1', gateId: 'gate:canonical-write' });
assert.throws(() => dispatch({ type: 'commit_integration', integrationId: 'integration-1' }), /not approved/u);
dispatch({ type: 'approve_integration_gate', integrationId: 'integration-1', gateId: 'gate:canonical-write' });
dispatch({ type: 'commit_integration', integrationId: 'integration-1' });
state = replayWorkspace(journal);
assert.equal(state.integrations['integration-1']?.status, 'committed');
assert.equal(state.targetFiles['src/auth.ts'], 'export const modes = ["token", "oauth"]');
assert.equal(state.targetFiles['src/router.ts'], 'export const route = "modern"');

let conflictJournal: readonly WorkspaceEvent[] = initialWorkspaceJournal('project-conflict');
function conflictDispatch(command: WorkspaceCommand): void {
  conflictJournal = dispatchWorkspace(conflictJournal, command);
}
for (const [id, assignment] of [['ws-c', 'assignment-c'], ['ws-d', 'assignment-d']] as const) {
  conflictDispatch({
    type: 'allocate_workspace', id, runId: 'run-conflict', taskKey: id, taskRevision: 1,
    assignmentId: assignment, attempt: 1, backend: 'git_worktree', mutable: true,
  });
}
conflictDispatch({ type: 'write_workspace', workspaceId: 'ws-c', fence: 1, path: 'src/auth.ts', content: 'export const modes = ["oauth"]' });
conflictDispatch({ type: 'write_workspace', workspaceId: 'ws-d', fence: 1, path: 'src/auth.ts', content: 'export const modes = ["passkey"]' });
for (const id of ['ws-c', 'ws-d']) {
  conflictDispatch({ type: 'seal_workspace', workspaceId: id, fence: 1, evidenceRefs: [`test://${id}`] });
  const candidate = Object.values(replayWorkspace(conflictJournal).changeSets).find((entry) => entry.workspaceId === id)!;
  conflictDispatch({ type: 'accept_change_set', changeSetId: candidate.id, acceptanceId: `accept:${candidate.id}` });
}
const conflictIds = Object.values(replayWorkspace(conflictJournal).changeSets).map((entry) => entry.id).sort();
conflictDispatch({ type: 'prepare_integration', id: 'integration-conflict', orderedChangeSetIds: conflictIds });
let conflictState = replayWorkspace(conflictJournal);
assert.equal(conflictState.integrations['integration-conflict']?.status, 'conflicted');
assert.equal(conflictState.targetRevision, 'base-1');
conflictDispatch({
  type: 'resolve_integration_conflicts', integrationId: 'integration-conflict',
  resolutions: { 'src/auth.ts': 'export const modes = ["oauth", "passkey"]' },
});
conflictState = replayWorkspace(conflictJournal);
assert.equal(conflictState.integrations['integration-conflict']?.status, 'awaiting_acceptance');
assert.equal(conflictState.targetRevision, 'base-1', 'conflict resolution remains an isolated candidate');

let staleJournal: readonly WorkspaceEvent[] = initialWorkspaceJournal('project-stale');
const staleDispatch = (command: WorkspaceCommand): void => { staleJournal = dispatchWorkspace(staleJournal, command); };
staleDispatch({ type: 'allocate_workspace', id: 'ws-stale', runId: 'run-stale', taskKey: 'docs', taskRevision: 1, assignmentId: 'assignment-stale', attempt: 1, backend: 'overlay', mutable: true });
staleDispatch({ type: 'write_workspace', workspaceId: 'ws-stale', fence: 1, path: 'README.md', content: '# Updated' });
staleDispatch({ type: 'seal_workspace', workspaceId: 'ws-stale', fence: 1, evidenceRefs: ['test://docs'] });
const staleChange = Object.values(replayWorkspace(staleJournal).changeSets)[0]!;
staleDispatch({ type: 'accept_change_set', changeSetId: staleChange.id, acceptanceId: 'accept:stale' });
staleDispatch({ type: 'prepare_integration', id: 'integration-stale', orderedChangeSetIds: [staleChange.id] });
staleDispatch({ type: 'accept_integration', integrationId: 'integration-stale', acceptanceId: 'accept:integration-stale' });
staleDispatch({ type: 'request_integration_commit', integrationId: 'integration-stale', gateId: 'gate:stale' });
staleDispatch({ type: 'approve_integration_gate', integrationId: 'integration-stale', gateId: 'gate:stale' });
staleDispatch({ type: 'advance_target', revision: 'base-2', changes: { 'src/other.ts': 'external change' } });
staleDispatch({ type: 'commit_integration', integrationId: 'integration-stale' });
assert.equal(replayWorkspace(staleJournal).integrations['integration-stale']?.status, 'stale');
assert.equal(replayWorkspace(staleJournal).targetRevision, 'base-2');

let recoveryJournal: readonly WorkspaceEvent[] = initialWorkspaceJournal('project-recovery');
const recoveryDispatch = (command: WorkspaceCommand): void => { recoveryJournal = dispatchWorkspace(recoveryJournal, command); };
recoveryDispatch({ type: 'allocate_workspace', id: 'ws-recovery', runId: 'run-recovery', taskKey: 'recover', taskRevision: 1, assignmentId: 'assignment-old', attempt: 1, backend: 'sandbox_volume', mutable: true });
recoveryDispatch({ type: 'write_workspace', workspaceId: 'ws-recovery', fence: 1, path: 'README.md', content: '# Checkpoint' });
recoveryDispatch({ type: 'checkpoint_workspace', workspaceId: 'ws-recovery', fence: 1 });
recoveryDispatch({ type: 'resume_workspace', workspaceId: 'ws-recovery', assignmentId: 'assignment-new', attempt: 2 });
assert.throws(() => recoveryDispatch({ type: 'write_workspace', workspaceId: 'ws-recovery', fence: 1, path: 'README.md', content: 'stale writer' }), /stale workspace fence/u);
const recovery = replayWorkspace(recoveryJournal).workspaces['ws-recovery']!;
assert.equal(recovery.attempt, 2);
recoveryDispatch({ type: 'write_workspace', workspaceId: 'ws-recovery', fence: recovery.fence, path: 'README.md', content: '# Resumed' });
recoveryDispatch({ type: 'discard_workspace', workspaceId: 'ws-recovery', reason: 'task cancelled before publication' });
assert.equal(replayWorkspace(recoveryJournal).workspaces['ws-recovery']?.status, 'discarded');
assert.equal(replayWorkspace(recoveryJournal).targetRevision, 'base-1');

let effectsJournal: readonly WorkspaceEvent[] = initialWorkspaceJournal('project-effects');
const effectDispatch = (command: WorkspaceCommand): void => { effectsJournal = dispatchWorkspace(effectsJournal, command); };
effectDispatch({
  type: 'prepare_effect', id: 'effect-pr', capability: 'github', operation: 'create_pr', idempotencyKey: 'run-1:pr',
  risk: 'medium', reversibility: 'compensatable', compensationOperation: 'close_pr',
});
assert.throws(() => effectDispatch({ type: 'settle_effect', effectId: 'effect-pr', outcome: 'committed', receipt: 'pr:1' }), /not executable/u);
effectDispatch({ type: 'approve_effect', effectId: 'effect-pr' });
effectDispatch({ type: 'settle_effect', effectId: 'effect-pr', outcome: 'committed', receipt: 'pr:1' });
effectDispatch({ type: 'compensate_effect', effectId: 'effect-pr', outcome: 'committed', receipt: 'pr:1:closed' });
assert.equal(replayWorkspace(effectsJournal).effects['effect-pr']?.status, 'compensated');

effectDispatch({
  type: 'prepare_effect', id: 'effect-email', capability: 'email', operation: 'send', idempotencyKey: 'run-1:email',
  risk: 'high', reversibility: 'irreversible',
});
effectDispatch({ type: 'approve_effect', effectId: 'effect-email' });
effectDispatch({ type: 'settle_effect', effectId: 'effect-email', outcome: 'outcome_unknown' });
assert.equal(replayWorkspace(effectsJournal).effects['effect-email']?.status, 'outcome_unknown');
assert.throws(() => effectDispatch({ type: 'cancel_effect', effectId: 'effect-email' }), /cannot be cancelled/u);
assert.throws(() => effectDispatch({ type: 'compensate_effect', effectId: 'effect-email', outcome: 'committed' }), /confirmed committed/u);

effectDispatch({
  type: 'prepare_effect', id: 'effect-deploy', capability: 'deploy', operation: 'release', idempotencyKey: 'run-1:deploy',
  risk: 'high', reversibility: 'compensatable', compensationOperation: 'redeploy_previous_release',
});
effectDispatch({ type: 'approve_effect', effectId: 'effect-deploy' });
effectDispatch({ type: 'settle_effect', effectId: 'effect-deploy', outcome: 'committed', receipt: 'release:2' });
effectDispatch({ type: 'compensate_effect', effectId: 'effect-deploy', outcome: 'failed', receipt: 'rollback:failed' });
assert.equal(replayWorkspace(effectsJournal).effects['effect-deploy']?.status, 'compensation_failed');

console.log('Workspace/Integration scenarios passed: isolated parallel writes, accepted Change Sets without auto-merge, conflict task, CAS stale target, fenced recovery, discard, gated effects, honest unknown and compensation outcomes.');
