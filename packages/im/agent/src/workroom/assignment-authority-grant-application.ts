import type { MaterializedDisclosureManifest } from '../data-governance/disclosure-manifest.js';
import {
  createWorkroomAssignmentAuthorityGrant,
  type WorkroomAssignmentAuthorityGrant,
  type WorkroomCapabilityCeilingInput,
} from '../plugin-runtime/workroom-assignment-authority-provider.js';
import { digestWorkroomCatalogProjectBinding } from './catalog-definition.js';
import type {
  AssignmentExecutionFactAnchor,
  AssignmentExecutionSnapshotReference,
  AssignmentExecutionWorkspaceReference,
  AssignmentExecutorRole,
} from './assignment-executor.js';
import {
  assertWorkflowPlanProposal,
  type WorkflowPlanProposal,
  type WorkflowTaskCapabilityRequirement,
} from './workflow-plan-builder.js';
import type { WorkroomGithubWorkspaceReference } from './remote-dispatch.js';
import {
  workroomRemoteAssignmentId,
  type WorkroomRemoteAssignmentClaimRequest,
} from './remote-assignment-issuance.js';
import type { WorkroomJournal } from './journal.js';
import { replayWorkroom } from './kernel-state.js';
import type { ProjectProfileRegistry } from './profile-registry.js';
import type { WorkroomCatalog } from './catalog.js';
import { parseWorkroomDispatchTaskDecision } from './workroom-scheduler.js';
import {
  assignmentAuthorityGrantKey,
  createAssignmentAuthorityGrantRecord,
  type AssignmentAuthorityGrantBlockerKind,
  type AssignmentAuthorityGrantRecord,
  type AssignmentAuthorityGrantRepository,
} from './assignment-authority-grant-repository.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export interface WorkroomAssignmentGrantClaimPreview {
  readonly generation: number;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly operationId: string;
  readonly agentDefinitionId: string;
  readonly endpointId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly catalogRevision: string;
  readonly catalogBindingDigest: string;
  readonly role: AssignmentExecutorRole;
  readonly plan: AssignmentExecutionSnapshotReference;
  readonly taskCapabilityRequirements: Readonly<Required<WorkflowTaskCapabilityRequirement>>;
  readonly factAnchor: AssignmentExecutionFactAnchor;
}

export interface WorkroomAssignmentGrantClaimPreviewPort {
  resolve(request: WorkroomRemoteAssignmentClaimRequest): Promise<WorkroomAssignmentGrantClaimPreview>;
}

