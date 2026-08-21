import { createHash } from 'node:crypto';

export type CapabilityPackKind = 'domain' | 'competency' | 'integration' | 'policy';

export interface CapabilityPackRef {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly digest: string;
}

export type ProfileToolDefinition = CapabilityDefinition;

export interface ProfileSkillDefinition extends CapabilityDefinition {
  readonly requiresTools: readonly string[];
}

export interface ProfileAgentDefinition extends CapabilityDefinition {
  readonly role: string;
  readonly allowedTools: readonly string[];
  readonly allowedSkills: readonly string[];
}

export interface WorkflowCapabilityRequirement {
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
}

export interface WorkflowTaskTemplate {
  readonly key: string;
  readonly role: string;
  readonly requires: WorkflowCapabilityRequirement;
}

export interface WorkflowStrategyDefinition extends CapabilityDefinition {
  readonly requiredByProfile: boolean;
  readonly tasks: readonly WorkflowTaskTemplate[];
}

export interface CapabilityPack extends CapabilityPackRef {
  readonly kind: CapabilityPackKind;
  readonly requires?: readonly CapabilityPackRef[];
  readonly tools?: readonly ProfileToolDefinition[];
  readonly skills?: readonly ProfileSkillDefinition[];
  readonly agents?: readonly ProfileAgentDefinition[];
  readonly workflows?: readonly WorkflowStrategyDefinition[];
}

export interface WorkroomProfileRevision {
  readonly id: string;
  readonly projectId: string;
  readonly charterRevisionId: string;
  readonly packs: readonly CapabilityPackRef[];
  readonly enabledTools: readonly string[];
  readonly enabledSkills: readonly string[];
  readonly enabledAgents: readonly string[];
  readonly enabledWorkflows: readonly string[];
}

export interface GenerationCapabilitySupply {
  readonly tools: readonly CapabilityDefinition[];
  readonly skills: readonly CapabilityDefinition[];
  readonly agents: readonly CapabilityDefinition[];
}

export interface WorkroomProfileCompilerInput {
  readonly revision: WorkroomProfileRevision;
  readonly packs: readonly CapabilityPack[];
  readonly generationSupply: GenerationCapabilitySupply;
}

export interface ProfileCompilerDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CompiledWorkroomProfile {
  readonly revisionId: string;
  readonly projectId: string;
  readonly charterRevisionId: string;
  readonly packRefs: readonly CapabilityPackRef[];
  readonly tools: readonly ProfileToolDefinition[];
  readonly skills: readonly ProfileSkillDefinition[];
  readonly agents: readonly ProfileAgentDefinition[];
  readonly workflows: readonly WorkflowStrategyDefinition[];
  readonly digest: string;
}

export type CompileWorkroomProfileResult =
  | Readonly<{ ok: true; profile: CompiledWorkroomProfile; diagnostics: readonly [] }>
  | Readonly<{ ok: false; diagnostics: readonly ProfileCompilerDiagnostic[] }>;

