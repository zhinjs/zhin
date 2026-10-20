/**
 * PROTOTYPE — delete after decision-map ticket #6 is absorbed.
 *
 * Question: can two mutable Assignments work from the same repository base in
 * isolated leases, hand off immutable Change Sets, and require a separate
 * Integration Task / Effect Ledger for publication, cancellation and honest
 * compensation semantics?
 */

export type WorkspaceBackend = 'git_worktree' | 'overlay' | 'sandbox_volume' | 'read_only_snapshot';
export type WorkspaceStatus = 'active' | 'checkpointed' | 'sealed' | 'discarded';
export type IntegrationStatus =
  | 'conflicted'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'awaiting_gate'
  | 'ready_to_commit'
  | 'committed'
  | 'stale'
  | 'cancelled';
export type EffectStatus =
  | 'prepared'
  | 'awaiting_gate'
  | 'ready'
  | 'committed'
  | 'failed'
  | 'outcome_unknown'
  | 'cancelled'
  | 'compensated'
  | 'compensation_failed'
  | 'compensation_unknown';

export interface WorkspaceLease {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly backend: WorkspaceBackend;
  readonly baseRevision: string;
  readonly mountRef: string;
  readonly fence: number;
  readonly mutable: boolean;
  readonly status: WorkspaceStatus;
  readonly changes: Readonly<Record<string, string | null>>;
}

export interface ChangeSet {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly baseRevision: string;
  readonly changes: Readonly<Record<string, string | null>>;
  readonly manifestHash: string;
  readonly evidenceRefs: readonly string[];
  readonly status: 'candidate' | 'accepted' | 'rejected';
}

export interface IntegrationConflict {
  readonly path: string;
  readonly kind: 'change_set_overlap' | 'target_moved_path';
  readonly candidates: readonly string[];
}

export interface IntegrationTask {
  readonly id: string;
  readonly projectId: string;
  readonly targetRevision: string;
  readonly orderedChangeSetIds: readonly string[];
  readonly candidateFiles: Readonly<Record<string, string>>;
  readonly conflicts: readonly IntegrationConflict[];
  readonly status: IntegrationStatus;
  readonly acceptanceId?: string;
  readonly gateId?: string;
  readonly committedRevision?: string;
}

export interface EffectRecord {
  readonly id: string;
  readonly capability: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly reversibility: 'discard_only' | 'compensatable' | 'irreversible';
  readonly compensationOperation?: string;
  readonly status: EffectStatus;
  readonly receipt?: string;
  readonly compensationReceipt?: string;
}

export interface WorkspaceIntegrationState {
  readonly sequence: number;
  readonly projectId: string;
  readonly targetRevision: string;
  readonly targetFiles: Readonly<Record<string, string>>;
  readonly snapshots: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly workspaces: Readonly<Record<string, WorkspaceLease>>;
  readonly changeSets: Readonly<Record<string, ChangeSet>>;
  readonly integrations: Readonly<Record<string, IntegrationTask>>;
  readonly effects: Readonly<Record<string, EffectRecord>>;
}

export type WorkspaceEvent = Readonly<{
  seq: number;
  type:
    | 'project.repository_registered'
    | 'workspace.allocated'
    | 'workspace.changed'
    | 'workspace.checkpointed'
    | 'workspace.resumed'
    | 'workspace.sealed'
    | 'workspace.discarded'
    | 'change_set.accepted'
    | 'change_set.rejected'
    | 'integration.prepared'
    | 'integration.conflicts_resolved'
    | 'integration.accepted'
    | 'integration.gate_requested'
    | 'integration.gate_approved'
    | 'integration.committed'
    | 'integration.stale'
    | 'integration.cancelled'
    | 'target.externally_advanced'
    | 'effect.prepared'
    | 'effect.gate_approved'
    | 'effect.settled'
    | 'effect.cancelled'
    | 'effect.compensation_settled';
  payload: Readonly<Record<string, unknown>>;
}>;