/** Production preview from exact Journal + persisted Profile/Catalog facts. */
export class JournalWorkroomAssignmentGrantClaimPreview
implements WorkroomAssignmentGrantClaimPreviewPort {
  constructor(readonly options: Readonly<{
    generation: number;
    journal: Pick<WorkroomJournal, 'read'>;
    profiles: Pick<ProjectProfileRegistry, 'read'>;
    catalog: Pick<WorkroomCatalog, 'read'>;
  }>) {}

  async resolve(request: WorkroomRemoteAssignmentClaimRequest): Promise<WorkroomAssignmentGrantClaimPreview> {
    const [events, profileState, catalog] = await Promise.all([
      this.options.journal.read(request.runId),
      this.options.profiles.read(request.projectId),
      this.options.catalog.read(),
    ]);
    const state = replayWorkroom(events);
    if (state.projectId !== request.projectId) throw new Error('Assignment Grant Project/Run scope drift');
    const schedulerFacts = events.filter(event => event.type === 'scheduler.dispatch_requested'
      && event.payload.decisionId === request.operationId);
    if (schedulerFacts.length !== 1) {
      throw new Error('Assignment Grant requires one exact Scheduler decision fact');
    }
    const decision = parseWorkroomDispatchTaskDecision(schedulerFacts[0]!.payload);
    if (decision.projectId !== request.projectId || decision.runId !== request.runId
      || decision.taskKey !== request.taskKey) {
      throw new Error('Assignment Grant Scheduler decision scope drift');
    }
    if (decision.role !== 'executor' && decision.role !== 'integration') {
      throw new Error('Assignment Grant Scheduler role is not remotely executable');
    }
    const task = state.tasks[request.taskKey];
    if (!task || task.revision !== decision.taskRevision || task.status !== 'ready'
      || !task.acceptanceContract) {
      throw new Error('Assignment Grant targets a stale or unpinned Task');
    }
    const pin = profileState.runPins[request.runId];
    const revision = pin && profileState.revisions[pin.profileRevisionId];
    if (!pin || !revision || pin.projectId !== request.projectId
      || revision.compiledDigest !== pin.profileDigest
      || revision.compiledProfile.digest !== pin.profileDigest) {
      throw new Error('Assignment Grant requires an exact persisted Run Profile pin');
    }
    const definition = catalog.definitions[request.projectId];
    if (!definition || definition.enabled === false
      || !definition.members.some(member => member.agent === request.agentDefinitionId
        && member.role === decision.role)) {
      throw new Error('Assignment Grant route is outside the exact Catalog role binding');
    }
    const planFacts = events.filter(event => event.type === 'plan.admitted');
    if (planFacts.length !== 1) throw new Error('Assignment Grant requires one admitted Plan');
    const plan = planFacts[0]!.payload.plan as WorkflowPlanProposal;
    assertWorkflowPlanProposal(plan);
    if (plan.projectId !== request.projectId
      || plan.authority.profileRevisionId !== pin.profileRevisionId
      || plan.authority.profileDigest !== pin.profileDigest
      || plan.authority.projectRevision !== catalog.revision
      || plan.authority.projectDigest !== digestWorkroomCatalogProjectBinding(definition)) {
      throw new Error('Assignment Grant Plan authority pin drift');
    }
    const plannedTask = plan.tasks.find(candidate => candidate.key === request.taskKey);
    if (!plannedTask || plannedTask.role !== decision.role) {
      throw new Error('Assignment Grant Task is absent from the admitted Plan');
    }
    const attempt = task.attempt + 1;
    const fence = Object.values(state.assignments)
      .filter(assignment => assignment.taskKey === task.key)
      .reduce((highest, assignment) => Math.max(highest, assignment.fence), 0) + 1;
    return Object.freeze({
      generation: this.options.generation,
      projectId: request.projectId,
      runId: request.runId,
      taskKey: request.taskKey,
      taskRevision: task.revision,
      assignmentId: workroomRemoteAssignmentId(request.operationId),
      assignmentRevision: 1,
      attempt,
      fence,
      operationId: request.operationId,
      agentDefinitionId: request.agentDefinitionId,
      endpointId: request.endpointId,
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
      catalogRevision: catalog.revision,
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      role: decision.role,
      plan: {
        ref: `workflow-plan:${encodeURIComponent(plan.proposalId)}`,
        revision: planFacts[0]!.sequence + 1,
        digest: plan.digest,
      },
      taskCapabilityRequirements: plannedTask.requires,
      factAnchor: {
        ref: `workroom-journal:${encodeURIComponent(state.runId)}:${state.sequence}`,
        sequence: state.sequence,
        digest: digest(events),
      },
    });
  }
}

export interface WorkroomAssignmentGrantAuthorityMaterialization {
  readonly principalId: string;
  readonly capabilitySnapshotRef: string;
  readonly capabilitySnapshotRevision: number;
  readonly roleCapabilities: WorkroomCapabilityCeilingInput;
  readonly taskCapabilities: WorkroomCapabilityCeilingInput;
  readonly policyCapabilities: WorkroomCapabilityCeilingInput;
  readonly authorizedIntegrations: readonly string[];
  readonly authorizedAuthorities: readonly string[];
  readonly contextPolicy: AssignmentExecutionSnapshotReference;
  readonly policySnapshot: AssignmentExecutionSnapshotReference;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly capabilityGrantRef: string;
  readonly endpointAuthorityDigest: string;
  readonly expiresAt: number;
}

