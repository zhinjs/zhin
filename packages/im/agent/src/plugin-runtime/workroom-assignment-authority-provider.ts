import { createToken, type FeatureId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { ToolIndex, toolFeatureId, type ToolDescriptor } from '@zhin.js/tool';
import { SkillIndex, skillFeatureId, type SkillDescriptor } from '@zhin.js/skill';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { GovernedDisclosureManifestSnapshot } from '../data-governance/disclosure-manifest.js';
import type { WorkroomCatalog, WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import {
  digestWorkroomCatalogProjectBinding,
  type WorkroomDefinition,
} from '../workroom/catalog-definition.js';
export { digestWorkroomCatalogProjectBinding } from '../workroom/catalog-definition.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type {
  AssignmentExecutionSnapshotReference,
  AssignmentExecutionWorkspaceReference,
  AssignmentExecutorRole,
} from '../workroom/assignment-executor.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import {
  createWorkroomRoleCapabilityReference,
  createWorkroomRoleCapabilitySupply,
  type WorkroomRoleCapabilityReferenceInput,
  type WorkroomRoleSkillDescriptor,
  type WorkroomRoleToolDescriptor,
} from '../workroom/role-capability-snapshot.js';
import type {
  WorkroomRemoteAssignmentAuthorityInput,
  WorkroomRemoteAssignmentAuthorityPort,
  WorkroomRemoteAssignmentResolvedAuthority,
} from '../workroom/remote-assignment-issuance.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  type WorkroomGithubWorkspaceReference,
  type WorkroomRemoteEndpointSnapshot,
} from '../workroom/remote-dispatch.js';

export interface WorkroomGenerationToolAuthority extends WorkroomRoleToolDescriptor {}

export interface WorkroomGenerationSkillAuthority {
  readonly name: string;
  readonly digest: string;
}

export interface WorkroomGenerationAgentAuthority {
  readonly id: string;
  readonly digest: string;
}

export interface WorkroomGenerationAuthoritySnapshotInput {
  readonly generation: number;
  readonly tools: readonly WorkroomGenerationToolAuthority[];
  readonly skills: readonly WorkroomGenerationSkillAuthority[];
  readonly agents: readonly WorkroomGenerationAgentAuthority[];
}

/** Exact Tool/Skill/Agent supply of one committed Plugin Runtime generation. */
export interface WorkroomGenerationAuthoritySnapshot
extends WorkroomGenerationAuthoritySnapshotInput {
  readonly version: 1;
  readonly digest: string;
}

export interface WorkroomCapabilityCeilingInput {
  readonly id: string;
  readonly revision: number;
  readonly tools: readonly WorkroomRoleToolDescriptor[];
  readonly skills: readonly WorkroomRoleSkillDescriptor[];
}

export interface WorkroomCapabilityCeiling extends WorkroomCapabilityCeilingInput {
  readonly digest: string;
}

export interface WorkroomAssignmentAuthorityGrantInput {
  readonly generation: number;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly agentDefinitionId: string;
  /** Absent only for a local-only grant. Remote issuance always requires it. */
  readonly endpointId?: string;
  /** Exact Card/auth/transport/capability join authorized by this grant. */
  readonly endpointAuthorityDigest?: string;
  readonly catalogRevision: string;
  readonly catalogBindingDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly principalId: string;
  readonly role: AssignmentExecutorRole;
  readonly capabilitySnapshotRef: string;
  readonly capabilitySnapshotRevision: number;
  readonly roleCapabilities: WorkroomCapabilityCeilingInput;
  readonly taskCapabilities: WorkroomCapabilityCeilingInput;
  readonly policyCapabilities: WorkroomCapabilityCeilingInput;
  readonly plan: AssignmentExecutionSnapshotReference;
  readonly contextPolicy: AssignmentExecutionSnapshotReference;
  readonly policySnapshot: AssignmentExecutionSnapshotReference;
  /** Optional in the untrusted/persisted shape; every issuance path rejects absence. */
  readonly workspace?: AssignmentExecutionWorkspaceReference;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly capabilityGrantRef: string;
  /** Required for remote disclosure. Local sandbox execution may not disclose externally. */
  readonly disclosureManifest?: GovernedDisclosureManifestSnapshot;
  readonly remoteWorkspace?: WorkroomGithubWorkspaceReference;
}

export interface WorkroomAssignmentAuthorityGrant
extends Omit<WorkroomAssignmentAuthorityGrantInput,
  'roleCapabilities' | 'taskCapabilities' | 'policyCapabilities'> {
  readonly version: 1;
  readonly roleCapabilities: WorkroomCapabilityCeiling;
  readonly taskCapabilities: WorkroomCapabilityCeiling;
  readonly policyCapabilities: WorkroomCapabilityCeiling;
  readonly digest: string;
}