export type WorkspaceCommand =
  | Readonly<{
      type: 'allocate_workspace'; id: string; runId: string; taskKey: string; taskRevision: number;
      assignmentId: string; attempt: number; backend: WorkspaceBackend; mutable: boolean;
    }>
  | Readonly<{ type: 'write_workspace'; workspaceId: string; fence: number; path: string; content: string | null }>
  | Readonly<{ type: 'checkpoint_workspace'; workspaceId: string; fence: number }>
  | Readonly<{ type: 'resume_workspace'; workspaceId: string; assignmentId: string; attempt: number }>
  | Readonly<{ type: 'seal_workspace'; workspaceId: string; fence: number; evidenceRefs: readonly string[] }>
  | Readonly<{ type: 'discard_workspace'; workspaceId: string; reason: string }>
  | Readonly<{ type: 'accept_change_set'; changeSetId: string; acceptanceId: string }>
  | Readonly<{ type: 'reject_change_set'; changeSetId: string; reason: string }>
  | Readonly<{ type: 'prepare_integration'; id: string; orderedChangeSetIds: readonly string[] }>
  | Readonly<{ type: 'resolve_integration_conflicts'; integrationId: string; resolutions: Readonly<Record<string, string>> }>
  | Readonly<{ type: 'accept_integration'; integrationId: string; acceptanceId: string }>
  | Readonly<{ type: 'request_integration_commit'; integrationId: string; gateId: string }>
  | Readonly<{ type: 'approve_integration_gate'; integrationId: string; gateId: string }>
  | Readonly<{ type: 'commit_integration'; integrationId: string }>
  | Readonly<{ type: 'cancel_integration'; integrationId: string; reason: string }>
  | Readonly<{ type: 'advance_target'; revision: string; changes: Readonly<Record<string, string | null>> }>
  | Readonly<{
      type: 'prepare_effect'; id: string; capability: string; operation: string; idempotencyKey: string;
      risk: EffectRecord['risk']; reversibility: EffectRecord['reversibility']; compensationOperation?: string;
    }>
  | Readonly<{ type: 'approve_effect'; effectId: string }>
  | Readonly<{ type: 'settle_effect'; effectId: string; outcome: 'committed' | 'failed' | 'outcome_unknown'; receipt?: string }>
  | Readonly<{ type: 'cancel_effect'; effectId: string }>
  | Readonly<{ type: 'compensate_effect'; effectId: string; outcome: 'committed' | 'failed' | 'outcome_unknown'; receipt?: string }>;

export function initialWorkspaceJournal(
  projectId = 'project-zhin',
  revision = 'base-1',
  files: Readonly<Record<string, string>> = Object.freeze({
    'src/auth.ts': 'export const modes = ["token"]',
    'src/router.ts': 'export const route = "legacy"',
    'README.md': '# Project',
  }),
): readonly WorkspaceEvent[] {
  return [event(0, 'project.repository_registered', { projectId, revision, files: freeze(files) })];
}

export function replayWorkspace(events: readonly WorkspaceEvent[]): WorkspaceIntegrationState {
  if (events[0]?.type !== 'project.repository_registered') throw new Error('journal must start with repository registration');
  const first = events[0];
  const revision = String(first.payload.revision);
  const files = first.payload.files as Readonly<Record<string, string>>;
  let state: WorkspaceIntegrationState = {
    sequence: 0,
    projectId: String(first.payload.projectId),
    targetRevision: revision,
    targetFiles: files,
    snapshots: { [revision]: files },
    workspaces: {},
    changeSets: {},
    integrations: {},
    effects: {},
  };
  for (const entry of events) state = evolve(state, entry);
  return state;
}

export function dispatchWorkspace(
  journal: readonly WorkspaceEvent[],
  command: WorkspaceCommand,
): readonly WorkspaceEvent[] {
  const state = replayWorkspace(journal);
  const decided = decide(state, command);
  return Object.freeze([
    ...journal,
    ...decided.map((entry, index) => Object.freeze({ ...entry, seq: journal.length + index })),
  ]);
}