/** Exact role/task/policy ceiling + Context/Policy authority. No default implementation exists. */
export interface WorkroomAssignmentGrantAuthorityMaterializerPort {
  materialize(
    preview: WorkroomAssignmentGrantClaimPreview,
  ): Promise<WorkroomAssignmentGrantAuthorityMaterialization | null>;
}

export interface WorkroomAssignmentWorkspaceAllocation {
  readonly workspace: AssignmentExecutionWorkspaceReference;
  readonly remoteWorkspace: WorkroomGithubWorkspaceReference;
  readonly expiresAt: number;
}

/** Fenced allocator; a null result is a recoverable durable capability blocker. */
export interface WorkroomAssignmentWorkspaceAllocatorPort {
  allocate(
    preview: WorkroomAssignmentGrantClaimPreview,
  ): Promise<WorkroomAssignmentWorkspaceAllocation | null>;
}

/** P12 authority returns the full materialized manifest, never an opaque ref. */
export interface WorkroomAssignmentDisclosureManifestAuthorityPort {
  materialize(input: Readonly<{
    preview: WorkroomAssignmentGrantClaimPreview;
    assignmentId: string;
    principalId: string;
    endpointId: string;
    contextView: Readonly<{ ref: string; hash: string }>;
  }>): Promise<MaterializedDisclosureManifest | null>;
}

export type WorkroomAssignmentGrantPreparationResult =
  | Readonly<{
      status: 'ready';
      record: AssignmentAuthorityGrantRecord;
      grant: WorkroomAssignmentAuthorityGrant;
    }>
  | Readonly<{
      status: 'blocked';
      record: AssignmentAuthorityGrantRecord;
    }>;

export interface WorkroomAssignmentAuthorityGrantApplicationOptions {
  readonly generation: number;
  readonly repository: AssignmentAuthorityGrantRepository;
  readonly preview: WorkroomAssignmentGrantClaimPreviewPort;
  readonly authority?: WorkroomAssignmentGrantAuthorityMaterializerPort;
  readonly workspace?: WorkroomAssignmentWorkspaceAllocatorPort;
  readonly disclosure?: WorkroomAssignmentDisclosureManifestAuthorityPort;
  readonly now?: () => number;
  readonly blockerTtlMs?: number;
}

/**
 * Two-phase claim authority writer. Expected missing authorities become durable
 * blockers; only a complete exact join can be promoted to a ready grant.
 */
export class WorkroomAssignmentAuthorityGrantApplication {
  readonly #now: () => number;
  readonly #blockerTtlMs: number;

