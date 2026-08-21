#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #6. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  dispatchWorkspace,
  initialWorkspaceJournal,
  replayWorkspace,
  type WorkspaceCommand,
  type WorkspaceEvent,
} from './workspace-integration.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
let journal: readonly WorkspaceEvent[] = initialWorkspaceJournal();
let lastMessage = 'Canonical target is unchanged. Allocate isolated Assignment workspaces.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === '1') allocatePair();
    else if (answer === '2') writePair(false);
    else if (answer === 'x') writePair(true);
    else if (answer === '3') sealAndAcceptPair();
    else if (answer === '4') prepareIntegration();
    else if (answer === 'r') resolveConflict();
    else if (answer === '5') acceptGateCommit();
    else if (answer === 'k') checkpointResume();
    else if (answer === 'c') cancelWorkspace();
    else if (answer === 'e') compensatableEffect();
    else if (answer === 'i') irreversibleUnknown();
    else lastMessage = `Unknown action: ${answer || '(empty)'}`;
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function dispatch(command: WorkspaceCommand): void {
  journal = dispatchWorkspace(journal, command);
}

function allocatePair(): void {
  dispatch({ type: 'allocate_workspace', id: 'ws-a', runId: 'run-1', taskKey: 'auth', taskRevision: 1, assignmentId: 'assignment-a', attempt: 1, backend: 'git_worktree', mutable: true });
  dispatch({ type: 'allocate_workspace', id: 'ws-b', runId: 'run-1', taskKey: 'router', taskRevision: 1, assignmentId: 'assignment-b', attempt: 1, backend: 'git_worktree', mutable: true });
  lastMessage = 'Two mutable Assignments received separate leases at the same base revision.';
}

function writePair(conflict: boolean): void {
  dispatch({ type: 'write_workspace', workspaceId: 'ws-a', fence: currentFence('ws-a'), path: 'src/auth.ts', content: 'export const modes = ["oauth"]' });
  dispatch({
    type: 'write_workspace', workspaceId: 'ws-b', fence: currentFence('ws-b'),
    path: conflict ? 'src/auth.ts' : 'src/router.ts',
    content: conflict ? 'export const modes = ["passkey"]' : 'export const route = "modern"',
  });
  lastMessage = conflict ? 'Both workspaces changed the same file without touching each other.' : 'Disjoint writes remain isolated; canonical target is unchanged.';
}

function sealAndAcceptPair(): void {
  for (const id of ['ws-a', 'ws-b']) {
    dispatch({ type: 'seal_workspace', workspaceId: id, fence: currentFence(id), evidenceRefs: [`test://${id}`] });
    const candidate = Object.values(replayWorkspace(journal).changeSets).find((entry) => entry.workspaceId === id)!;
    dispatch({ type: 'accept_change_set', changeSetId: candidate.id, acceptanceId: `accept:${candidate.id}` });
  }
  lastMessage = 'Accepted immutable Change Sets; canonical target is still unchanged.';
}

function prepareIntegration(): void {
  const ids = Object.values(replayWorkspace(journal).changeSets).filter((entry) => entry.status === 'accepted').map((entry) => entry.id).sort();
  dispatch({ type: 'prepare_integration', id: 'integration-1', orderedChangeSetIds: ids });
  lastMessage = replayWorkspace(journal).integrations['integration-1']?.status === 'conflicted'
    ? 'Integration Task surfaced an explicit conflict; producer Tasks remain accepted.'
    : 'Integration candidate prepared in isolation and awaits separate acceptance.';
}

function resolveConflict(): void {
  dispatch({ type: 'resolve_integration_conflicts', integrationId: 'integration-1', resolutions: { 'src/auth.ts': 'export const modes = ["oauth", "passkey"]' } });
  lastMessage = 'Conflict resolution produced a new candidate and still awaits acceptance.';
}

function acceptGateCommit(): void {
  const integration = replayWorkspace(journal).integrations['integration-1'];
  if (!integration) throw new Error('prepare integration first');
  if (integration.status === 'awaiting_acceptance') dispatch({ type: 'accept_integration', integrationId: integration.id, acceptanceId: 'accept:integration-1' });
  if (replayWorkspace(journal).integrations[integration.id]?.status === 'accepted') dispatch({ type: 'request_integration_commit', integrationId: integration.id, gateId: 'gate:canonical-write' });
  if (replayWorkspace(journal).integrations[integration.id]?.status === 'awaiting_gate') dispatch({ type: 'approve_integration_gate', integrationId: integration.id, gateId: 'gate:canonical-write' });
  dispatch({ type: 'commit_integration', integrationId: integration.id });
  lastMessage = 'Accepted Integration passed a canonical-write gate and committed by CAS.';
}

