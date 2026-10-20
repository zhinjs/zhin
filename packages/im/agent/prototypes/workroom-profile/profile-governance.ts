/**
 * PROTOTYPE — decision-map ticket #10. Delete after the contract is absorbed.
 *
 * Question: can immutable domain/competency/integration/policy packs compose
 * heterogeneous Workroom Profiles while keeping Assignment capabilities minimal
 * and every learned Profile revision explainable, governed and reversible?
 */
import { createHash } from 'node:crypto';

export type PackKind = 'domain' | 'competency' | 'integration' | 'policy';
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface PackRef {
  readonly id: string;
  readonly version: number;
  readonly digest: string;
}

export interface ToolDefinition {
  readonly id: string;
  readonly digest: string;
  readonly external: boolean;
  readonly mutating: boolean;
}

export interface SkillDefinition {
  readonly id: string;
  readonly digest: string;
  readonly requiresTools: readonly string[];
  readonly requiresSkills?: readonly string[];
}

export interface IntegrationDefinition {
  readonly id: string;
  readonly digest: string;
  readonly external: boolean;
  readonly tools: readonly string[];
}

export interface AgentDefinition {
  readonly id: string;
  readonly role: string;
  readonly allowedTools: readonly string[];
  readonly allowedSkills: readonly string[];
  readonly allowedIntegrations: readonly string[];
  readonly authorityCeiling: readonly string[];
}

export interface CapabilityRequirement {
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly integrations?: readonly string[];
  readonly authorities?: readonly string[];
}

export interface WorkflowTaskTemplate {
  readonly key: string;
  readonly role: string;
  readonly requires: CapabilityRequirement;
  readonly dependsOn?: readonly string[];
}

export interface WorkflowStrategy {
  readonly id: string;
  readonly digest: string;
  readonly requiredByProfile: boolean;
  readonly tasks: readonly WorkflowTaskTemplate[];
}

export interface MemoryFieldDefinition {
  readonly key: string;
  readonly type: 'string' | 'number' | 'boolean' | 'string[]';
  readonly required: boolean;
}

export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
  readonly supersedes?: string;
}

export interface PolicyContribution {
  readonly deniedTools?: readonly string[];
  readonly deniedIntegrations?: readonly string[];
  readonly deniedAuthorities?: readonly string[];
  readonly reviewerFloor?: RiskTier;
  readonly autoAcceptanceGrants?: readonly string[];
}

export interface CapabilityPack {
  readonly id: string;
  readonly version: number;
  readonly kind: PackKind;
  readonly digest: string;
  readonly requires?: readonly PackRef[];
  readonly tools?: readonly ToolDefinition[];
  readonly skills?: readonly SkillDefinition[];
  readonly integrations?: readonly IntegrationDefinition[];
  readonly agents?: readonly AgentDefinition[];
  readonly workflows?: readonly WorkflowStrategy[];
  readonly memorySchema?: readonly MemoryFieldDefinition[];
  readonly glossary?: readonly GlossaryEntry[];
  readonly policy?: PolicyContribution;
}

export interface ProjectCharterRevision {
  readonly id: string;
  readonly objective: string;
  readonly constraints: readonly string[];
}

export interface ProfileOverlay {
  readonly glossary?: readonly GlossaryEntry[];
  readonly memorySchema?: readonly MemoryFieldDefinition[];
  readonly workflowParameters?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
  readonly enabledSkills?: readonly string[];
  readonly enabledTools?: readonly string[];
  readonly enabledIntegrations?: readonly string[];
  readonly authorityGrants?: readonly string[];
  readonly autoAcceptanceGrants?: readonly string[];
}

export interface WorkroomProfileRevision {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly parentRevisionId?: string;
  readonly restoredFromRevisionId?: string;
  readonly charter: ProjectCharterRevision;
  readonly packs: readonly PackRef[];
  readonly overlay: ProfileOverlay;
  readonly sourceRefs: readonly string[];
  readonly proposedBy: string;
}

export interface StrategyDiagnostic {
  readonly strategyId: string;
  readonly available: boolean;
  readonly reasons: readonly string[];
}