  constructor(readonly options: WorkroomAssignmentAuthorityGrantApplicationOptions) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error('Assignment Grant generation must be a positive integer');
    }
    this.#now = options.now ?? Date.now;
    this.#blockerTtlMs = positive(options.blockerTtlMs ?? 300_000, 'blockerTtlMs');
  }

  async prepare(
    request: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomAssignmentGrantPreparationResult> {
    const preview = await this.options.preview.resolve(request);
    const key = assignmentAuthorityGrantKey({
      ...preview,
      requestedAgentDefinitionId: preview.agentDefinitionId,
      requestedEndpointId: preview.endpointId,
    });
    const current = await this.options.repository.read(key);
    if (current?.status === 'ready'
      && current.generation === this.options.generation
      && current.profileRevisionId === preview.profileRevisionId
      && current.profileDigest === preview.profileDigest
      && current.factAnchor.digest === preview.factAnchor.digest
      && current.expiresAt > this.#now()
      && current.grant
      && current.grant.catalogRevision === preview.catalogRevision
      && current.grant.catalogBindingDigest === preview.catalogBindingDigest
      && current.grant.plan.digest === preview.plan.digest) {
      return Object.freeze({ status: 'ready', record: current, grant: current.grant });
    }
    if (preview.generation !== this.options.generation) {
      return await this.#block(preview, current, 'capability',
        'workroom-generation-authority', 'Claim preview belongs to a stale Plugin Runtime generation');
    }
    const authority = await this.options.authority?.materialize(preview) ?? null;
    if (!authority) {
      return await this.#block(preview, current, 'capability',
        'workroom-capability-authority', 'Role/task/policy capability or Context Policy authority is unavailable');
    }
    if (!authoritySatisfiesTask(authority, preview.taskCapabilityRequirements)) {
      return await this.#block(preview, current, 'capability',
        'workroom-capability-authority', 'Task requirements exceed role/task/policy capability ceilings');
    }
    const workspace = await this.options.workspace?.allocate(preview) ?? null;
    if (!workspace) {
      return await this.#block(preview, current, 'capability',
        'workroom-workspace-allocator', 'Fenced Workspace allocation is unavailable');
    }
    if (workspace.workspace.fence !== preview.fence
      || workspace.remoteWorkspace.fence !== preview.fence
      || workspace.workspace.baseRevision !== workspace.remoteWorkspace.baseSha) {
      return await this.#block(preview, current, 'capability',
        'workroom-workspace-allocator', 'Fenced Workspace allocation drifted from the exact Assignment');
    }
    const manifest = await this.options.disclosure?.materialize({
      preview,
      assignmentId: preview.assignmentId,
      principalId: authority.principalId,
      endpointId: preview.endpointId,
      contextView: authority.contextView,
    }) ?? null;
    if (!manifest) {
      return await this.#block(preview, current, 'disclosure',
        'workroom-disclosure-authority', 'Materialized Disclosure Manifest authority is unavailable');
    }
    if (!validManifest(manifest, preview, authority.principalId)) {
      return await this.#block(preview, current, 'disclosure',
        'workroom-disclosure-authority', 'Materialized Disclosure Manifest scope or digest drift');
    }
    const now = this.#now();
    const expiresAt = Math.min(authority.expiresAt, workspace.expiresAt, manifest.expiresAt);
    if (expiresAt <= now) {
      return await this.#block(preview, current, 'disclosure',
        'workroom-disclosure-authority', 'Assignment authority expires before issuance');
    }
    const grant = createWorkroomAssignmentAuthorityGrant({
      generation: preview.generation,
      projectId: preview.projectId,
      runId: preview.runId,
      taskKey: preview.taskKey,
      taskRevision: preview.taskRevision,
      assignmentId: preview.assignmentId,
      assignmentRevision: preview.assignmentRevision,
      attempt: preview.attempt,
      fence: preview.fence,
      agentDefinitionId: preview.agentDefinitionId,
      endpointId: preview.endpointId,
      endpointAuthorityDigest: authority.endpointAuthorityDigest,
      catalogRevision: preview.catalogRevision,
      catalogBindingDigest: preview.catalogBindingDigest,
      profileRevisionId: preview.profileRevisionId,
      profileDigest: preview.profileDigest,
      principalId: authority.principalId,
      role: preview.role,
      capabilitySnapshotRef: authority.capabilitySnapshotRef,
      capabilitySnapshotRevision: authority.capabilitySnapshotRevision,
      roleCapabilities: authority.roleCapabilities,
      taskCapabilities: authority.taskCapabilities,
      policyCapabilities: authority.policyCapabilities,
      plan: preview.plan,
      contextPolicy: authority.contextPolicy,
      policySnapshot: authority.policySnapshot,
      workspace: workspace.workspace,
      contextView: authority.contextView,
      capabilityGrantRef: authority.capabilityGrantRef,
      disclosureManifest: {
        request: {
          operationId: preview.operationId,
          projectId: preview.projectId,
          sourceRef: authority.contextView.ref,
          sourceDigest: authority.contextView.hash,
          sinkRuleId: `remote:${preview.endpointId}`,
          principalId: authority.principalId,
          assignmentId: preview.assignmentId,
        },
        manifest,
      },
      remoteWorkspace: workspace.remoteWorkspace,
    });
    const record = createAssignmentAuthorityGrantRecord({
      ...recordBase(preview, key, current, now, expiresAt),
      status: 'ready',
      grant,
    });
    const stored = (await this.options.repository.append(record, current?.digest)).record;
    if (!stored.grant) throw new Error('Ready Assignment Authority Grant lost its grant');
    return Object.freeze({ status: 'ready', record: stored, grant: stored.grant });
  }

  async #block(
    preview: WorkroomAssignmentGrantClaimPreview,
    current: AssignmentAuthorityGrantRecord | undefined,
    kind: AssignmentAuthorityGrantBlockerKind,
    owner: string,
    reason: string,
  ): Promise<WorkroomAssignmentGrantPreparationResult> {
    if (current?.status === 'blocked'
      && current.generation === preview.generation
      && current.profileRevisionId === preview.profileRevisionId
      && current.profileDigest === preview.profileDigest
      && current.blocker?.kind === kind
      && current.blocker.owner === owner
      && current.blocker.reason === reason
      && current.expiresAt > this.#now()) {
      return Object.freeze({ status: 'blocked', record: current });
    }
    const now = this.#now();
    const key = assignmentAuthorityGrantKey({
      ...preview,
      requestedAgentDefinitionId: preview.agentDefinitionId,
      requestedEndpointId: preview.endpointId,
    });
    const deadline = now + this.#blockerTtlMs;
    const record = createAssignmentAuthorityGrantRecord({
      ...recordBase(preview, key, current, now, deadline),
      status: 'blocked',
      blocker: { kind, owner, reason, deadline },
    });
    const stored = (await this.options.repository.append(record, current?.digest)).record;
    return Object.freeze({ status: 'blocked', record: stored });
  }
}