export interface WorkroomAssignmentAuthorityGrantRequest {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly requestedAgentDefinitionId: string;
  readonly requestedEndpointId?: string;
}

/** Persistent authority grant reader. It never derives grants from request metadata. */
export interface WorkroomAssignmentAuthorityGrantPort {
  resolve(
    input: WorkroomAssignmentAuthorityGrantRequest,
  ): WorkroomAssignmentAuthorityGrant | undefined | Promise<WorkroomAssignmentAuthorityGrant | undefined>;
}

export interface WorkroomRemoteEndpointAuthority {
  readonly generation: number;
  readonly transportBindingDigest: string;
  readonly endpoint: WorkroomRemoteEndpointSnapshot;
}

/** Exact Card/auth/transport join for one committed protocol generation. */
export interface WorkroomRemoteEndpointAuthorityPort {
  resolve(
    endpointId: string,
  ): WorkroomRemoteEndpointAuthority | undefined | Promise<WorkroomRemoteEndpointAuthority | undefined>;
}

export type WorkroomLocalAssignmentAuthorityInput = Omit<
WorkroomRemoteAssignmentAuthorityInput,
'requestedEndpointId'
>;

export type WorkroomLocalAssignmentResolvedAuthority = Omit<
WorkroomRemoteAssignmentResolvedAuthority,
'endpoint' | 'disclosureManifest' | 'remoteWorkspace'
> & Readonly<{
  capabilitySupplies: WorkroomRoleCapabilityReferenceInput;
}>;

export interface WorkroomLocalAssignmentAuthorityPort {
  resolveLocal(
    input: WorkroomLocalAssignmentAuthorityInput,
  ): Promise<WorkroomLocalAssignmentResolvedAuthority>;
}

export interface GenerationOwnedWorkroomAssignmentAuthorityProviderOptions {
  readonly generation: WorkroomGenerationAuthoritySnapshot;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly grants: WorkroomAssignmentAuthorityGrantPort;
  readonly endpoints: WorkroomRemoteEndpointAuthorityPort;
}

/** Persistent Project Profile Registry reader for the current Root. */
export const workroomProjectProfileRegistryToken = createToken<Pick<ProjectProfileRegistry, 'read'>>(
  'zhin.agent.workroom-project-profile-registry',
  'Persistent Project Profile Registry reader',
);

/** Trusted, durable per-Assignment grants; intentionally has no default provider. */
export const workroomAssignmentAuthorityGrantToken = createToken<WorkroomAssignmentAuthorityGrantPort>(
  'zhin.agent.workroom-assignment-authority-grants',
  'Exact Workspace/Disclosure/Policy Assignment issuance grants',
);

/** Exact committed Tool/Skill/Agent supply; intentionally cannot be inferred from config. */
export const workroomGenerationAuthoritySnapshotToken = createToken<WorkroomGenerationAuthoritySnapshot>(
  'zhin.agent.workroom-generation-authority-snapshot',
  'Current generation Tool/Skill/Agent authority snapshot',
);

/** Card/auth/transport join, normally provided by the optional A2A Host. */
export const workroomRemoteEndpointAuthorityToken = createToken<WorkroomRemoteEndpointAuthorityPort>(
  'zhin.agent.workroom-remote-endpoint-authority',
  'Current generation A2A endpoint/Card/auth/transport authority',
);

/**
 * Generation-owned authority compositor shared by local and remote issuers.
 *
 * It accepts names only as lookup keys. Every authority-bearing fact comes
 * from a persistent Project registry or an immutable generation registry and
 * is rejoined by exact identity/digest before an Assignment Envelope exists.
 */