export interface CompiledProfile {
  readonly revision: WorkroomProfileRevision;
  readonly digest: string;
  readonly packs: readonly CapabilityPack[];
  readonly tools: Readonly<Record<string, ToolDefinition>>;
  readonly skills: Readonly<Record<string, SkillDefinition>>;
  readonly integrations: Readonly<Record<string, IntegrationDefinition>>;
  readonly agents: Readonly<Record<string, AgentDefinition>>;
  readonly workflows: Readonly<Record<string, WorkflowStrategy>>;
  readonly memorySchema: Readonly<Record<string, MemoryFieldDefinition>>;
  readonly glossary: Readonly<Record<string, GlossaryEntry>>;
  readonly authorityGrants: readonly string[];
  readonly autoAcceptanceGrants: readonly string[];
  readonly reviewerFloor: RiskTier;
  readonly strategies: readonly StrategyDiagnostic[];
}

export interface AssignmentCapabilitySnapshot {
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly workflowId: string;
  readonly taskKey: string;
  readonly agentDefinitionId: string;
  readonly tools: readonly string[];
  readonly skills: readonly string[];
  readonly integrations: readonly string[];
  readonly authorities: readonly string[];
}

export type RevisionChangeClass =
  | 'knowledge'
  | 'charter_change'
  | 'working_method'
  | 'skill_selection'
  | 'tool_expansion'
  | 'external_access_expansion'
  | 'authority_expansion'
  | 'auto_acceptance_expansion'
  | 'memory_schema_migration'
  | 'policy_relaxation'
  | 'pack_supply_change';

export interface RevisionAssessment {
  readonly classes: readonly RevisionChangeClass[];
  readonly explanations: readonly string[];
  readonly requiresSponsor: boolean;
}

export interface ProfileProposal {
  readonly id: string;
  readonly baseRevisionId: string;
  readonly draft: WorkroomProfileRevision;
  readonly assessment: RevisionAssessment;
  readonly status: 'policy_eligible' | 'approval_required' | 'activated' | 'rejected' | 'stale';
  readonly decisionReason?: string;
}

export interface ProfileGovernanceState {
  readonly catalog: Readonly<Record<string, CapabilityPack>>;
  readonly acceptedSources: readonly string[];
  readonly revisions: Readonly<Record<string, WorkroomProfileRevision>>;
  readonly activeRevisionId: string;
  readonly proposals: Readonly<Record<string, ProfileProposal>>;
  readonly runPins: Readonly<Record<string, string>>;
}

export type ProfileActor = Readonly<{
  id: string;
  role: 'profile_curator' | 'policy' | 'sponsor';
}>;

export function packKey(ref: PackRef): string {
  return `${ref.id}@${ref.version}`;
}