function recordBase(
  preview: WorkroomAssignmentGrantClaimPreview,
  assignmentKey: string,
  current: AssignmentAuthorityGrantRecord | undefined,
  createdAt: number,
  expiresAt: number,
) {
  return {
    assignmentKey,
    revision: (current?.revision ?? 0) + 1,
    ...(current ? { previousDigest: current.digest } : {}),
    generation: preview.generation,
    projectId: preview.projectId,
    runId: preview.runId,
    taskKey: preview.taskKey,
    taskRevision: preview.taskRevision,
    assignmentId: preview.assignmentId,
    assignmentRevision: preview.assignmentRevision,
    attempt: preview.attempt,
    fence: preview.fence,
    operationId: preview.operationId,
    agentDefinitionId: preview.agentDefinitionId,
    endpointId: preview.endpointId,
    profileRevisionId: preview.profileRevisionId,
    profileDigest: preview.profileDigest,
    factAnchor: preview.factAnchor,
    createdAt,
    expiresAt,
  } as const;
}

function validManifest(
  manifest: MaterializedDisclosureManifest,
  preview: WorkroomAssignmentGrantClaimPreview,
  principalId: string,
): boolean {
  const { id, digest: actualDigest, ...projection } = manifest;
  return id === `disclosure-manifest:${actualDigest}`
    && digest(projection) === actualDigest
    && manifest.principal.principalId === principalId
    && manifest.principal.assignmentId === preview.assignmentId
    && manifest.destination.id === preview.endpointId
    && manifest.source.handle.projectId === preview.projectId
    && canonicalWorkroomJson(manifest.approvalIds)
      === canonicalWorkroomJson([...manifest.approvalIds].sort());
}

function authoritySatisfiesTask(
  authority: WorkroomAssignmentGrantAuthorityMaterialization,
  requirements: Readonly<Required<WorkflowTaskCapabilityRequirement>>,
): boolean {
  if (!Array.isArray(requirements.tools)
    || !Array.isArray(requirements.skills)
    || !Array.isArray(requirements.integrations)
    || !Array.isArray(requirements.authorities)) return false;
  const ceilings = [
    authority.roleCapabilities,
    authority.taskCapabilities,
    authority.policyCapabilities,
  ];
  return requirements.tools.every(required =>
    ceilings.every(ceiling => ceiling.tools.some(tool => tool.name === required)))
    && requirements.skills.every(required =>
      ceilings.every(ceiling => ceiling.skills.some(skill => skill.name === required)))
    && requirements.integrations.every(required => authority.authorizedIntegrations.includes(required))
    && requirements.authorities.every(required => authority.authorizedAuthorities.includes(required));
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Assignment Grant ${label} must be a positive integer`);
  }
  return Number(value);
}
