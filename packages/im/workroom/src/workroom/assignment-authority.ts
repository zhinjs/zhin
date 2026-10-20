import type { GovernedDisclosureManifestSnapshot } from '../data-governance/disclosure-manifest.js';
import type {
  AssignmentExecutionSnapshotReference,
  AssignmentExecutionWorkspaceReference,
  AssignmentExecutorRole,
} from './assignment-executor.js';
import type { WorkroomGithubWorkspaceReference } from './remote-dispatch.js';
import type {
  WorkroomRoleSkillDescriptor,
  WorkroomRoleToolDescriptor,
} from './role-capability-snapshot.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

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
  readonly endpointId?: string;
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
  readonly workspace?: AssignmentExecutionWorkspaceReference;
  readonly contextView: Readonly<{ ref: string; hash: string }>;
  readonly capabilityGrantRef: string;
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

export function assertWorkroomAssignmentAuthorityGrant(
  value: WorkroomAssignmentAuthorityGrant,
): WorkroomAssignmentAuthorityGrant {
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
  if (input.endpointAuthorityDigest !== undefined) sha(input.endpointAuthorityDigest, 'endpointAuthorityDigest');
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

function canonicalTools(value: readonly WorkroomRoleToolDescriptor[], label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => {
    text(item.name, `${label}.name`);
    sha(item.digest, `${label}.${item.name}.digest`);
    return { name: item.name, digest: item.digest, ...(item.deferred === undefined ? {} : { deferred: item.deferred }) };
  }).sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
  uniqueNames(result, label);
  return Object.freeze(result);
}

function canonicalSkills(value: readonly WorkroomRoleSkillDescriptor[], label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => {
    text(item.name, `${label}.name`);
    sha(item.digest, `${label}.${item.name}.digest`);
    const requiredTools = canonicalNames(item.requiredTools, `${label}.${item.name}.requiredTools`);
    return { name: item.name, digest: item.digest, requiredTools,
      ...(item.deferred === undefined ? {} : { deferred: item.deferred }) };
  }).sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
  uniqueNames(result, label);
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
  text(value?.ref, `${label}.ref`);
  positive(value?.revision, `${label}.revision`);
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
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Remote Assignment ${label} is required`);
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