export function compileProfile(
  revision: WorkroomProfileRevision,
  catalog: Readonly<Record<string, CapabilityPack>>,
): CompiledProfile {
  const packs = revision.packs.map((ref) => {
    const pack = catalog[packKey(ref)];
    if (!pack) throw new Error(`Missing Capability Pack ${packKey(ref)}`);
    if (pack.digest !== ref.digest) throw new Error(`Capability Pack digest mismatch for ${packKey(ref)}`);
    return pack;
  });
  if (!packs.some((pack) => pack.kind === 'domain')) throw new Error('Profile requires at least one domain pack');
  if (!packs.some((pack) => pack.kind === 'policy')) throw new Error('Profile requires at least one policy pack');
  const selected = new Map(revision.packs.map((ref) => [packKey(ref), ref]));
  for (const pack of packs) {
    for (const requirement of pack.requires ?? []) {
      const selectedRef = selected.get(packKey(requirement));
      if (!selectedRef) throw new Error(`${packKey(pack)} requires ${packKey(requirement)}`);
      if (selectedRef.digest !== requirement.digest) throw new Error(`${packKey(pack)} requires digest ${requirement.digest} for ${packKey(requirement)}`);
    }
  }

  const tools = mergeDefinitions(packs.flatMap((pack) => pack.tools ?? []), 'Tool');
  const skills = mergeDefinitions(packs.flatMap((pack) => pack.skills ?? []), 'Skill');
  const integrations = mergeDefinitions(packs.flatMap((pack) => pack.integrations ?? []), 'Integration');
  const agents = mergeById(packs.flatMap((pack) => pack.agents ?? []), 'Agent Definition');
  const workflows = mergeDefinitions(packs.flatMap((pack) => pack.workflows ?? []), 'Workflow Strategy');
  const deniedTools = new Set(packs.flatMap((pack) => pack.policy?.deniedTools ?? []));
  const deniedIntegrations = new Set(packs.flatMap((pack) => pack.policy?.deniedIntegrations ?? []));
  const deniedAuthorities = new Set(packs.flatMap((pack) => pack.policy?.deniedAuthorities ?? []));

  const enabledTools = selectEnabled(tools, revision.overlay.enabledTools ?? [], deniedTools);
  const enabledSkills = selectEnabled(skills, revision.overlay.enabledSkills ?? [], new Set());
  const enabledIntegrations = selectEnabled(integrations, revision.overlay.enabledIntegrations ?? [], deniedIntegrations);
  const memorySchema = mergeMemorySchema(packs.flatMap((pack) => pack.memorySchema ?? []), revision.overlay.memorySchema ?? []);
  const glossary = mergeGlossary(packs.flatMap((pack) => pack.glossary ?? []), revision.overlay.glossary ?? []);
  const authorityGrants = unique(revision.overlay.authorityGrants ?? []).filter((id) => !deniedAuthorities.has(id));
  const autoAcceptanceGrants = unique([
    ...packs.flatMap((pack) => pack.policy?.autoAcceptanceGrants ?? []),
    ...(revision.overlay.autoAcceptanceGrants ?? []),
  ]);
  const reviewerFloor = packs.reduce<RiskTier>((floor, pack) => stricterRiskFloor(floor, pack.policy?.reviewerFloor), 'low');

  for (const skill of Object.values(enabledSkills)) {
    for (const toolId of skill.requiresTools) {
      if (!enabledTools[toolId]) throw new Error(`Skill ${skill.id} requires unavailable Tool ${toolId}`);
    }
    for (const skillId of skill.requiresSkills ?? []) {
      if (!enabledSkills[skillId]) throw new Error(`Skill ${skill.id} requires unavailable Skill ${skillId}`);
    }
  }
  for (const integration of Object.values(enabledIntegrations)) {
    for (const toolId of integration.tools) {
      if (!enabledTools[toolId]) throw new Error(`Integration ${integration.id} requires unavailable Tool ${toolId}`);
    }
  }

  const provisional = {
    revision,
    packs,
    tools: enabledTools,
    skills: enabledSkills,
    integrations: enabledIntegrations,
    agents,
    workflows,
    memorySchema,
    glossary,
    authorityGrants,
    autoAcceptanceGrants,
    reviewerFloor,
  };
  const strategies = Object.values(workflows).map((strategy) => diagnoseStrategy(provisional, strategy));
  const unavailableRequired = strategies.filter((item) => !item.available && workflows[item.strategyId]?.requiredByProfile);
  if (unavailableRequired.length > 0) {
    throw new Error(`Required Workflow Strategy unavailable: ${unavailableRequired.map((item) => `${item.strategyId} (${item.reasons.join('; ')})`).join(', ')}`);
  }
  const digest = hash({
    charter: revision.charter,
    packs: packs.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest })),
    overlay: revision.overlay,
    compiled: {
      tools: Object.keys(enabledTools), skills: Object.keys(enabledSkills), integrations: Object.keys(enabledIntegrations),
      agents: Object.keys(agents), workflows: Object.keys(workflows), memorySchema, glossary,
      authorityGrants, autoAcceptanceGrants, reviewerFloor,
    },
  });
  return Object.freeze({ ...provisional, digest, strategies });
}

