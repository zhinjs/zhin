import {
  assertAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from './assignment-executor.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export type WorkroomCapabilityRole = 'orchestrator' | 'executor' | 'reviewer' | 'integration';
export type WorkroomRoleCapabilitySupplySource =
  | 'generation'
  | 'profile'
  | 'agent_definition'
  | 'role'
  | 'task'
  | 'policy';

export interface WorkroomRoleToolDescriptor {
  readonly name: string;
  readonly digest: string;
  readonly deferred?: boolean;
}

export interface WorkroomRoleSkillDescriptor {
  readonly name: string;
  readonly digest: string;
  readonly requiredTools: readonly string[];
  readonly deferred?: boolean;
}

export interface WorkroomRoleCapabilitySupply {
  readonly source: WorkroomRoleCapabilitySupplySource;
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly role: WorkroomCapabilityRole;
  readonly capabilitySnapshotRef: string;
  readonly capabilitySnapshotRevision: number;
  readonly tools: readonly WorkroomRoleToolDescriptor[];
  readonly skills: readonly WorkroomRoleSkillDescriptor[];
}

export type WorkroomRoleCapabilitySupplyInput = Omit<WorkroomRoleCapabilitySupply, 'digest'>;

export interface WorkroomRoleCapabilitySnapshotInput {
  readonly envelope: AssignmentExecutionEnvelope;
  readonly generation: WorkroomRoleCapabilitySupply;
  readonly profile: WorkroomRoleCapabilitySupply;
  readonly agent_definition: WorkroomRoleCapabilitySupply;
  readonly role: WorkroomRoleCapabilitySupply;
  readonly task: WorkroomRoleCapabilitySupply;
  readonly policy: WorkroomRoleCapabilitySupply;
}

export type WorkroomRoleCapabilityReferenceInput = Omit<
WorkroomRoleCapabilitySnapshotInput,
'envelope'
>;

export interface WorkroomRoleCapabilityReference {
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
}

export interface WorkroomRoleCapabilityAuthorityReference {
  readonly source: WorkroomRoleCapabilitySupplySource;
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
}

export interface WorkroomRoleCapabilitySnapshot {
  readonly version: 1;
  readonly id: string;
  readonly ref: string;
  readonly revision: number;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly role: Extract<WorkroomCapabilityRole, 'executor' | 'integration'>;
  readonly authorities: readonly WorkroomRoleCapabilityAuthorityReference[];
  readonly tools: readonly WorkroomRoleToolDescriptor[];
  readonly skills: readonly WorkroomRoleSkillDescriptor[];
}

export type WorkroomRoleCommandName =
  | 'plan_task'
  | 'block_task'
  | 'resolve_blocker'
  | 'request_rework'
  | 'revise_task'
  | 'cancel_run'
  | 'report_progress'
  | 'heartbeat'
  | 'checkpoint'
  | 'complete_execution'
  | 'request_evidence'
  | 'submit_verdict';

export interface WorkroomRoleCommandDescriptor {
  /** Metadata only: this grants no Kernel writer or transition authority. */
  readonly role: WorkroomCapabilityRole;
  readonly name: WorkroomRoleCommandName;
  readonly toolName: string;
}

const SOURCES = [
  'generation', 'profile', 'agent_definition', 'role', 'task', 'policy',
] as const;

const COMMANDS = deepFreeze({
  orchestrator: [
    command('orchestrator', 'plan_task'),
    command('orchestrator', 'block_task'),
    command('orchestrator', 'resolve_blocker'),
    command('orchestrator', 'request_rework'),
    command('orchestrator', 'revise_task'),
    command('orchestrator', 'cancel_run'),
  ],
  executor: [
    command('executor', 'report_progress'),
    command('executor', 'heartbeat'),
    command('executor', 'checkpoint'),
    command('executor', 'complete_execution'),
  ],
  reviewer: [
    command('reviewer', 'request_evidence'),
    command('reviewer', 'submit_verdict'),
  ],
  integration: [
    command('integration', 'report_progress'),
    command('integration', 'heartbeat'),
    command('integration', 'checkpoint'),
    command('integration', 'complete_execution'),
  ],
} satisfies Record<WorkroomCapabilityRole, readonly WorkroomRoleCommandDescriptor[]>);

export function createWorkroomRoleCapabilitySnapshot(
  input: WorkroomRoleCapabilitySnapshotInput,
): WorkroomRoleCapabilitySnapshot {
  assertExactKeys(input, ['envelope', ...SOURCES], 'Snapshot input');
  assertAssignmentExecutionEnvelope(input.envelope);
  const compiled = compileCapability(input);
  const { envelope: _envelope, ...supplies } = input;
  const reference = createWorkroomRoleCapabilityReference(supplies);
  const envelopeReference = input.envelope.capabilitySnapshot;
  if (envelopeReference.ref !== reference.ref
    || envelopeReference.revision !== reference.revision
    || envelopeReference.digest !== reference.digest) {
    throw new Error('Workroom Envelope Capability Snapshot reference drift');
  }
  const projection = {
    version: 1 as const,
    id: reference.ref,
    ref: reference.ref,
    revision: reference.revision,
    projectId: input.envelope.projectId,
    runId: input.envelope.runId,
    taskKey: input.envelope.taskKey,
    taskRevision: input.envelope.taskRevision,
    assignmentId: input.envelope.assignmentId,
    assignmentRevision: input.envelope.assignmentRevision,
    role: input.envelope.role,
    authorities: compiled.authorities,
    tools: compiled.tools,
    skills: compiled.skills,
  };
  return deepFreeze({ ...projection, digest: reference.digest });
}

export function createWorkroomRoleCapabilitySupply(
  input: WorkroomRoleCapabilitySupplyInput,
): WorkroomRoleCapabilitySupply {
  validateSupplyInput(input.source, input);
  const projection = canonicalSupplyProjection(input);
  return deepFreeze({ ...projection, digest: digest(projection) });
}

export function createWorkroomRoleCapabilityReference(
  input: WorkroomRoleCapabilityReferenceInput,
): WorkroomRoleCapabilityReference {
  assertExactKeys(input, SOURCES, 'reference input');
  const compiled = compileCapability(input);
  const first = input.generation;
  return deepFreeze({
    ref: first.capabilitySnapshotRef,
    revision: first.capabilitySnapshotRevision,
    digest: digest(capabilityContent(
      first.capabilitySnapshotRef,
      first.capabilitySnapshotRevision,
      compiled,
    )),
  });
}

export function getWorkroomRoleCommandDescriptors(
  role: WorkroomCapabilityRole,
): readonly WorkroomRoleCommandDescriptor[] {
  if (!Object.hasOwn(COMMANDS, role)) {
    throw new Error(`Workroom command descriptor unsupported role: ${role}`);
  }
  return COMMANDS[role];
}

export function discoverWorkroomRoleCapabilities(
  envelope: AssignmentExecutionEnvelope,
  snapshot: WorkroomRoleCapabilitySnapshot,
  query = '',
): Readonly<{
  tools: readonly WorkroomRoleToolDescriptor[];
  skills: readonly WorkroomRoleSkillDescriptor[];
}> {
  assertSnapshot(envelope, snapshot);
  const normalized = query.trim().toLowerCase();
  return deepFreeze({
    tools: snapshot.tools.filter(item => item.name.toLowerCase().includes(normalized)),
    skills: snapshot.skills.filter(item => item.name.toLowerCase().includes(normalized)),
  });
}

export function loadWorkroomRoleTool(
  envelope: AssignmentExecutionEnvelope,
  snapshot: WorkroomRoleCapabilitySnapshot,
  name: string,
  expectedDigest: string,
): WorkroomRoleToolDescriptor {
  assertSnapshot(envelope, snapshot);
  return loadAllowlisted(snapshot.tools, name, expectedDigest, 'Tool');
}

export function loadWorkroomRoleSkill(
  envelope: AssignmentExecutionEnvelope,
  snapshot: WorkroomRoleCapabilitySnapshot,
  name: string,
  expectedDigest: string,
): WorkroomRoleSkillDescriptor {
  assertSnapshot(envelope, snapshot);
  return loadAllowlisted(snapshot.skills, name, expectedDigest, 'Skill');
}

interface CompiledCapabilityContent {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly role: Extract<WorkroomCapabilityRole, 'executor' | 'integration'>;
  readonly authorities: readonly WorkroomRoleCapabilityAuthorityReference[];
  readonly tools: readonly WorkroomRoleToolDescriptor[];
  readonly skills: readonly WorkroomRoleSkillDescriptor[];
}

function compileCapability(
  input: WorkroomRoleCapabilityReferenceInput | WorkroomRoleCapabilitySnapshotInput,
): CompiledCapabilityContent {
  const supplies = SOURCES.map(source => input[source]);
  supplies.forEach((supply, index) => validateCanonicalSupply(SOURCES[index]!, supply));
  const first = supplies[0]!;
  for (const supply of supplies.slice(1)) {
    for (const [label, actual, expected] of [
      ['projectId', supply.projectId, first.projectId],
      ['runId', supply.runId, first.runId],
      ['taskKey', supply.taskKey, first.taskKey],
      ['taskRevision', supply.taskRevision, first.taskRevision],
      ['assignmentId', supply.assignmentId, first.assignmentId],
      ['assignmentRevision', supply.assignmentRevision, first.assignmentRevision],
      ['role', supply.role, first.role],
      ['capabilitySnapshotRef', supply.capabilitySnapshotRef, first.capabilitySnapshotRef],
      ['capabilitySnapshotRevision', supply.capabilitySnapshotRevision, first.capabilitySnapshotRevision],
    ] as const) {
      if (actual !== expected) throw new Error(`Workroom capability supply ${label} scope drift`);
    }
  }
  if (first.role !== 'executor' && first.role !== 'integration') {
    throw new Error(`Workroom capability projector unsupported Assignment role: ${first.role}`);
  }
  if ('envelope' in input) validateSuppliesAgainstEnvelope(supplies, input.envelope);
  assertDescriptorIdentity(supplies, 'Tool', supply => supply.tools);
  assertDescriptorIdentity(supplies, 'Skill', supply => supply.skills);
  const tools = intersectDescriptors(supplies.map(supply => supply.tools))
    .map(tool => ({ ...tool }));
  assertRoleTools(first.role, tools);
  const skills = intersectDescriptors(supplies.map(supply => supply.skills))
    .map(skill => ({ ...skill, requiredTools: [...skill.requiredTools] }));
  for (const skill of skills) {
    const unauthorized = skill.requiredTools.find(name => !tools.some(tool => tool.name === name));
    if (unauthorized) {
      throw new Error(`Workroom Skill ${skill.name} requires unauthorized Tool ${unauthorized}`);
    }
  }
  return {
    projectId: first.projectId,
    runId: first.runId,
    taskKey: first.taskKey,
    taskRevision: first.taskRevision,
    assignmentId: first.assignmentId,
    assignmentRevision: first.assignmentRevision,
    role: first.role,
    authorities: supplies.map(({ source, id, revision, digest: sourceDigest }) => ({
      source, id, revision, digest: sourceDigest,
    })),
    tools,
    skills,
  };
}

function validateCanonicalSupply(
  expectedSource: WorkroomRoleCapabilitySupplySource,
  supply: WorkroomRoleCapabilitySupply,
): void {
  if (!supply || typeof supply !== 'object' || Array.isArray(supply)) {
    throw new Error(`Workroom capability supply ${expectedSource} must be an object`);
  }
  assertExactKeys(supply, [
    'source', 'id', 'revision', 'digest', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'assignmentId', 'assignmentRevision', 'role',
    'capabilitySnapshotRef', 'capabilitySnapshotRevision', 'tools', 'skills',
  ], `supply ${expectedSource}`);
  if (supply.source !== expectedSource) {
    throw new Error(`Workroom capability supply source drift: expected ${expectedSource}`);
  }
  const { digest: actualDigest, ...input } = supply;
  const canonical = createWorkroomRoleCapabilitySupply(input);
  if (actualDigest !== canonical.digest || stableJson(supply) !== stableJson(canonical)) {
    throw new Error(`Workroom capability supply ${expectedSource} digest does not match its exact content`);
  }
}

function validateSuppliesAgainstEnvelope(
  supplies: readonly WorkroomRoleCapabilitySupply[],
  envelope: AssignmentExecutionEnvelope,
): void {
  for (const supply of supplies) {
    for (const [label, actual, expected] of [
    ['projectId', supply.projectId, envelope.projectId],
    ['runId', supply.runId, envelope.runId],
    ['taskKey', supply.taskKey, envelope.taskKey],
    ['taskRevision', supply.taskRevision, envelope.taskRevision],
    ['assignmentId', supply.assignmentId, envelope.assignmentId],
    ['assignmentRevision', supply.assignmentRevision, envelope.assignmentRevision],
    ['role', supply.role, envelope.role],
  ] as const) {
    if (actual !== expected) throw new Error(`Workroom capability supply ${label} scope drift`);
  }
  }
}

function validateSupplyInput(
  expectedSource: WorkroomRoleCapabilitySupplySource,
  supply: WorkroomRoleCapabilitySupplyInput,
): void {
  if (!supply || typeof supply !== 'object' || Array.isArray(supply)) {
    throw new Error(`Workroom capability supply ${expectedSource} must be an object`);
  }
  if (!SOURCES.includes(expectedSource)) {
    throw new Error(`Workroom capability supply has unsupported source ${expectedSource}`);
  }
  assertExactKeys(supply, [
    'source', 'id', 'revision', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'assignmentId', 'assignmentRevision', 'role',
    'capabilitySnapshotRef', 'capabilitySnapshotRevision', 'tools', 'skills',
  ], `supply ${expectedSource}`);
  requireText(supply.id, `${expectedSource}.id`);
  requirePositiveInteger(supply.revision, `${expectedSource}.revision`);
  requireText(supply.projectId, `${expectedSource}.projectId`);
  requireText(supply.runId, `${expectedSource}.runId`);
  requireText(supply.taskKey, `${expectedSource}.taskKey`);
  requirePositiveInteger(supply.taskRevision, `${expectedSource}.taskRevision`);
  requireText(supply.assignmentId, `${expectedSource}.assignmentId`);
  requirePositiveInteger(supply.assignmentRevision, `${expectedSource}.assignmentRevision`);
  if (!['orchestrator', 'executor', 'reviewer', 'integration'].includes(supply.role)) {
    throw new Error(`Workroom capability ${expectedSource}.role is unsupported`);
  }
  requireText(supply.capabilitySnapshotRef, `${expectedSource}.capabilitySnapshotRef`);
  requirePositiveInteger(
    supply.capabilitySnapshotRevision,
    `${expectedSource}.capabilitySnapshotRevision`,
  );
  if (!Array.isArray(supply.tools) || !Array.isArray(supply.skills)) {
    throw new Error(`Workroom capability supply ${expectedSource} Tool/Skill lists are invalid`);
  }
  validateDescriptors(supply.tools, 'Tool', expectedSource, ['name', 'digest', 'deferred']);
  validateDescriptors(supply.skills, 'Skill', expectedSource, [
    'name', 'digest', 'requiredTools', 'deferred',
  ]);
  for (const skill of supply.skills) {
    if (!Array.isArray(skill.requiredTools)) {
      throw new Error(`Workroom Skill ${skill.name} requiredTools must be an array`);
    }
    const required = new Set<string>();
    for (const toolName of skill.requiredTools) {
      requireText(toolName, `Skill ${skill.name} required Tool`);
      if (required.has(toolName)) throw new Error(`Workroom Skill ${skill.name} repeats Tool ${toolName}`);
      required.add(toolName);
    }
  }
}

function canonicalSupplyProjection(
  input: WorkroomRoleCapabilitySupplyInput,
): WorkroomRoleCapabilitySupplyInput {
  return {
    ...input,
    tools: [...input.tools]
      .map(tool => ({ ...tool }))
      .sort((left, right) => compareCanonicalWorkroomText(left.name, right.name)),
    skills: [...input.skills]
      .map(skill => ({
        ...skill,
        requiredTools: [...skill.requiredTools].sort(),
      }))
      .sort((left, right) => compareCanonicalWorkroomText(left.name, right.name)),
  };
}

function capabilityContent(
  ref: string,
  revision: number,
  compiled: CompiledCapabilityContent,
): Readonly<Record<string, unknown>> {
  return {
    version: 1,
    ref,
    revision,
    scope: {
      projectId: compiled.projectId,
      runId: compiled.runId,
      taskKey: compiled.taskKey,
      taskRevision: compiled.taskRevision,
      assignmentId: compiled.assignmentId,
      assignmentRevision: compiled.assignmentRevision,
    },
    role: compiled.role,
    authorities: compiled.authorities,
    tools: compiled.tools,
    skills: compiled.skills,
  };
}

function intersectDescriptors<T extends { readonly name: string }>(
  supplies: readonly (readonly T[])[],
): T[] {
  const [first, ...rest] = supplies;
  return [...(first ?? [])]
    .filter(item => rest.every(supply => supply.some(candidate => candidate.name === item.name)))
    .sort((left, right) => compareCanonicalWorkroomText(left.name, right.name));
}

function command(
  role: WorkroomCapabilityRole,
  name: WorkroomRoleCommandName,
): WorkroomRoleCommandDescriptor {
  return { role, name, toolName: `workroom_${role}_${name}` };
}

function assertRoleTools(
  role: Extract<WorkroomCapabilityRole, 'executor' | 'integration'>,
  tools: readonly WorkroomRoleToolDescriptor[],
): void {
  const allowedCommands = new Set(COMMANDS[role].map(item => item.toolName));
  for (const tool of tools) {
    if (tool.name === 'spawn_task'
      || (tool.name.startsWith('workroom_') && !allowedCommands.has(tool.name))) {
      throw new Error(`Workroom role ${role} forbids Tool ${tool.name}`);
    }
  }
}

function assertDescriptorIdentity(
  supplies: readonly WorkroomRoleCapabilitySupply[],
  kind: 'Tool' | 'Skill',
  select: (supply: WorkroomRoleCapabilitySupply) => readonly (WorkroomRoleToolDescriptor | WorkroomRoleSkillDescriptor)[],
): void {
  const identities = new Map<string, WorkroomRoleToolDescriptor | WorkroomRoleSkillDescriptor>();
  for (const supply of supplies) {
    for (const descriptor of select(supply)) {
      const prior = identities.get(descriptor.name);
      if (!prior) {
        identities.set(descriptor.name, descriptor);
        continue;
      }
      if (prior.digest !== descriptor.digest) {
        throw new Error(`Workroom ${kind} ${descriptor.name} digest conflict`);
      }
      if (stableJson(prior) !== stableJson(descriptor)) {
        throw new Error(`Workroom ${kind} ${descriptor.name} descriptor drift`);
      }
    }
  }
}

function validateDescriptors(
  descriptors: readonly (WorkroomRoleToolDescriptor | WorkroomRoleSkillDescriptor)[],
  kind: 'Tool' | 'Skill',
  source: string,
  keys: readonly string[],
): void {
  const names = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new Error(`Workroom ${kind} descriptor in ${source} must be an object`);
    }
    assertExactKeys(descriptor, keys, `${kind} ${source}`);
    requireText(descriptor.name, `${kind}.name`);
    requireDigest(descriptor.digest, `${kind}.${descriptor.name}.digest`);
    if (descriptor.deferred !== undefined && typeof descriptor.deferred !== 'boolean') {
      throw new Error(`Workroom ${kind} ${descriptor.name} deferred flag is invalid`);
    }
    if (names.has(descriptor.name)) throw new Error(`Workroom ${kind} ${descriptor.name} is duplicated in ${source}`);
    names.add(descriptor.name);
  }
}