export function compileWorkroomProfile(input: WorkroomProfileCompilerInput): CompileWorkroomProfileResult {
  const diagnostics: ProfileCompilerDiagnostic[] = [];
  const packCatalog = indexExact(input.packs, 'packs', diagnostics);
  const packs = input.revision.packs
    .map((ref) => {
      const candidate = packCatalog.get(packVersionKey(ref));
      const path = `revision.packs.${packVersionKey(ref)}`;
      if (!candidate) {
        diagnostics.push({
          code: 'pack.not_found',
          path,
          message: `Capability Pack ${packVersionKey(ref)} is not available`,
        });
      } else if (candidate.digest !== ref.digest) {
        diagnostics.push({
          code: 'pack.digest_mismatch',
          path,
          message: `Capability Pack ${packVersionKey(ref)} has digest ${candidate.digest}, expected ${ref.digest}`,
        });
      }
      return candidate?.digest === ref.digest ? candidate : undefined;
    })
    .filter((pack): pack is CapabilityPack => Boolean(pack))
    .sort(comparePack);

  const selectedPacks = new Map(packs.map((pack) => [packVersionKey(pack), pack]));
  for (const pack of packs) {
    for (const requirement of pack.requires ?? []) {
      const dependency = selectedPacks.get(packVersionKey(requirement));
      const path = `packs.${packVersionKey(pack)}.requires.${packVersionKey(requirement)}`;
      if (!dependency) {
        diagnostics.push({
          code: 'pack.dependency_missing',
          path,
          message: `Capability Pack ${packVersionKey(pack)} requires selected Pack ${packVersionKey(requirement)}`,
        });
      } else if (dependency.digest !== requirement.digest) {
        diagnostics.push({
          code: 'pack.dependency_digest_mismatch',
          path,
          message: `Capability Pack ${packVersionKey(pack)} requires ${packVersionKey(requirement)} digest ${requirement.digest}, selected ${dependency.digest}`,
        });
      }
    }
  }

  const tools = selectDefinitions(
    input.revision.enabledTools,
    packs.flatMap((pack) => pack.tools ?? []),
    input.generationSupply.tools,
    'tool',
    diagnostics,
  );
  const skills = selectDefinitions(
    input.revision.enabledSkills,
    packs.flatMap((pack) => pack.skills ?? []),
    input.generationSupply.skills,
    'skill',
    diagnostics,
  ) as ProfileSkillDefinition[];
  const agents = selectDefinitions(
    input.revision.enabledAgents,
    packs.flatMap((pack) => pack.agents ?? []),
    input.generationSupply.agents,
    'agent',
    diagnostics,
  ) as ProfileAgentDefinition[];
  const packWorkflows = packs.flatMap((pack) => pack.workflows ?? []);
  const enabledWorkflowIds = new Set(input.revision.enabledWorkflows);
  for (const workflow of sortById(packWorkflows.filter((item) => item.requiredByProfile))) {
    if (enabledWorkflowIds.has(workflow.id)) continue;
    diagnostics.push({
      code: 'workflow.required_not_enabled',
      path: `workflows.${workflow.id}`,
      message: `Required Workflow ${workflow.id} is not enabled by this Profile revision`,
    });
  }
  const workflows = selectPackDefinitions(
    input.revision.enabledWorkflows,
    packWorkflows,
    'workflow',
    diagnostics,
  ) as WorkflowStrategyDefinition[];

  const enabledToolIds = new Set(tools.map((tool) => tool.id));
  const enabledSkills = new Map(skills.map((skill) => [skill.id, skill]));
  for (const skill of skills) {
    for (const toolId of unique(skill.requiresTools)) {
      if (enabledToolIds.has(toolId)) continue;
      diagnostics.push({
        code: 'skill.required_tool_not_enabled',
        path: `skills.${skill.id}.requiresTools.${toolId}`,
        message: `Skill ${skill.id} requires Tool ${toolId}, but the Tool is not enabled by this Profile revision`,
      });
    }
  }

  for (const workflow of workflows.filter((item) => item.requiredByProfile)) {
    for (const task of workflow.tasks) {
      const requiredSkills = unique(task.requires.skills ?? []);
      const requiredTools = unique([
        ...(task.requires.tools ?? []),
        ...requiredSkills.flatMap((skillId) => enabledSkills.get(skillId)?.requiresTools ?? []),
      ]);
      const capableAgent = agents.some((agent) =>
        agent.role === task.role
        && requiredSkills.every((skillId) => enabledSkills.has(skillId) && agent.allowedSkills.includes(skillId))
        && requiredTools.every((toolId) => enabledToolIds.has(toolId) && agent.allowedTools.includes(toolId)));
      if (!capableAgent) {
        diagnostics.push({
          code: 'workflow.task_unsatisfied',
          path: `workflows.${workflow.id}.tasks.${task.key}`,
          message: `Required Workflow task ${workflow.id}/${task.key} has no enabled Agent within the Profile capability ceiling`,
        });
      }
    }
  }

  if (diagnostics.length > 0) return failed(diagnostics);

  const projection = {
    revisionId: input.revision.id,
    projectId: input.revision.projectId,
    charterRevisionId: input.revision.charterRevisionId,
    packRefs: [...input.revision.packs].sort(comparePackRef).map(copyPackRef),
    tools: sortById(tools).map(copyTool),
    skills: sortById(skills).map(copySkill),
    agents: sortById(agents).map(copyAgent),
    workflows: sortById(workflows).map(copyWorkflow),
  };
  const profile = deepFreeze({
    ...projection,
    digest: digest(projection),
  });
  return deepFreeze({ ok: true as const, profile, diagnostics: [] as const });
}

function selectDefinitions<T extends CapabilityDefinition>(
  enabled: readonly string[],
  definitions: readonly T[],
  supply: readonly CapabilityDefinition[],
  kind: string,
  diagnostics: ProfileCompilerDiagnostic[],
): T[] {
  const selected = selectPackDefinitions(enabled, definitions, kind, diagnostics);
  const available = new Map<string, CapabilityDefinition>();
  for (const item of [...supply].sort(compareDefinition)) {
    const current = available.get(item.id);
    if (current && current.digest !== item.digest) {
      diagnostics.push({
        code: `${kind}.generation_supply_conflict`,
        path: `generationSupply.${kind}s.${item.id}`,
        message: `${label(kind)} ${item.id} has conflicting digests in the active generation`,
      });
      continue;
    }
    available.set(item.id, item);
  }
  for (const item of selected) {
    const supplied = available.get(item.id);
    if (!supplied || supplied.digest !== item.digest) {
      diagnostics.push({
        code: `${kind}.generation_supply_mismatch`,
        path: `generationSupply.${kind}s.${item.id}`,
        message: `${label(kind)} ${item.id} is not present in the active generation with digest ${item.digest}`,
      });
    }
  }
  return selected;
}