export class GenerationOwnedWorkroomAssignmentAuthorityProvider
implements WorkroomRemoteAssignmentAuthorityPort, WorkroomLocalAssignmentAuthorityPort {
  readonly #generation: WorkroomGenerationAuthoritySnapshot;

  constructor(readonly options: GenerationOwnedWorkroomAssignmentAuthorityProviderOptions) {
    this.#generation = assertGenerationSnapshot(options.generation);
  }

  async resolve(
    input: WorkroomRemoteAssignmentAuthorityInput,
  ): Promise<WorkroomRemoteAssignmentResolvedAuthority> {
    const base = await this.#resolveBase(input, input.requestedEndpointId);
    const endpointAuthority = await this.options.endpoints.resolve(input.requestedEndpointId);
    if (!endpointAuthority) {
      throw new Error('Remote Assignment endpoint authority is unavailable in the exact generation');
    }
    assertEndpointAuthority(endpointAuthority, this.#generation.generation, input.requestedEndpointId);
    const grant = base.grant;
    if (!grant.endpointId || grant.endpointId !== input.requestedEndpointId) {
      throw new Error('Remote Assignment issuance grant is not bound to the requested endpoint');
    }
    if (!grant.endpointAuthorityDigest
      || grant.endpointAuthorityDigest !== digestWorkroomRemoteEndpointAuthority(endpointAuthority)) {
      throw new Error('Remote Assignment issuance grant endpoint authority digest drift');
    }
    if (!grant.disclosureManifest) {
      throw new Error('Remote Assignment Disclosure Manifest grant is unavailable');
    }
    if (!grant.remoteWorkspace) {
      throw new Error('Remote Assignment Workspace grant is unavailable');
    }
    if (!endpointAuthority.endpoint.workspaceProviders.includes(grant.remoteWorkspace.provider)) {
      throw new Error('Remote Assignment Workspace provider is outside endpoint authority');
    }
    assertRemoteWorkspace(grant.remoteWorkspace, grant, base.definition);
    return deepFreeze({
      ...base.authority,
      endpoint: endpointAuthority.endpoint,
      disclosureManifest: grant.disclosureManifest,
      remoteWorkspace: grant.remoteWorkspace,
    });
  }

  async resolveLocal(
    input: WorkroomLocalAssignmentAuthorityInput,
  ): Promise<WorkroomLocalAssignmentResolvedAuthority> {
    const base = await this.#resolveBase(input, undefined);
    return deepFreeze({ ...base.authority, capabilitySupplies: base.capabilitySupplies });
  }

  async #resolveBase(
    input: WorkroomLocalAssignmentAuthorityInput,
    requestedEndpointId: string | undefined,
  ): Promise<Readonly<{
    authority: Omit<WorkroomRemoteAssignmentResolvedAuthority,
    'endpoint' | 'disclosureManifest' | 'remoteWorkspace'>;
    capabilitySupplies: WorkroomRoleCapabilityReferenceInput;
    grant: WorkroomAssignmentAuthorityGrant;
    definition: WorkroomDefinition;
  }>> {
    assertAuthorityInput(input);
    const [profileState, catalog] = await Promise.all([
      this.options.profiles.read(input.projectId),
      this.options.catalog.read(),
    ]);
    if (!profileState.active) {
      throw new Error('Remote Assignment Project has no active Profile Revision');
    }
    const pin = profileState.runPins[input.runId];
    if (!pin) throw new Error('Remote Assignment requires an exact Run Profile pin');
    const revision = profileState.revisions[pin.profileRevisionId];
    if (!revision
      || revision.projectId !== input.projectId
      || revision.compiledDigest !== pin.profileDigest
      || revision.compiledProfile.digest !== pin.profileDigest
      || revision.compiledProfile.revisionId !== pin.profileRevisionId) {
      throw new Error('Remote Assignment Run Profile pin does not resolve an exact persisted Revision');
    }
    const definition = resolveCatalogProject(catalog, input.projectId);
    const member = definition.members.find(item => item.agent === input.requestedAgentDefinitionId);
    if (!member || (member.role !== 'executor' && member.role !== 'integration')) {
      throw new Error('Remote Assignment Agent role is not authorized by the Project Catalog');
    }
    if (requestedEndpointId === undefined) {
      if (member.assignmentRoute?.kind === 'remote') {
        throw new Error('Local Assignment conflicts with the persisted remote Catalog route');
      }
    } else if (member.assignmentRoute?.kind !== 'remote'
      || member.assignmentRoute.endpointId !== requestedEndpointId) {
      throw new Error('Remote Assignment endpoint conflicts with the persisted Catalog route');
    }
    const profileAgent = revision.compiledProfile.agents.find(
      item => item.id === input.requestedAgentDefinitionId,
    );
    if (!profileAgent || profileAgent.role !== member.role) {
      throw new Error('Remote Assignment Agent role is outside the pinned Profile');
    }
    const generationAgent = this.#generation.agents.find(item => item.id === profileAgent.id);
    if (!generationAgent || generationAgent.digest !== profileAgent.digest) {
      throw new Error('Remote Assignment generation Agent does not match the pinned Profile');
    }
    assertProfileSupply(revision.compiledProfile, this.#generation);

    const grantRequest = grantRequestFrom(input, requestedEndpointId);
    const grant = await this.options.grants.resolve(grantRequest);
    if (!grant) throw new Error('Remote Assignment issuance grant is unavailable');
    const canonicalGrant = assertGrant(grant);
    assertGrantScope(canonicalGrant, grantRequest, {
      generation: this.#generation.generation,
      catalog,
      definition,
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
      role: member.role,
    });
    if (!canonicalGrant.workspace) {
      throw new Error('Remote Assignment Workspace grant is unavailable');
    }
    if (canonicalGrant.workspace.fence !== input.assignment.fence) {
      throw new Error('Remote Assignment Workspace grant fence drift');
    }

    const common = {
      projectId: input.projectId,
      runId: input.runId,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      assignmentId: input.assignment.id,
      assignmentRevision: input.assignment.revision,
      role: member.role,
      capabilitySnapshotRef: canonicalGrant.capabilitySnapshotRef,
      capabilitySnapshotRevision: canonicalGrant.capabilitySnapshotRevision,
    } as const;
    const profileTools = revision.compiledProfile.tools.map(item => ({
      name: item.id, digest: item.digest,
    }));
    const profileSkills = revision.compiledProfile.skills.map(item => ({
      name: item.id, digest: item.digest, requiredTools: item.requiresTools,
    }));
    const capabilitySupplies = deepFreeze<WorkroomRoleCapabilityReferenceInput>({
      generation: createWorkroomRoleCapabilitySupply({
        source: 'generation', id: `generation:${this.#generation.generation}`,
        revision: this.#generation.generation, ...common,
        tools: this.#generation.tools,
        skills: this.#generation.skills.map(item => ({
          ...item,
          requiredTools: profileSkills.find(skill => skill.name === item.name)?.requiredTools ?? [],
        })),
      }),
      profile: createWorkroomRoleCapabilitySupply({
        source: 'profile', id: pin.profileRevisionId,
        revision: pin.activationRegistryRevision + 1, ...common,
        tools: profileTools, skills: profileSkills,
      }),
      agent_definition: createWorkroomRoleCapabilitySupply({
        source: 'agent_definition', id: profileAgent.id,
        revision: this.#generation.generation, ...common,
        tools: profileTools.filter(item => profileAgent.allowedTools.includes(item.name)),
        skills: profileSkills.filter(item => profileAgent.allowedSkills.includes(item.name)),
      }),
      role: supplyFromCeiling('role', canonicalGrant.roleCapabilities, common),
      task: supplyFromCeiling('task', canonicalGrant.taskCapabilities, common),
      policy: supplyFromCeiling('policy', canonicalGrant.policyCapabilities, common),
    });
    const capabilitySnapshot = createWorkroomRoleCapabilityReference(capabilitySupplies);
    const authority = deepFreeze({
      principalId: canonicalGrant.principalId,
      role: canonicalGrant.role,
      agentDefinitionId: profileAgent.id,
      agentDefinition: {
        ref: `agent-definition:${encodeURIComponent(profileAgent.id)}:generation:${this.#generation.generation}`,
        revision: this.#generation.generation,
        digest: profileAgent.digest,
      },
      plan: canonicalGrant.plan,
      contextPolicy: canonicalGrant.contextPolicy,
      capabilitySnapshot,
      policySnapshot: canonicalGrant.policySnapshot,
      workspace: canonicalGrant.workspace,
      contextView: canonicalGrant.contextView,
      capabilityGrantRef: canonicalGrant.capabilityGrantRef,
    });
    return deepFreeze({ authority, capabilitySupplies, grant: canonicalGrant, definition });
  }
}