export function resolveAssignmentCapabilities(
  profile: CompiledProfile,
  workflowId: string,
  taskKey: string,
  preferredAgentId?: string,
): AssignmentCapabilitySnapshot {
  const workflow = profile.workflows[workflowId];
  if (!workflow) throw new Error(`Unknown Workflow Strategy ${workflowId}`);
  const task = workflow.tasks.find((item) => item.key === taskKey);
  if (!task) throw new Error(`Unknown Task template ${workflowId}/${taskKey}`);
  const requiredSkills = closeSkills(task.requires.skills ?? [], profile.skills);
  const requiredTools = unique([
    ...(task.requires.tools ?? []),
    ...requiredSkills.flatMap((id) => profile.skills[id]?.requiresTools ?? []),
  ]);
  const requiredIntegrations = unique(task.requires.integrations ?? []);
  const requiredAuthorities = unique(task.requires.authorities ?? []);
  const candidates = Object.values(profile.agents).filter((agent) => agent.role === task.role);
  const agent = preferredAgentId
    ? candidates.find((item) => item.id === preferredAgentId)
    : candidates.find((item) => agentSatisfies(item, requiredTools, requiredSkills, requiredIntegrations, requiredAuthorities));
  if (!agent) throw new Error(`No Agent Definition satisfies ${workflowId}/${taskKey}`);
  assertRequirements(profile, agent, requiredTools, requiredSkills, requiredIntegrations, requiredAuthorities);
  return Object.freeze({
    profileRevisionId: profile.revision.id,
    profileDigest: profile.digest,
    workflowId,
    taskKey,
    agentDefinitionId: agent.id,
    tools: requiredTools,
    skills: requiredSkills,
    integrations: requiredIntegrations,
    authorities: requiredAuthorities,
  });
}

export function initialProfileGovernance(
  catalog: Readonly<Record<string, CapabilityPack>>,
  revision: WorkroomProfileRevision,
  acceptedSources: readonly string[],
): ProfileGovernanceState {
  compileProfile(revision, catalog);
  return Object.freeze({
    catalog,
    acceptedSources: unique(acceptedSources),
    revisions: Object.freeze({ [revision.id]: revision }),
    activeRevisionId: revision.id,
    proposals: Object.freeze({}),
    runPins: Object.freeze({}),
  });
}

export function proposeProfileRevision(
  state: ProfileGovernanceState,
  actor: ProfileActor,
  proposalId: string,
  draft: WorkroomProfileRevision,
): ProfileGovernanceState {
  if (actor.role !== 'profile_curator' && actor.role !== 'sponsor') throw new Error('Only Profile Curator or Sponsor may propose a Profile Revision');
  if (draft.parentRevisionId !== state.activeRevisionId) throw new Error('Profile proposal base is stale');
  const active = state.revisions[state.activeRevisionId]!;
  if (draft.projectId !== active.projectId) throw new Error('Profile proposal cannot change Project identity');
  if (draft.version !== active.version + 1) throw new Error('Profile proposal version must increment exactly once');
  if (draft.sourceRefs.length === 0 || draft.sourceRefs.some((ref) => !state.acceptedSources.includes(ref))) {
    throw new Error('Profile proposal requires only accepted source refs');
  }
  const base = compileProfile(state.revisions[state.activeRevisionId]!, state.catalog);
  const next = compileProfile(draft, state.catalog);
  const assessment = assessRevision(base, next);
  const proposal: ProfileProposal = Object.freeze({
    id: proposalId,
    baseRevisionId: base.revision.id,
    draft,
    assessment,
    status: assessment.requiresSponsor ? 'approval_required' : 'policy_eligible',
  });
  return Object.freeze({ ...state, proposals: Object.freeze({ ...state.proposals, [proposalId]: proposal }) });
}