function selectPackDefinitions<T extends CapabilityDefinition>(
  enabled: readonly string[],
  definitions: readonly T[],
  kind: string,
  diagnostics: ProfileCompilerDiagnostic[],
): T[] {
  const catalog = new Map<string, T>();
  for (const definition of [...definitions].sort(compareDefinition)) {
    const current = catalog.get(definition.id);
    if (current && (current.digest !== definition.digest || stableJson(current) !== stableJson(definition))) {
      diagnostics.push({
        code: `${kind}.canonical_conflict`,
        path: `${kind}s.${definition.id}`,
        message: `${label(kind)} ${definition.id} has conflicting canonical digests`,
      });
      continue;
    }
    catalog.set(definition.id, definition);
  }
  return unique(enabled).flatMap((id) => {
    const definition = catalog.get(id);
    if (definition) return [definition];
    diagnostics.push({
      code: `${kind}.not_in_profile_packs`,
      path: `revision.enabled${label(kind)}s.${id}`,
      message: `${label(kind)} ${id} is not supplied by the selected Capability Packs`,
    });
    return [];
  });
}

function indexExact(
  packs: readonly CapabilityPack[],
  path: string,
  diagnostics: ProfileCompilerDiagnostic[],
): Map<string, CapabilityPack> {
  const result = new Map<string, CapabilityPack>();
  for (const pack of [...packs].sort(comparePack)) {
    const key = packVersionKey(pack);
    const current = result.get(key);
    if (current && (current.digest !== pack.digest || stableJson(current) !== stableJson(pack))) {
      diagnostics.push({
        code: 'pack.canonical_conflict',
        path: `${path}.${key}`,
        message: `Capability Pack ${key} has conflicting canonical digests`,
      });
      continue;
    }
    result.set(key, pack);
  }
  return result;
}

function capabilityKey(value: Pick<CapabilityPackRef, 'id' | 'version' | 'digest'>): string {
  return `${value.id}@${value.version}#${value.digest}`;
}

function packVersionKey(value: Pick<CapabilityPackRef, 'id' | 'version'>): string {
  return `${value.id}@${value.version}`;
}

function comparePack(left: CapabilityPack, right: CapabilityPack): number {
  return capabilityKey(left).localeCompare(capabilityKey(right));
}

function comparePackRef(left: CapabilityPackRef, right: CapabilityPackRef): number {
  return capabilityKey(left).localeCompare(capabilityKey(right));
}

function compareDefinition(left: CapabilityDefinition, right: CapabilityDefinition): number {
  return `${left.id}#${left.digest}`.localeCompare(`${right.id}#${right.digest}`);
}

function sortById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function label(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function copyPackRef(value: CapabilityPackRef): CapabilityPackRef {
  return { id: value.id, version: value.version, digest: value.digest };
}

function copyTool(value: ProfileToolDefinition): ProfileToolDefinition {
  return { id: value.id, digest: value.digest };
}

function copySkill(value: ProfileSkillDefinition): ProfileSkillDefinition {
  return { id: value.id, digest: value.digest, requiresTools: unique(value.requiresTools) };
}

function copyAgent(value: ProfileAgentDefinition): ProfileAgentDefinition {
  return {
    id: value.id,
    digest: value.digest,
    role: value.role,
    allowedTools: unique(value.allowedTools),
    allowedSkills: unique(value.allowedSkills),
  };
}

function copyWorkflow(value: WorkflowStrategyDefinition): WorkflowStrategyDefinition {
  return {
    id: value.id,
    digest: value.digest,
    requiredByProfile: value.requiredByProfile,
    tasks: [...value.tasks]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((task) => ({
        key: task.key,
        role: task.role,
        requires: {
          tools: unique(task.requires.tools ?? []),
          skills: unique(task.requires.skills ?? []),
        },
      })),
  };
}

function failed(diagnostics: readonly ProfileCompilerDiagnostic[]): CompileWorkroomProfileResult {
  return deepFreeze({
    ok: false as const,
    diagnostics: [...diagnostics].sort((left, right) =>
      `${left.path}\u0000${left.code}\u0000${left.message}`.localeCompare(`${right.path}\u0000${right.code}\u0000${right.message}`)),
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