export function createWorkroomGenerationAuthoritySnapshot(
  input: WorkroomGenerationAuthoritySnapshotInput,
): WorkroomGenerationAuthoritySnapshot {
  positive(input.generation, 'generation');
  const projection = {
    version: 1 as const,
    generation: input.generation,
    tools: canonicalTools(input.tools, 'generation tools'),
    skills: canonicalGenerationSkills(input.skills, 'generation skills'),
    agents: canonicalAgents(input.agents),
  };
  return deepFreeze({ ...projection, digest: digest(projection) });
}

/**
 * Builds supply from an exact operation-held RuntimeSnapshot. Callers must
 * retain the Snapshot lease for the complete authority resolution.
 */
export function createWorkroomGenerationAuthoritySnapshotFromRuntime(
  snapshot: RuntimeSnapshot,
  bindings: readonly ResolvedAgentBinding[],
): WorkroomGenerationAuthoritySnapshot {
  const toolIndex = runtimeProjection(snapshot, toolFeatureId, ToolIndex);
  const skillIndex = runtimeProjection(snapshot, skillFeatureId, SkillIndex);
  return createWorkroomGenerationAuthoritySnapshot({
    generation: snapshot.generation,
    tools: (toolIndex?.list() ?? []).filter(tool => tool.hidden !== true).map(tool => ({
      name: tool.name,
      digest: digestGenerationDescriptor('tool', generationToolProjection(tool)),
    })),
    skills: (skillIndex?.list() ?? []).map(skill => ({
      name: skill.name,
      digest: digestGenerationDescriptor('skill', generationSkillProjection(skill)),
    })),
    agents: bindings.map(binding => ({
      id: binding.name,
      digest: digestGenerationDescriptor('agent', {
        name: binding.name,
        providerAlias: binding.providerAlias,
        model: binding.model,
        mcpServers: [...binding.mcpServers].sort((left, right) => compareCanonicalWorkroomText(left, right)),
        ...(binding.nickname === undefined ? {} : { nickname: binding.nickname }),
        ...(binding.permission === undefined ? {} : { permission: binding.permission }),
      }),
    })),
  });
}