function decide(state: WorkspaceIntegrationState, command: WorkspaceCommand): readonly Omit<WorkspaceEvent, 'seq'>[] {
  switch (command.type) {
    case 'allocate_workspace': {
      if (state.workspaces[command.id]) throw new Error(`workspace exists: ${command.id}`);
      if (command.mutable && command.backend === 'read_only_snapshot') throw new Error('mutable Assignment requires an isolated mutable backend');
      if (!command.mutable && command.backend !== 'read_only_snapshot') throw new Error('read-only Assignment must not receive a writable workspace');
      const workspace: WorkspaceLease = {
        id: command.id,
        projectId: state.projectId,
        runId: command.runId,
        taskKey: command.taskKey,
        taskRevision: command.taskRevision,
        assignmentId: command.assignmentId,
        attempt: command.attempt,
        backend: command.backend,
        baseRevision: state.targetRevision,
        mountRef: `workspace://${command.id}`,
        fence: 1,
        mutable: command.mutable,
        status: 'active',
        changes: {},
      };
      return [domainEvent('workspace.allocated', { workspace })];
    }
    case 'write_workspace': {
      const workspace = requireWorkspace(state, command.workspaceId);
      requireWritable(workspace, command.fence);
      if (!command.path || command.path.startsWith('/') || command.path.split('/').includes('..')) {
        throw new Error('workspace path must be relative and contained');
      }
      return [domainEvent('workspace.changed', {
        workspaceId: workspace.id,
        fence: workspace.fence,
        path: command.path,
        content: command.content,
      })];
    }
    case 'checkpoint_workspace': {
      const workspace = requireWorkspace(state, command.workspaceId);
      requireWritable(workspace, command.fence);
      return [domainEvent('workspace.checkpointed', { workspaceId: workspace.id, fence: workspace.fence + 1 })];
    }
    case 'resume_workspace': {
      const workspace = requireWorkspace(state, command.workspaceId);
      if (workspace.status !== 'checkpointed') throw new Error('only checkpointed workspace can resume');
      return [domainEvent('workspace.resumed', {
        workspaceId: workspace.id,
        assignmentId: command.assignmentId,
        attempt: command.attempt,
        fence: workspace.fence + 1,
      })];
    }
    case 'seal_workspace': {
      const workspace = requireWorkspace(state, command.workspaceId);
      requireWritable(workspace, command.fence);
      const changeSet: ChangeSet = {
        id: `changeset:${workspace.id}:f${workspace.fence}`,
        workspaceId: workspace.id,
        projectId: workspace.projectId,
        taskKey: workspace.taskKey,
        taskRevision: workspace.taskRevision,
        assignmentId: workspace.assignmentId,
        baseRevision: workspace.baseRevision,
        changes: workspace.changes,
        manifestHash: hash({ base: workspace.baseRevision, changes: workspace.changes }),
        evidenceRefs: [...command.evidenceRefs],
        status: 'candidate',
      };
      return [domainEvent('workspace.sealed', { workspaceId: workspace.id, changeSet })];
    }
    case 'discard_workspace': {
      const workspace = requireWorkspace(state, command.workspaceId);
      if (workspace.status === 'discarded') throw new Error('workspace already discarded');
      return [domainEvent('workspace.discarded', { workspaceId: workspace.id, reason: command.reason })];
    }
    case 'accept_change_set': {
      const changeSet = requireChangeSet(state, command.changeSetId);
      if (changeSet.status !== 'candidate') throw new Error('only candidate Change Set can be accepted');
      return [domainEvent('change_set.accepted', { changeSetId: changeSet.id, acceptanceId: command.acceptanceId })];
    }
    case 'reject_change_set': {
      const changeSet = requireChangeSet(state, command.changeSetId);
      if (changeSet.status !== 'candidate') throw new Error('only candidate Change Set can be rejected');
      return [domainEvent('change_set.rejected', { changeSetId: changeSet.id, reason: command.reason })];
    }
    case 'prepare_integration': {
      if (state.integrations[command.id]) throw new Error(`integration exists: ${command.id}`);
      const changeSets = command.orderedChangeSetIds.map((id) => requireChangeSet(state, id));
      if (changeSets.some((changeSet) => changeSet.status !== 'accepted')) throw new Error('Integration consumes accepted Change Sets only');
      const prepared = prepareCandidate(state, changeSets);
      const integration: IntegrationTask = {
        id: command.id,
        projectId: state.projectId,
        targetRevision: state.targetRevision,
        orderedChangeSetIds: [...command.orderedChangeSetIds],
        candidateFiles: prepared.files,
        conflicts: prepared.conflicts,
        status: prepared.conflicts.length > 0 ? 'conflicted' : 'awaiting_acceptance',
      };
      return [domainEvent('integration.prepared', { integration })];
    }
    case 'resolve_integration_conflicts': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status !== 'conflicted') throw new Error('integration has no unresolved conflicts');
      for (const conflict of integration.conflicts) {
        if (!(conflict.path in command.resolutions)) throw new Error(`missing conflict resolution: ${conflict.path}`);
      }
      return [domainEvent('integration.conflicts_resolved', {
        integrationId: integration.id,
        resolutions: command.resolutions,
      })];
    }
    case 'accept_integration': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status !== 'awaiting_acceptance') throw new Error('integration candidate is not awaiting acceptance');
      return [domainEvent('integration.accepted', { integrationId: integration.id, acceptanceId: command.acceptanceId })];
    }
    case 'request_integration_commit': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status !== 'accepted') throw new Error('only accepted integration can request canonical commit');
      return [domainEvent('integration.gate_requested', { integrationId: integration.id, gateId: command.gateId })];
    }
    case 'approve_integration_gate': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status !== 'awaiting_gate' || integration.gateId !== command.gateId) throw new Error('integration gate mismatch');
      return [domainEvent('integration.gate_approved', { integrationId: integration.id, gateId: command.gateId })];
    }
    case 'commit_integration': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status !== 'ready_to_commit') throw new Error('integration is not approved for commit');
      if (state.targetRevision !== integration.targetRevision) {
        return [domainEvent('integration.stale', {
          integrationId: integration.id,
          expectedRevision: integration.targetRevision,
          actualRevision: state.targetRevision,
        })];
      }
      const revision = `revision:${integration.id}:${hash(integration.candidateFiles)}`;
      return [domainEvent('integration.committed', {
        integrationId: integration.id,
        previousRevision: state.targetRevision,
        revision,
        files: integration.candidateFiles,
      })];
    }
    case 'cancel_integration': {
      const integration = requireIntegration(state, command.integrationId);
      if (integration.status === 'committed') throw new Error('committed integration cannot be cancelled; use a new revert Change Set');
      return [domainEvent('integration.cancelled', { integrationId: integration.id, reason: command.reason })];
    }
    case 'advance_target': {
      if (state.snapshots[command.revision]) throw new Error('target revision already exists');
      return [domainEvent('target.externally_advanced', {
        revision: command.revision,
        files: applyChanges(state.targetFiles, command.changes),
      })];
    }
    case 'prepare_effect': {
      if (state.effects[command.id]) throw new Error(`effect exists: ${command.id}`);
      if (command.reversibility === 'compensatable' && !command.compensationOperation) {
        throw new Error('compensatable effect requires a capability-declared compensation operation');
      }
      if (command.reversibility !== 'compensatable' && command.compensationOperation) {
        throw new Error('only compensatable effect may declare compensation');
      }
      const gated = command.risk !== 'low' || command.reversibility === 'irreversible';
      const effect: EffectRecord = {
        id: command.id,
        capability: command.capability,
        operation: command.operation,
        idempotencyKey: command.idempotencyKey,
        risk: command.risk,
        reversibility: command.reversibility,
        ...(command.compensationOperation ? { compensationOperation: command.compensationOperation } : {}),
        status: gated ? 'awaiting_gate' : 'prepared',
      };
      return [domainEvent('effect.prepared', { effect })];
    }
    case 'approve_effect': {
      const effect = requireEffect(state, command.effectId);
      if (effect.status !== 'awaiting_gate') throw new Error('effect is not awaiting approval');
      return [domainEvent('effect.gate_approved', { effectId: effect.id })];
    }
    case 'settle_effect': {
      const effect = requireEffect(state, command.effectId);
      if (!['prepared', 'ready'].includes(effect.status)) throw new Error('effect is not executable');
      return [domainEvent('effect.settled', { effectId: effect.id, outcome: command.outcome, receipt: command.receipt })];
    }
    case 'cancel_effect': {
      const effect = requireEffect(state, command.effectId);
      if (!['prepared', 'awaiting_gate', 'ready'].includes(effect.status)) {
        throw new Error('started/settled effect cannot be cancelled; reconcile or compensate it');
      }
      return [domainEvent('effect.cancelled', { effectId: effect.id })];
    }
    case 'compensate_effect': {
      const effect = requireEffect(state, command.effectId);
      if (effect.status !== 'committed') throw new Error('only a confirmed committed effect can be compensated');
      if (effect.reversibility !== 'compensatable' || !effect.compensationOperation) {
        throw new Error('capability does not declare compensation for this effect');
      }
      return [domainEvent('effect.compensation_settled', {
        effectId: effect.id,
        operation: effect.compensationOperation,
        outcome: command.outcome,
        receipt: command.receipt,
      })];
    }
  }
}