function assertSnapshot(
  envelope: AssignmentExecutionEnvelope,
  snapshot: WorkroomRoleCapabilitySnapshot,
): void {
  assertAssignmentExecutionEnvelope(envelope);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Workroom Role Capability Snapshot is invalid');
  }
  assertExactKeys(snapshot, [
    'version', 'id', 'ref', 'revision', 'digest', 'projectId', 'runId',
    'taskKey', 'taskRevision', 'assignmentId', 'assignmentRevision', 'role',
    'authorities', 'tools', 'skills',
  ], 'Snapshot');
  if (snapshot.version !== 1) throw new Error('Workroom Role Capability Snapshot version is unsupported');
  requireDigest(snapshot.digest, 'snapshot.digest');
  if (snapshot.id !== snapshot.ref) {
    throw new Error('Workroom Role Capability Snapshot id/ref drift');
  }
  requireText(snapshot.ref, 'snapshot.ref');
  requirePositiveInteger(snapshot.revision, 'snapshot.revision');
  requireText(snapshot.projectId, 'snapshot.projectId');
  requireText(snapshot.runId, 'snapshot.runId');
  requireText(snapshot.taskKey, 'snapshot.taskKey');
  requirePositiveInteger(snapshot.taskRevision, 'snapshot.taskRevision');
  requireText(snapshot.assignmentId, 'snapshot.assignmentId');
  requirePositiveInteger(snapshot.assignmentRevision, 'snapshot.assignmentRevision');
  if (snapshot.role !== 'executor' && snapshot.role !== 'integration') {
    throw new Error(`Workroom capability projector unsupported Assignment role: ${snapshot.role}`);
  }
  if (!Array.isArray(snapshot.authorities) || snapshot.authorities.length !== SOURCES.length) {
    throw new Error('Workroom Role Capability Snapshot requires all six authorities');
  }
  const authoritySources = new Set<string>();
  snapshot.authorities.forEach((authority, index) => {
    if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
      throw new Error('Workroom Role Capability Snapshot authority is invalid');
    }
    assertExactKeys(authority, ['source', 'id', 'revision', 'digest'], 'Snapshot authority');
    if (authority.source !== SOURCES[index]) {
      throw new Error('Workroom Role Capability Snapshot authority source order drift');
    }
    if (authoritySources.has(authority.source)) {
      throw new Error(`Workroom Role Capability Snapshot authority ${authority.source} is duplicated`);
    }
    authoritySources.add(authority.source);
    requireText(authority.id, `snapshot authority ${authority.source}.id`);
    requirePositiveInteger(authority.revision, `snapshot authority ${authority.source}.revision`);
    requireDigest(authority.digest, `snapshot authority ${authority.source}.digest`);
  });
  if (!Array.isArray(snapshot.tools) || !Array.isArray(snapshot.skills)) {
    throw new Error('Workroom Role Capability Snapshot Tool/Skill lists are invalid');
  }
  validateDescriptors(snapshot.tools, 'Tool', 'snapshot', ['name', 'digest', 'deferred']);
  validateDescriptors(snapshot.skills, 'Skill', 'snapshot', [
    'name', 'digest', 'requiredTools', 'deferred',
  ]);
  assertRoleTools(snapshot.role, snapshot.tools);
  for (const skill of snapshot.skills) {
    if (!Array.isArray(skill.requiredTools)) {
      throw new Error(`Workroom Skill ${skill.name} requiredTools must be an array`);
    }
    const required = new Set<string>();
    for (const toolName of skill.requiredTools) {
      requireText(toolName, `Skill ${skill.name} required Tool`);
      if (required.has(toolName)) throw new Error(`Workroom Skill ${skill.name} repeats Tool ${toolName}`);
      required.add(toolName);
      if (!snapshot.tools.some(tool => tool.name === toolName)) {
        throw new Error(`Workroom Skill ${skill.name} requires unauthorized Tool ${toolName}`);
      }
    }
  }
  const content = capabilityContent(snapshot.ref, snapshot.revision, {
    projectId: snapshot.projectId,
    runId: snapshot.runId,
    taskKey: snapshot.taskKey,
    taskRevision: snapshot.taskRevision,
    assignmentId: snapshot.assignmentId,
    assignmentRevision: snapshot.assignmentRevision,
    role: snapshot.role,
    authorities: snapshot.authorities,
    tools: snapshot.tools,
    skills: snapshot.skills,
  });
  if (digest(content) !== snapshot.digest) {
    throw new Error('Workroom Role Capability Snapshot digest conflict');
  }
  const bindings = [
    ['ref', snapshot.ref, envelope.capabilitySnapshot.ref],
    ['revision', snapshot.revision, envelope.capabilitySnapshot.revision],
    ['digest', snapshot.digest, envelope.capabilitySnapshot.digest],
    ['projectId', snapshot.projectId, envelope.projectId],
    ['runId', snapshot.runId, envelope.runId],
    ['taskKey', snapshot.taskKey, envelope.taskKey],
    ['taskRevision', snapshot.taskRevision, envelope.taskRevision],
    ['assignmentId', snapshot.assignmentId, envelope.assignmentId],
    ['assignmentRevision', snapshot.assignmentRevision, envelope.assignmentRevision],
    ['role', snapshot.role, envelope.role],
  ] as const;
  if (bindings.some(([, actual, expected]) => actual !== expected)) {
    throw new Error('Workroom Role Capability Snapshot does not match the trusted Envelope');
  }
  if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.tools)
    || !Object.isFrozen(snapshot.skills) || !Object.isFrozen(snapshot.authorities)
    || snapshot.tools.some(tool => !Object.isFrozen(tool))
    || snapshot.skills.some(skill => !Object.isFrozen(skill)
      || !Object.isFrozen(skill.requiredTools))
    || snapshot.authorities.some(authority => !Object.isFrozen(authority))) {
    throw new Error('Workroom Role Capability Snapshot must be deeply immutable');
  }
}

function loadAllowlisted<T extends { readonly name: string; readonly digest: string }>(
  descriptors: readonly T[],
  name: string,
  expectedDigest: string,
  kind: 'Tool' | 'Skill',
): T {
  requireText(name, `${kind} name`);
  requireDigest(expectedDigest, `${kind} expected digest`);
  const descriptor = descriptors.find(item => item.name === name);
  if (!descriptor) throw new Error(`Workroom ${kind} ${name} is not allowlisted by the Snapshot`);
  if (descriptor.digest !== expectedDigest) throw new Error(`Workroom ${kind} ${name} digest conflict`);
  return descriptor;
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Workroom capability ${label} contains forbidden field ${unexpected}`);
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Workroom capability ${label} must be non-empty text`);
  }
}

function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Workroom capability ${label} must be a positive safe integer`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom capability ${label} must be a canonical sha256 digest`);
  }
}