export function digestWorkroomGenerationDescriptor(
  kind: 'tool' | 'skill' | 'agent',
  value: Readonly<Record<string, unknown>>,
): string {
  return digestGenerationDescriptor(kind, value);
}

export function createWorkroomAssignmentAuthorityGrant(
  input: WorkroomAssignmentAuthorityGrantInput,
): WorkroomAssignmentAuthorityGrant {
  exactKeys(input, [
    'generation', 'projectId', 'runId', 'taskKey', 'taskRevision',
    'assignmentId', 'assignmentRevision', 'attempt', 'fence',
    'agentDefinitionId', 'endpointId', 'endpointAuthorityDigest',
    'catalogRevision', 'catalogBindingDigest', 'profileRevisionId', 'profileDigest',
    'principalId', 'role', 'capabilitySnapshotRef', 'capabilitySnapshotRevision',
    'roleCapabilities', 'taskCapabilities', 'policyCapabilities',
    'plan', 'contextPolicy', 'policySnapshot', 'workspace', 'contextView',
    'capabilityGrantRef', 'disclosureManifest', 'remoteWorkspace',
  ], 'issuance grant');
  const projection = deepFreeze({
    version: 1 as const,
    ...structuredClone(input),
    roleCapabilities: createCeiling(input.roleCapabilities, 'roleCapabilities'),
    taskCapabilities: createCeiling(input.taskCapabilities, 'taskCapabilities'),
    policyCapabilities: createCeiling(input.policyCapabilities, 'policyCapabilities'),
  });
  validateGrantProjection(projection);
  return deepFreeze({ ...projection, digest: digest(projection) });
}

export function digestWorkroomRemoteEndpointAuthority(
  authority: WorkroomRemoteEndpointAuthority,
): string {
  return digest({ version: 1, authority: structuredClone(authority) });
}

function assertGenerationSnapshot(
  value: WorkroomGenerationAuthoritySnapshot,
): WorkroomGenerationAuthoritySnapshot {
  const canonical = createWorkroomGenerationAuthoritySnapshot(value);
  if (canonical.digest !== value.digest || canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(value)) {
    throw new Error('Workroom generation authority snapshot digest drift');
  }
  return canonical;
}

function assertGrant(value: WorkroomAssignmentAuthorityGrant): WorkroomAssignmentAuthorityGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Assignment issuance grant is invalid');
  }
  const { version, digest: actualDigest, roleCapabilities, taskCapabilities, policyCapabilities, ...rest } = value;
  if (version !== 1) throw new Error('Remote Assignment issuance grant version is unsupported');
  const canonical = createWorkroomAssignmentAuthorityGrant({
    ...rest,
    roleCapabilities: ceilingInput(roleCapabilities),
    taskCapabilities: ceilingInput(taskCapabilities),
    policyCapabilities: ceilingInput(policyCapabilities),
  });
  if (actualDigest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Remote Assignment issuance grant digest drift');
  }
  return canonical;
}

function createCeiling(input: WorkroomCapabilityCeilingInput, label: string): WorkroomCapabilityCeiling {
  text(input.id, `${label}.id`);
  positive(input.revision, `${label}.revision`);
  const projection = {
    id: input.id,
    revision: input.revision,
    tools: canonicalTools(input.tools, `${label}.tools`),
    skills: canonicalSkills(input.skills, `${label}.skills`),
  };
  return deepFreeze({ ...projection, digest: digest(projection) });
}

function ceilingInput(value: WorkroomCapabilityCeiling): WorkroomCapabilityCeilingInput {
  if (!value || typeof value !== 'object') throw new Error('Remote Assignment capability ceiling is invalid');
  const { digest: actualDigest, ...input } = value;
  const canonical = createCeiling(input, 'capability ceiling');
  if (canonical.digest !== actualDigest) throw new Error('Remote Assignment capability ceiling digest drift');
  return input;
}