function evolve(state: WorkspaceIntegrationState, entry: WorkspaceEvent): WorkspaceIntegrationState {
  const workspaces = { ...state.workspaces };
  const changeSets = { ...state.changeSets };
  const integrations = { ...state.integrations };
  const effects = { ...state.effects };
  const snapshots = { ...state.snapshots };
  let next: WorkspaceIntegrationState = { ...state, sequence: entry.seq, workspaces, changeSets, integrations, effects, snapshots };
  const payload = entry.payload;
  switch (entry.type) {
    case 'project.repository_registered': break;
    case 'workspace.allocated': {
      const workspace = payload.workspace as unknown as WorkspaceLease;
      workspaces[workspace.id] = workspace;
      break;
    }
    case 'workspace.changed': {
      const workspace = requireWorkspace(next, String(payload.workspaceId));
      workspaces[workspace.id] = freeze({
        ...workspace,
        changes: { ...workspace.changes, [String(payload.path)]: payload.content as string | null },
      });
      break;
    }
    case 'workspace.checkpointed': {
      const workspace = requireWorkspace(next, String(payload.workspaceId));
      workspaces[workspace.id] = freeze({ ...workspace, status: 'checkpointed', fence: Number(payload.fence) });
      break;
    }
    case 'workspace.resumed': {
      const workspace = requireWorkspace(next, String(payload.workspaceId));
      workspaces[workspace.id] = freeze({
        ...workspace,
        status: 'active',
        assignmentId: String(payload.assignmentId),
        attempt: Number(payload.attempt),
        fence: Number(payload.fence),
      });
      break;
    }
    case 'workspace.sealed': {
      const workspace = requireWorkspace(next, String(payload.workspaceId));
      workspaces[workspace.id] = freeze({ ...workspace, status: 'sealed' });
      const changeSet = payload.changeSet as unknown as ChangeSet;
      changeSets[changeSet.id] = changeSet;
      break;
    }
    case 'workspace.discarded': {
      const workspace = requireWorkspace(next, String(payload.workspaceId));
      workspaces[workspace.id] = freeze({ ...workspace, status: 'discarded', fence: workspace.fence + 1 });
      break;
    }
    case 'change_set.accepted': {
      const changeSet = requireChangeSet(next, String(payload.changeSetId));
      changeSets[changeSet.id] = freeze({ ...changeSet, status: 'accepted' });
      break;
    }
    case 'change_set.rejected': {
      const changeSet = requireChangeSet(next, String(payload.changeSetId));
      changeSets[changeSet.id] = freeze({ ...changeSet, status: 'rejected' });
      break;
    }
    case 'integration.prepared': {
      const integration = payload.integration as unknown as IntegrationTask;
      integrations[integration.id] = integration;
      break;
    }
    case 'integration.conflicts_resolved': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({
        ...integration,
        candidateFiles: applyChanges(integration.candidateFiles, payload.resolutions as Readonly<Record<string, string>>),
        conflicts: [],
        status: 'awaiting_acceptance',
      });
      break;
    }
    case 'integration.accepted': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({ ...integration, status: 'accepted', acceptanceId: String(payload.acceptanceId) });
      break;
    }
    case 'integration.gate_requested': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({ ...integration, status: 'awaiting_gate', gateId: String(payload.gateId) });
      break;
    }
    case 'integration.gate_approved': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({ ...integration, status: 'ready_to_commit' });
      break;
    }
    case 'integration.committed': {
      const integration = requireIntegration(next, String(payload.integrationId));
      const revision = String(payload.revision);
      const files = payload.files as Readonly<Record<string, string>>;
      integrations[integration.id] = freeze({ ...integration, status: 'committed', committedRevision: revision });
      snapshots[revision] = files;
      next = { ...next, targetRevision: revision, targetFiles: files };
      break;
    }
    case 'integration.stale': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({ ...integration, status: 'stale' });
      break;
    }
    case 'integration.cancelled': {
      const integration = requireIntegration(next, String(payload.integrationId));
      integrations[integration.id] = freeze({ ...integration, status: 'cancelled' });
      break;
    }
    case 'target.externally_advanced': {
      const revision = String(payload.revision);
      const files = payload.files as Readonly<Record<string, string>>;
      snapshots[revision] = files;
      next = { ...next, targetRevision: revision, targetFiles: files };
      break;
    }
    case 'effect.prepared': {
      const effect = payload.effect as unknown as EffectRecord;
      effects[effect.id] = effect;
      break;
    }
    case 'effect.gate_approved': {
      const effect = requireEffect(next, String(payload.effectId));
      effects[effect.id] = freeze({ ...effect, status: 'ready' });
      break;
    }
    case 'effect.settled': {
      const effect = requireEffect(next, String(payload.effectId));
      effects[effect.id] = freeze({
        ...effect,
        status: String(payload.outcome) as 'committed' | 'failed' | 'outcome_unknown',
        ...(payload.receipt ? { receipt: String(payload.receipt) } : {}),
      });
      break;
    }
    case 'effect.cancelled': {
      const effect = requireEffect(next, String(payload.effectId));
      effects[effect.id] = freeze({ ...effect, status: 'cancelled' });
      break;
    }
    case 'effect.compensation_settled': {
      const effect = requireEffect(next, String(payload.effectId));
      const outcome = String(payload.outcome);
      effects[effect.id] = freeze({
        ...effect,
        status: outcome === 'committed' ? 'compensated' : outcome === 'failed' ? 'compensation_failed' : 'compensation_unknown',
        ...(payload.receipt ? { compensationReceipt: String(payload.receipt) } : {}),
      });
      break;
    }
  }
  return next;
}