export function decideProfileProposal(
  state: ProfileGovernanceState,
  actor: ProfileActor,
  proposalId: string,
  decision: 'activate' | 'reject',
  reason: string,
): ProfileGovernanceState {
  const proposal = state.proposals[proposalId];
  if (!proposal) throw new Error(`Unknown Profile proposal ${proposalId}`);
  if (proposal.baseRevisionId !== state.activeRevisionId) {
    return updateProposal(state, proposalId, { ...proposal, status: 'stale', decisionReason: 'active Profile changed' });
  }
  if (actor.role !== 'policy' && actor.role !== 'sponsor') throw new Error('Only policy or Sponsor may decide a Profile proposal');
  if (proposal.assessment.requiresSponsor && actor.role !== 'sponsor') throw new Error('Profile expansion requires Sponsor approval');
  if (decision === 'reject') return updateProposal(state, proposalId, { ...proposal, status: 'rejected', decisionReason: reason });
  const activated = { ...proposal, status: 'activated' as const, decisionReason: reason };
  return Object.freeze({
    ...state,
    activeRevisionId: proposal.draft.id,
    revisions: Object.freeze({ ...state.revisions, [proposal.draft.id]: proposal.draft }),
    proposals: Object.freeze({ ...state.proposals, [proposalId]: Object.freeze(activated) }),
  });
}

export function pinRunProfile(state: ProfileGovernanceState, runId: string): ProfileGovernanceState {
  if (state.runPins[runId]) throw new Error(`Run ${runId} already pinned`);
  return Object.freeze({ ...state, runPins: Object.freeze({ ...state.runPins, [runId]: state.activeRevisionId }) });
}

export function draftRollbackRevision(
  state: ProfileGovernanceState,
  targetRevisionId: string,
  id: string,
  sourceRef: string,
  proposedBy: string,
): WorkroomProfileRevision {
  const current = state.revisions[state.activeRevisionId]!;
  const target = state.revisions[targetRevisionId];
  if (!target) throw new Error(`Unknown rollback target ${targetRevisionId}`);
  return Object.freeze({
    ...target,
    id,
    version: current.version + 1,
    parentRevisionId: current.id,
    restoredFromRevisionId: target.id,
    sourceRefs: [sourceRef],
    proposedBy,
  });
}

export function assessRevision(base: CompiledProfile, next: CompiledProfile): RevisionAssessment {
  const classes = new Set<RevisionChangeClass>();
  const explanations: string[] = [];
  if (hash(base.revision.charter) !== hash(next.revision.charter)) {
    classes.add('charter_change');
    explanations.push('Project Charter objective or constraints changed.');
  }
  if (hash(base.glossary) !== hash(next.glossary)) {
    classes.add('knowledge');
    explanations.push('Glossary changed from accepted Project knowledge.');
  }
  if (hash(base.revision.overlay.workflowParameters ?? {}) !== hash(next.revision.overlay.workflowParameters ?? {})) {
    classes.add('working_method');
    explanations.push('Workflow parameters changed.');
  }
  if (added(Object.keys(base.skills), Object.keys(next.skills)).length > 0) {
    classes.add('skill_selection');
    explanations.push(`Skills added: ${added(Object.keys(base.skills), Object.keys(next.skills)).join(', ')}`);
  }
  const tools = added(Object.keys(base.tools), Object.keys(next.tools));
  if (tools.length > 0) {
    classes.add('tool_expansion');
    explanations.push(`Tools added: ${tools.join(', ')}`);
  }
  const integrations = added(Object.keys(base.integrations), Object.keys(next.integrations));
  if (integrations.length > 0 || tools.some((id) => next.tools[id]?.external)) {
    classes.add('external_access_expansion');
    explanations.push(`External capabilities added: ${integrations.join(', ') || tools.filter((id) => next.tools[id]?.external).join(', ')}`);
  }
  const authorities = added(base.authorityGrants, next.authorityGrants);
  if (authorities.length > 0) {
    classes.add('authority_expansion');
    explanations.push(`Authority grants added: ${authorities.join(', ')}`);
  }
  const autoAcceptance = added(base.autoAcceptanceGrants, next.autoAcceptanceGrants);
  if (autoAcceptance.length > 0) {
    classes.add('auto_acceptance_expansion');
    explanations.push(`Automatic acceptance scope added: ${autoAcceptance.join(', ')}`);
  }
  if (memorySchemaNeedsMigration(base.memorySchema, next.memorySchema)) {
    classes.add('memory_schema_migration');
    explanations.push('Memory Schema removes, changes, or makes a field required.');
  } else if (hash(base.memorySchema) !== hash(next.memorySchema)) {
    classes.add('knowledge');
    explanations.push('Optional Memory Schema knowledge field added.');
  }
  const basePacks = new Set(base.revision.packs.map(packKey));
  const addedPacks = next.revision.packs.filter((ref) => !basePacks.has(packKey(ref)));
  if (addedPacks.length > 0) {
    classes.add('pack_supply_change');
    explanations.push(`Capability Pack supply added or upgraded: ${addedPacks.map(packKey).join(', ')}`);
  }
  if (riskRank(next.reviewerFloor) < riskRank(base.reviewerFloor)) {
    classes.add('policy_relaxation');
    explanations.push(`Reviewer floor relaxed from ${base.reviewerFloor} to ${next.reviewerFloor}.`);
  }
  const sensitive = new Set<RevisionChangeClass>([
    'charter_change',
    'tool_expansion', 'external_access_expansion', 'authority_expansion',
    'auto_acceptance_expansion', 'memory_schema_migration', 'policy_relaxation',
    'pack_supply_change',
  ]);
  return Object.freeze({
    classes: [...classes],
    explanations,
    requiresSponsor: [...classes].some((item) => sensitive.has(item)),
  });
}