function validateGrantProjection(input: Omit<WorkroomAssignmentAuthorityGrant, 'digest'>): void {
  for (const [label, value] of Object.entries({
    projectId: input.projectId, runId: input.runId, taskKey: input.taskKey,
    assignmentId: input.assignmentId, agentDefinitionId: input.agentDefinitionId,
    catalogRevision: input.catalogRevision, catalogBindingDigest: input.catalogBindingDigest,
    profileRevisionId: input.profileRevisionId, profileDigest: input.profileDigest,
    principalId: input.principalId, capabilitySnapshotRef: input.capabilitySnapshotRef,
    capabilityGrantRef: input.capabilityGrantRef,
  })) text(value, label);
  if (input.endpointId !== undefined) text(input.endpointId, 'endpointId');
  if (input.endpointAuthorityDigest !== undefined) {
    sha(input.endpointAuthorityDigest, 'endpointAuthorityDigest');
  }
  for (const [label, value] of Object.entries({
    generation: input.generation, taskRevision: input.taskRevision,
    assignmentRevision: input.assignmentRevision, attempt: input.attempt,
    fence: input.fence, capabilitySnapshotRevision: input.capabilitySnapshotRevision,
  })) positive(value, label);
  if (input.role !== 'executor' && input.role !== 'integration') {
    throw new Error('Remote Assignment grant role is not executable');
  }
  reference(input.plan, 'plan');
  reference(input.contextPolicy, 'contextPolicy');
  reference(input.policySnapshot, 'policySnapshot');
  if (input.workspace) {
    text(input.workspace.leaseRef, 'workspace.leaseRef');
    text(input.workspace.mountRef, 'workspace.mountRef');
    text(input.workspace.baseRevision, 'workspace.baseRevision');
    positive(input.workspace.fence, 'workspace.fence');
  }
  text(input.contextView.ref, 'contextView.ref');
  sha(input.contextView.hash, 'contextView.hash');
  if (input.disclosureManifest) {
    text(input.disclosureManifest.request.operationId, 'disclosureManifest.request.operationId');
    text(input.disclosureManifest.request.projectId, 'disclosureManifest.request.projectId');
    text(input.disclosureManifest.request.sourceRef, 'disclosureManifest.request.sourceRef');
    sha(input.disclosureManifest.request.sourceDigest, 'disclosureManifest.request.sourceDigest');
    text(input.disclosureManifest.request.sinkRuleId, 'disclosureManifest.request.sinkRuleId');
    text(input.disclosureManifest.request.principalId, 'disclosureManifest.request.principalId');
    text(input.disclosureManifest.manifest.id, 'disclosureManifest.manifest.id');
    sha(input.disclosureManifest.manifest.digest, 'disclosureManifest.manifest.digest');
  }
  sha(input.profileDigest, 'profileDigest');
  catalogRevision(input.catalogRevision);
  sha(input.catalogBindingDigest, 'catalogBindingDigest');
}

function assertGrantScope(
  grant: WorkroomAssignmentAuthorityGrant,
  request: WorkroomAssignmentAuthorityGrantRequest,
  authority: Readonly<{
    generation: number;
    catalog: WorkroomCatalogSnapshot;
    definition: WorkroomDefinition;
    profileRevisionId: string;
    profileDigest: string;
    role: AssignmentExecutorRole;
  }>,
): void {
  for (const [label, actual, expected] of [
    ['generation', grant.generation, authority.generation],
    ['projectId', grant.projectId, request.projectId],
    ['runId', grant.runId, request.runId],
    ['taskKey', grant.taskKey, request.taskKey],
    ['taskRevision', grant.taskRevision, request.taskRevision],
    ['assignmentId', grant.assignmentId, request.assignmentId],
    ['assignmentRevision', grant.assignmentRevision, request.assignmentRevision],
    ['attempt', grant.attempt, request.attempt],
    ['fence', grant.fence, request.fence],
    ['agentDefinitionId', grant.agentDefinitionId, request.requestedAgentDefinitionId],
    ['catalogRevision', grant.catalogRevision, authority.catalog.revision],
    ['catalogBindingDigest', grant.catalogBindingDigest,
      digestWorkroomCatalogProjectBinding(authority.definition)],
    ['profileRevisionId', grant.profileRevisionId, authority.profileRevisionId],
    ['profileDigest', grant.profileDigest, authority.profileDigest],
    ['role', grant.role, authority.role],
  ] as const) {
    if (actual !== expected) throw new Error(`Remote Assignment issuance grant ${label} scope drift`);
  }
  if (request.requestedEndpointId !== undefined && grant.endpointId !== request.requestedEndpointId) {
    throw new Error('Remote Assignment issuance grant endpointId scope drift');
  }
  if (request.requestedEndpointId === undefined && grant.endpointId !== undefined) {
    throw new Error('Local Assignment cannot consume a Remote endpoint issuance grant');
  }
}