function prepareCandidate(
  state: WorkspaceIntegrationState,
  changeSets: readonly ChangeSet[],
): Readonly<{ files: Readonly<Record<string, string>>; conflicts: readonly IntegrationConflict[] }> {
  let files: Readonly<Record<string, string>> = state.targetFiles;
  const proposed = new Map<string, string[]>();
  const conflicts: IntegrationConflict[] = [];
  for (const changeSet of changeSets) {
    const base = state.snapshots[changeSet.baseRevision];
    if (!base) throw new Error(`missing base snapshot: ${changeSet.baseRevision}`);
    for (const [path, value] of Object.entries(changeSet.changes)) {
      const desired = value ?? '<deleted>';
      const candidates = proposed.get(path) ?? [];
      candidates.push(desired);
      proposed.set(path, candidates);
      if ((state.targetFiles[path] ?? '<deleted>') !== (base[path] ?? '<deleted>')) {
        conflicts.push({ path, kind: 'target_moved_path', candidates: [state.targetFiles[path] ?? '<deleted>', desired] });
      }
    }
  }
  for (const [path, candidates] of proposed) {
    const unique = [...new Set(candidates)];
    if (unique.length > 1) conflicts.push({ path, kind: 'change_set_overlap', candidates: unique });
    else files = applyChanges(files, { [path]: unique[0] === '<deleted>' ? null : unique[0]! });
  }
  return freeze({ files, conflicts: dedupeConflicts(conflicts) });
}