function checkpointResume(): void {
  const workspace = replayWorkspace(journal).workspaces['ws-a'];
  if (!workspace) throw new Error('allocate pair first');
  if (workspace.status === 'active') dispatch({ type: 'checkpoint_workspace', workspaceId: workspace.id, fence: workspace.fence });
  const checkpointed = replayWorkspace(journal).workspaces['ws-a']!;
  dispatch({ type: 'resume_workspace', workspaceId: checkpointed.id, assignmentId: 'assignment-a-replacement', attempt: checkpointed.attempt + 1 });
  lastMessage = `Replacement Assignment resumed with fence=${currentFence('ws-a')}; the prior writer is fenced out.`;
}

function cancelWorkspace(): void {
  dispatch({ type: 'discard_workspace', workspaceId: 'ws-b', reason: 'cancelled before publication' });
  lastMessage = 'Unpublished isolated workspace discarded; no canonical rollback was needed.';
}

function compensatableEffect(): void {
  const state = replayWorkspace(journal);
  if (!state.effects['effect-pr']) {
    dispatch({ type: 'prepare_effect', id: 'effect-pr', capability: 'github', operation: 'create_pr', idempotencyKey: 'run-1:pr', risk: 'medium', reversibility: 'compensatable', compensationOperation: 'close_pr' });
    dispatch({ type: 'approve_effect', effectId: 'effect-pr' });
    dispatch({ type: 'settle_effect', effectId: 'effect-pr', outcome: 'committed', receipt: 'pr:1' });
    lastMessage = 'PR side effect committed with a durable receipt and declared close_pr compensation.';
  } else {
    dispatch({ type: 'compensate_effect', effectId: 'effect-pr', outcome: 'committed', receipt: 'pr:1:closed' });
    lastMessage = 'Compensation succeeded as a new audited effect; original PR fact remains in history.';
  }
}

function irreversibleUnknown(): void {
  dispatch({ type: 'prepare_effect', id: 'effect-email', capability: 'email', operation: 'send', idempotencyKey: 'run-1:email', risk: 'high', reversibility: 'irreversible' });
  dispatch({ type: 'approve_effect', effectId: 'effect-email' });
  dispatch({ type: 'settle_effect', effectId: 'effect-email', outcome: 'outcome_unknown' });
  lastMessage = 'Email outcome is unknown: cannot cancel, retry blindly or claim rollback; reconciliation is required.';
}

function currentFence(id: string): number {
  const workspace = replayWorkspace(journal).workspaces[id];
  if (!workspace) throw new Error(`workspace not allocated: ${id}`);
  return workspace.fence;
}

function render(): void {
  console.clear();
  const state = replayWorkspace(journal);
  console.log(`${bold}Workspace / Integration / Compensation — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Assignments mutate isolated leases. Only approved Integration/Effect events touch external targets.${reset}\n`);
  console.log(`${bold}CANONICAL TARGET${reset} revision=${state.targetRevision}`);
  for (const [path, content] of Object.entries(state.targetFiles)) console.log(`  ${path}: ${content}`);
  console.log(`${bold}WORKSPACES${reset}`);
  for (const workspace of Object.values(state.workspaces)) console.log(`  ${workspace.id} ${workspace.backend} status=${workspace.status} fence=${workspace.fence} assignment=${workspace.assignmentId} changes=[${Object.keys(workspace.changes).join(',')}]`);
  console.log(`${bold}CHANGE SETS${reset}`);
  for (const changeSet of Object.values(state.changeSets)) console.log(`  ${changeSet.id} status=${changeSet.status} base=${changeSet.baseRevision} hash=${changeSet.manifestHash}`);
  console.log(`${bold}INTEGRATIONS${reset}`);
  for (const integration of Object.values(state.integrations)) console.log(`  ${integration.id} status=${integration.status} target=${integration.targetRevision} conflicts=[${integration.conflicts.map((item) => item.path).join(',')}]`);
  console.log(`${bold}EFFECTS${reset}`);
  for (const effect of Object.values(state.effects)) console.log(`  ${effect.id} ${effect.capability}.${effect.operation} status=${effect.status} reversibility=${effect.reversibility}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-7)) console.log(`  #${entry.seq} ${entry.type}`);
  console.log(`${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [1] allocate pair [2] disjoint writes [x] conflicting writes [3] seal+accept');
  console.log('  [4] prepare integration [r] resolve conflict [5] accept+gate+commit');
  console.log('  [k] checkpoint/resume [c] discard unpublished [e] effect/compensate [i] irreversible unknown [q] quit');
}