function assertProfileSupply(
  profile: Readonly<{
    tools: readonly Readonly<{ id: string; digest: string }>[];
    skills: readonly Readonly<{ id: string; digest: string; requiresTools: readonly string[] }>[];
  }>,
  generation: WorkroomGenerationAuthoritySnapshot,
): void {
  for (const tool of profile.tools) {
    if (!generation.tools.some(item => item.name === tool.id && item.digest === tool.digest)) {
      throw new Error(`Pinned Profile Tool ${tool.id} is absent from the current generation supply`);
    }
  }
  for (const skill of profile.skills) {
    if (!generation.skills.some(item => item.name === skill.id
      && item.digest === skill.digest)) {
      throw new Error(`Pinned Profile Skill ${skill.id} is absent from the current generation supply`);
    }
  }
}

function resolveCatalogProject(catalog: WorkroomCatalogSnapshot, projectId: string): WorkroomDefinition {
  const definition = catalog.definitions[projectId];
  if (!definition || definition.enabled === false) {
    throw new Error('Remote Assignment Project is not enabled in the exact Workroom Catalog');
  }
  return definition;
}

function assertEndpointAuthority(
  value: WorkroomRemoteEndpointAuthority,
  generation: number,
  endpointId: string,
): void {
  if (!value || typeof value !== 'object'
    || value.generation !== generation
    || value.endpoint?.id !== endpointId) {
    throw new Error('Remote Assignment endpoint authority generation or identity drift');
  }
  sha(value.transportBindingDigest, 'transportBindingDigest');
  const endpoint = value.endpoint;
  for (const [label, field] of Object.entries({
    id: endpoint.id, owner: endpoint.owner, cardDigest: endpoint.cardDigest,
    authBindingId: endpoint.authBindingId,
  })) text(field, `endpoint.${label}`);
  sha(endpoint.cardDigest, 'endpoint.cardDigest');
  if (endpoint.workroomExtension !== WORKROOM_A2A_EXTENSION_URI
    || !endpoint.idempotentDispatch
    || !endpoint.typedCompletionEnvelope
    || !Array.isArray(endpoint.workspaceProviders)
    || endpoint.workspaceProviders.length === 0) {
    throw new Error('Remote Assignment endpoint authority lacks the Workroom execution contract');
  }
}

function assertRemoteWorkspace(
  workspace: WorkroomGithubWorkspaceReference,
  grant: WorkroomAssignmentAuthorityGrant,
  definition: WorkroomDefinition,
): void {
  if (workspace.fence !== grant.fence
    || workspace.baseSha !== grant.workspace?.baseRevision) {
    throw new Error('Remote Assignment Workspace grant does not match the local fenced lease');
  }
  if (definition.conversation?.kind === 'repository'
    && (workspace.repositoryId !== definition.conversation.id
      || workspace.integrationBindingId !== definition.conversation.endpoint)) {
    throw new Error('Remote Assignment Workspace grant is outside the Project Catalog binding');
  }
}

function supplyFromCeiling(
  source: 'role' | 'task' | 'policy',
  ceiling: WorkroomCapabilityCeiling,
  common: Omit<Parameters<typeof createWorkroomRoleCapabilitySupply>[0],
  'source' | 'id' | 'revision' | 'tools' | 'skills'>,
) {
  return createWorkroomRoleCapabilitySupply({
    source, id: ceiling.id, revision: ceiling.revision, ...common,
    tools: ceiling.tools, skills: ceiling.skills,
  });
}

function grantRequestFrom(
  input: WorkroomLocalAssignmentAuthorityInput,
  requestedEndpointId: string | undefined,
): WorkroomAssignmentAuthorityGrantRequest {
  return deepFreeze({
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.task.key,
    taskRevision: input.task.revision,
    assignmentId: input.assignment.id,
    assignmentRevision: input.assignment.revision,
    attempt: input.assignment.attempt,
    fence: input.assignment.fence,
    requestedAgentDefinitionId: input.requestedAgentDefinitionId,
    ...(requestedEndpointId === undefined ? {} : { requestedEndpointId }),
  });
}