function requireWritable(workspace: WorkspaceLease, fence: number): void {
  if (!workspace.mutable) throw new Error('read-only workspace cannot be mutated');
  if (workspace.status !== 'active') throw new Error(`workspace is ${workspace.status}`);
  if (workspace.fence !== fence) throw new Error(`stale workspace fence: expected ${workspace.fence}, received ${fence}`);
}

function requireWorkspace(state: WorkspaceIntegrationState, id: string): WorkspaceLease {
  const value = state.workspaces[id];
  if (!value) throw new Error(`unknown workspace: ${id}`);
  return value;
}

function requireChangeSet(state: WorkspaceIntegrationState, id: string): ChangeSet {
  const value = state.changeSets[id];
  if (!value) throw new Error(`unknown Change Set: ${id}`);
  return value;
}

function requireIntegration(state: WorkspaceIntegrationState, id: string): IntegrationTask {
  const value = state.integrations[id];
  if (!value) throw new Error(`unknown Integration Task: ${id}`);
  return value;
}

function requireEffect(state: WorkspaceIntegrationState, id: string): EffectRecord {
  const value = state.effects[id];
  if (!value) throw new Error(`unknown effect: ${id}`);
  return value;
}

function applyChanges(
  files: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string>> {
  const next = { ...files };
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) delete next[path];
    else next[path] = content;
  }
  return freeze(next);
}

function dedupeConflicts(conflicts: readonly IntegrationConflict[]): readonly IntegrationConflict[] {
  return [...new Map(conflicts.map((conflict) => [`${conflict.kind}:${conflict.path}`, freeze(conflict)])).values()];
}

function hash(value: unknown): string {
  const text = JSON.stringify(value);
  let result = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function event(seq: number, type: WorkspaceEvent['type'], payload: Record<string, unknown>): WorkspaceEvent {
  return freeze({ seq, type, payload: freeze(payload) });
}

function domainEvent(type: WorkspaceEvent['type'], payload: Record<string, unknown>): Omit<WorkspaceEvent, 'seq'> {
  return freeze({ type, payload: freeze(payload) });
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry))) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, freeze(entry)]))) as T;
}