function diagnoseStrategy(
  profile: Omit<CompiledProfile, 'digest' | 'strategies'>,
  strategy: WorkflowStrategy,
): StrategyDiagnostic {
  const reasons: string[] = [];
  for (const task of strategy.tasks) {
    try {
      const skills = closeSkills(task.requires.skills ?? [], profile.skills);
      const tools = unique([...(task.requires.tools ?? []), ...skills.flatMap((id) => profile.skills[id]?.requiresTools ?? [])]);
      const integrations = unique(task.requires.integrations ?? []);
      const authorities = unique(task.requires.authorities ?? []);
      const agent = Object.values(profile.agents).find((candidate) => candidate.role === task.role
        && agentSatisfies(candidate, tools, skills, integrations, authorities));
      if (!agent) reasons.push(`${task.key}: no compatible Agent Definition for role ${task.role}`);
      else assertRequirements(profile as CompiledProfile, agent, tools, skills, integrations, authorities);
    } catch (error) {
      reasons.push(`${task.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return Object.freeze({ strategyId: strategy.id, available: reasons.length === 0, reasons });
}

function assertRequirements(
  profile: Pick<CompiledProfile, 'tools' | 'skills' | 'integrations' | 'authorityGrants'>,
  agent: AgentDefinition,
  tools: readonly string[],
  skills: readonly string[],
  integrations: readonly string[],
  authorities: readonly string[],
): void {
  for (const id of tools) {
    if (!profile.tools[id]) throw new Error(`required Tool unavailable: ${id}`);
    if (!agent.allowedTools.includes(id)) throw new Error(`Agent ${agent.id} cannot use Tool ${id}`);
  }
  for (const id of skills) {
    if (!profile.skills[id]) throw new Error(`required Skill unavailable: ${id}`);
    if (!agent.allowedSkills.includes(id)) throw new Error(`Agent ${agent.id} cannot use Skill ${id}`);
  }
  for (const id of integrations) {
    if (!profile.integrations[id]) throw new Error(`required Integration unavailable: ${id}`);
    if (!agent.allowedIntegrations.includes(id)) throw new Error(`Agent ${agent.id} cannot use Integration ${id}`);
  }
  for (const id of authorities) {
    if (!profile.authorityGrants.includes(id)) throw new Error(`required authority unavailable: ${id}`);
    if (!agent.authorityCeiling.includes(id)) throw new Error(`Agent ${agent.id} exceeds authority ceiling for ${id}`);
  }
}

function agentSatisfies(
  agent: AgentDefinition,
  tools: readonly string[],
  skills: readonly string[],
  integrations: readonly string[],
  authorities: readonly string[],
): boolean {
  return tools.every((id) => agent.allowedTools.includes(id))
    && skills.every((id) => agent.allowedSkills.includes(id))
    && integrations.every((id) => agent.allowedIntegrations.includes(id))
    && authorities.every((id) => agent.authorityCeiling.includes(id));
}

function closeSkills(ids: readonly string[], skills: Readonly<Record<string, SkillDefinition>>): string[] {
  const result = new Set<string>();
  const visit = (id: string, stack: readonly string[]) => {
    if (stack.includes(id)) throw new Error(`Skill prerequisite cycle: ${[...stack, id].join(' -> ')}`);
    const skill = skills[id];
    if (!skill) throw new Error(`required Skill unavailable: ${id}`);
    if (result.has(id)) return;
    for (const dependency of skill.requiresSkills ?? []) visit(dependency, [...stack, id]);
    result.add(id);
  };
  for (const id of ids) visit(id, []);
  return [...result];
}

function mergeDefinitions<T extends { readonly id: string; readonly digest: string }>(values: readonly T[], label: string): Readonly<Record<string, T>> {
  const result: Record<string, T> = {};
  for (const value of values) {
    const current = result[value.id];
    if (current && current.digest !== value.digest) throw new Error(`${label} conflict for ${value.id}`);
    result[value.id] = value;
  }
  return Object.freeze(result);
}

function mergeById<T extends { readonly id: string }>(values: readonly T[], label: string): Readonly<Record<string, T>> {
  const result: Record<string, T> = {};
  for (const value of values) {
    const current = result[value.id];
    if (current && hash(current) !== hash(value)) throw new Error(`${label} conflict for ${value.id}`);
    result[value.id] = value;
  }
  return Object.freeze(result);
}

function selectEnabled<T>(catalog: Readonly<Record<string, T>>, selected: readonly string[], denied: ReadonlySet<string>): Readonly<Record<string, T>> {
  const ids = selected;
  const result: Record<string, T> = {};
  for (const id of ids) {
    if (denied.has(id)) continue;
    const value = catalog[id];
    if (!value) throw new Error(`Profile enables unknown capability ${id}`);
    result[id] = value;
  }
  return Object.freeze(result);
}

function mergeMemorySchema(base: readonly MemoryFieldDefinition[], overlay: readonly MemoryFieldDefinition[]): Readonly<Record<string, MemoryFieldDefinition>> {
  const result: Record<string, MemoryFieldDefinition> = {};
  for (const field of [...base, ...overlay]) {
    const current = result[field.key];
    if (current && (current.type !== field.type || current.required !== field.required)) throw new Error(`Memory Schema conflict for ${field.key}`);
    result[field.key] = field;
  }
  return Object.freeze(result);
}

function mergeGlossary(base: readonly GlossaryEntry[], overlay: readonly GlossaryEntry[]): Readonly<Record<string, GlossaryEntry>> {
  const result: Record<string, GlossaryEntry> = {};
  for (const entry of [...base, ...overlay]) {
    const current = result[entry.term];
    if (current && current.definition !== entry.definition && entry.supersedes !== current.definition) {
      throw new Error(`Glossary conflict for ${entry.term}; explicit supersedes is required`);
    }
    result[entry.term] = entry;
  }
  return Object.freeze(result);
}

function memorySchemaNeedsMigration(
  base: Readonly<Record<string, MemoryFieldDefinition>>,
  next: Readonly<Record<string, MemoryFieldDefinition>>,
): boolean {
  return Object.values(base).some((field) => {
    const candidate = next[field.key];
    return !candidate || candidate.type !== field.type || (!field.required && candidate.required);
  });
}

function stricterRiskFloor(current: RiskTier, candidate?: RiskTier): RiskTier {
  return candidate && riskRank(candidate) > riskRank(current) ? candidate : current;
}

function riskRank(value: RiskTier): number {
  return ({ low: 0, medium: 1, high: 2, critical: 3 } as const)[value];
}

function updateProposal(state: ProfileGovernanceState, id: string, proposal: ProfileProposal): ProfileGovernanceState {
  return Object.freeze({ ...state, proposals: Object.freeze({ ...state.proposals, [id]: Object.freeze(proposal) }) });
}

function added(base: readonly string[], next: readonly string[]): string[] {
  const known = new Set(base);
  return next.filter((item) => !known.has(item));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