function assertAuthorityInput(input: WorkroomLocalAssignmentAuthorityInput): void {
  if (!input || typeof input !== 'object') throw new Error('Remote Assignment authority input is invalid');
  for (const [label, value] of Object.entries({
    projectId: input.projectId, runId: input.runId, taskKey: input.task?.key,
    assignmentId: input.assignment?.id, requestedAgentDefinitionId: input.requestedAgentDefinitionId,
  })) text(value, label);
  positive(input.task?.revision, 'task.revision');
  positive(input.assignment?.revision, 'assignment.revision');
  positive(input.assignment?.attempt, 'assignment.attempt');
  positive(input.assignment?.fence, 'assignment.fence');
}

function canonicalTools(value: readonly WorkroomRoleToolDescriptor[], label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => {
    text(item.name, `${label}.name`); sha(item.digest, `${label}.${item.name}.digest`);
    return { name: item.name, digest: item.digest, ...(item.deferred === undefined ? {} : { deferred: item.deferred }) };
  }).sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
  uniqueNames(result, label);
  return Object.freeze(result);
}

function canonicalSkills(value: readonly WorkroomRoleSkillDescriptor[], label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => {
    text(item.name, `${label}.name`); sha(item.digest, `${label}.${item.name}.digest`);
    const requiredTools = canonicalNames(item.requiredTools, `${label}.${item.name}.requiredTools`);
    return {
      name: item.name, digest: item.digest, requiredTools,
      ...(item.deferred === undefined ? {} : { deferred: item.deferred }),
    };
  }).sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
  uniqueNames(result, label);
  return Object.freeze(result);
}

function canonicalGenerationSkills(
  value: readonly WorkroomGenerationSkillAuthority[],
  label: string,
) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => {
    text(item.name, `${label}.name`); sha(item.digest, `${label}.${item.name}.digest`);
    return { name: item.name, digest: item.digest };
  }).sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
  uniqueNames(result, label);
  return Object.freeze(result);
}

function generationToolProjection(tool: ToolDescriptor): Readonly<Record<string, unknown>> {
  return {
    name: tool.name,
    description: tool.description,
    approval: tool.approval,
    platforms: [...(tool.platforms ?? [])].sort(),
    scopes: [...(tool.scopes ?? [])].sort(),
    permissions: [...(tool.permissions ?? [])].sort(),
    hidden: tool.hidden === true,
  };
}

function generationSkillProjection(skill: SkillDescriptor): Readonly<Record<string, unknown>> {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
  };
}

function digestGenerationDescriptor(
  kind: 'tool' | 'skill' | 'agent',
  value: Readonly<Record<string, unknown>>,
): string {
  return digest({ version: 1, kind, value });
}

function runtimeProjection<T>(
  snapshot: RuntimeSnapshot,
  id: FeatureId,
  constructor: { readonly prototype: T },
): T | undefined {
  const value = snapshot.projections.get(id);
  return value
    && typeof value === 'object'
    && Object.prototype.isPrototypeOf.call(constructor.prototype, value)
    ? value as T
    : undefined;
}

function canonicalAgents(value: readonly WorkroomGenerationAgentAuthority[]) {
  if (!Array.isArray(value)) throw new Error('generation agents must be an array');
  const result = value.map(item => {
    text(item.id, 'generation agent id'); sha(item.digest, `generation agent ${item.id} digest`);
    return { id: item.id, digest: item.digest };
  }).sort((left, right) => compareCanonicalWorkroomText(left.id, right.id));
  const names = result.map(item => ({ name: item.id }));
  uniqueNames(names, 'generation agents');
  return Object.freeze(result);
}

function canonicalNames(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach(item => text(item, label));
  const names = [...new Set(value)].sort((left, right) => compareCanonicalWorkroomText(left, right));
  if (names.length !== value.length) throw new Error(`${label} contains duplicate values`);
  return Object.freeze(names);
}

function uniqueNames(value: readonly Readonly<{ name: string }>[], label: string): void {
  const names = new Set<string>();
  for (const item of value) {
    if (names.has(item.name)) throw new Error(`${label} contains duplicate ${item.name}`);
    names.add(item.name);
  }
}

function reference(value: AssignmentExecutionSnapshotReference, label: string): void {
  text(value?.ref, `${label}.ref`); positive(value?.revision, `${label}.revision`);
  sha(value?.digest, `${label}.digest`);
}

function sha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Remote Assignment ${label} must be a canonical digest`);
  }
}

function catalogRevision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Remote Assignment catalogRevision must be a canonical Catalog revision');
  }
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Remote Assignment ${label} is required`);
  }
}

function positive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Remote Assignment ${label} must be a positive integer`);
  }
}

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Remote Assignment ${label} contains unexpected field ${unexpected}`);
}
