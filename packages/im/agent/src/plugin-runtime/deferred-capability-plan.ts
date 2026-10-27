import {
  addSkillToSnapshot,
  getLoadedToolNamesFromSnapshot,
  touchToolInSnapshot,
  touchToolsInSnapshot,
  type AgentTool,
  type TextContentBlock,
  type DeferredToolSessionSnapshot,
} from '@zhin.js/ai';
import {
  toolInputSchemaToParameters,
  type ToolInvocationContext,
  type ToolInputSchema,
} from '@zhin.js/tool';
import type { SkillDescriptor } from '@zhin.js/skill';
import { getLogger } from '@zhin.js/logger';
import { rankDecisionCandidates } from '../decision/rank.js';
import type { AgentDecisionRuntime } from '../decision/types.js';
import { buildDeferredStats, buildToolCatalog, discoverInCatalog, resolveDeferredApiTools } from '../tool-catalog/tool-catalog.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import { DEFERRED_META_TOOL_NAMES, type ToolCatalogItem } from '../tool-catalog/types.js';
import type { AgentCapabilities, ToolCapability } from './capability-ingress.js';

import { skillContextBlock } from '../context/skill-context.js';

const logger = getLogger('DeferredCapabilityPlan');

/**
 * Injected capability ceiling. It must return a subset of the given projection
 * and throw when the projection is not trusted by the ceiling's owner.
 */
export interface DeferredCapabilityCeiling {
  project(capabilities: AgentCapabilities): Readonly<Pick<AgentCapabilities, 'tools' | 'skills'>>;
}

/**
 * Reserved, model-invisible control namespace of the Agent runtime. Control
 * tools use this prefix and it is always filtered out of model-visible
 * capabilities. It is a naming convention, not a dependency on Workroom code.
 */
export const RESERVED_CONTROL_TOOL_PREFIX = 'workroom_';

/**
 * Reserved model-invisible control namespace; always filtered out of
 * model-visible capabilities.
 */
export function isReservedControlToolName(name: string): boolean {
  return (name.split('__').at(-1) ?? name).startsWith(RESERVED_CONTROL_TOOL_PREFIX);
}

export interface DeferredCapabilityController {
  loadedToolNames(): string[];
  loadedSkillInstructions(): string[];
  loadedSkillBlocks(): TextContentBlock[];
  /** Marks only a successful, unmodified runtime load_skill result. */
  modelOutputBlocks(name: string, args: unknown, text: string): TextContentBlock[] | undefined;
  /** Load a public catalog tool into the session. Returns false when it is not in this turn's catalog. */
  load(name: string): Promise<boolean>;
}

export interface DeferredCapabilityPlan {
  readonly capabilities: readonly ToolCapability[];
  readonly allTools: readonly AgentTool[];
  readonly resolvedTools: readonly AgentTool[];
  readonly catalog: readonly ToolCatalogItem[];
  readonly deferredStats: string;
  readonly controller: DeferredCapabilityController;
}

/**
 * The legacy `authority` option no longer exists; passing it at runtime throws
 * (fail-closed) instead of being silently ignored.
 */
export interface DeferredCapabilityPlanOptions {
  readonly capabilities: AgentCapabilities;
  /**
   * Optional injected capability ceiling (e.g. a Workroom Assignment).
   * Ordinary chat omits it and retains its own capability projection.
   */
  readonly ceiling?: DeferredCapabilityCeiling;
  readonly sessionSnapshot: DeferredToolSessionSnapshot;
  readonly config: Parameters<typeof resolveDeferredToolsConfig>[0];
  readonly platform?: string;
  readonly persistSnapshot: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
  readonly decision?: AgentDecisionRuntime;
}

export interface AgentSkillIntentPrimeResult {
  readonly snapshot: DeferredToolSessionSnapshot;
  readonly skill?: SkillDescriptor;
  readonly skills?: readonly SkillDescriptor[];
}

/**
 * Deterministically activates one Agent-private Skill when the current intent
 * has a unique best keyword match. Public Skills and ambiguous matches remain
 * deferred so the runtime keeps its progressive-disclosure boundary.
 */
export function primeAgentSkillForIntent(options: Readonly<{
  capabilities: Pick<AgentCapabilities, 'tools' | 'skills'>;
  sessionSnapshot: DeferredToolSessionSnapshot;
  intent: string;
  config: DeferredCapabilityPlanOptions['config'];
}>): AgentSkillIntentPrimeResult {
  const snapshot = projectSessionSnapshot(options.sessionSnapshot, options.capabilities);
  const skill = uniqueBestAgentSkill(options.capabilities.skills, options.intent);
  if (!skill) return Object.freeze({ snapshot });

  const config = resolveDeferredToolsConfig(options.config);
  const withTools = activateSkill(
    snapshot,
    skill,
    options.capabilities.tools,
    config.maxLoadedPerSession,
    new Set(config.alwaysLoadedTools),
  );
  return Object.freeze({ snapshot: withTools, skill });
}

/** Model recommendation never enlarges the immutable, already-authorized projection. */
export async function primeSkillsForIntent(options: Readonly<{
  capabilities: Pick<AgentCapabilities, 'tools' | 'skills'>;
  sessionSnapshot: DeferredToolSessionSnapshot;
  intent: string;
  config: DeferredCapabilityPlanOptions['config'];
  decision?: AgentDecisionRuntime;
  signal: AbortSignal;
}>): Promise<AgentSkillIntentPrimeResult> {
  const ranking = await rankDecisionCandidates(options.decision, 'skills', options.intent,
    options.capabilities.skills.map(skill => ({ name: skill.qualifiedName, description: skill.description })),
    options.signal);
  if (!ranking.applied) return primeAgentSkillForIntent(options);
  const maxSelections = options.decision?.config.skills?.maxSelections ?? 2;
  const skills = ranking.selectedNames.slice(0, maxSelections).flatMap(name => {
    const skill = options.capabilities.skills.find(candidate => candidate.qualifiedName === name);
    return skill ? [skill] : [];
  });
  const config = resolveDeferredToolsConfig(options.config);
  let snapshot = projectSessionSnapshot(options.sessionSnapshot, options.capabilities);
  for (const skill of [...skills].reverse()) {
    snapshot = activateSkill(
      snapshot,
      skill,
      options.capabilities.tools,
      config.maxLoadedPerSession,
      new Set(config.alwaysLoadedTools),
    );
  }
  return Object.freeze({ snapshot, skill: skills[0], skills: Object.freeze(skills) });
}

/**
 * Turn-owned deferred capability authority. It has no filesystem, registry,
 * AsyncLocalStorage, or classic Tool dependency: everything comes from the
 * immutable generation projection and the session snapshot.
 */
export function createDeferredCapabilityPlan(
  options: DeferredCapabilityPlanOptions,
): DeferredCapabilityPlan {
  if (options !== null && typeof options === 'object' && 'authority' in options) {
    throw new Error('createDeferredCapabilityPlan no longer accepts "authority"; use createWorkroomDeferredCapabilityPlan or pass an injected "ceiling"');
  }
  const config = resolveDeferredToolsConfig(options.config);
  const alwaysLoaded = new Set(config.alwaysLoadedTools);
  const projected = projectCapabilities(options.capabilities, options.ceiling);
  const executableCapabilities = projected.tools.filter(
    (tool) => (!tool.hidden || tool.placement !== undefined)
      && !DEFERRED_META_TOOL_NAMES.has(tool.name)
      && !isReservedControlToolName(tool.name),
  );
  const publicCapabilities = executableCapabilities.filter(
    (tool) => !tool.hidden
  );
  // Platform-scoped adapter tools already passed canAccess for this turn.
  // Keep them in the model tool list so QQ/social actions are not hidden behind discover.
  for (const tool of publicCapabilities) {
    if (tool.platforms?.length) alwaysLoaded.add(tool.name);
  }
  // Plugin authors may opt a tool into the resident set (#857 P1-10).
  for (const name of declaredResidentToolNames(publicCapabilities, options.config)) {
    alwaysLoaded.add(name);
  }
  const publicTools = publicCapabilities.map(capabilityAsAgentTool);
  const publicCatalog = buildToolCatalog({ tools: publicTools, alwaysLoaded });
  let snapshot = projectSessionSnapshot(options.sessionSnapshot, projected);

  const persist = async (next: DeferredToolSessionSnapshot): Promise<void> => {
    snapshot = next;
    await options.persistSnapshot(structuredClone(snapshot));
  };

  const metaCapabilities = createMetaCapabilities({
    owner: options.capabilities.owner,
    catalog: publicCatalog,
    skills: projected.skills,
    tools: executableCapabilities,
    platform: options.platform,
    topK: config.discoverTopK,
    maxLoaded: config.maxLoadedPerSession,
    pinned: alwaysLoaded,
    getSnapshot: () => snapshot,
    persist,
    decision: options.decision,
  });
  const capabilities = Object.freeze([...executableCapabilities, ...metaCapabilities]);
  const allTools = capabilities.map(capabilityAsAgentTool);
  const catalog = buildToolCatalog({ tools: allTools, alwaysLoaded });
  const publicToolNames = new Set(publicCatalog.map(item => item.name));
  const controller: DeferredCapabilityController = Object.freeze({
    loadedToolNames: () => getLoadedToolNamesFromSnapshot(snapshot),
    loadedSkillInstructions: () => loadedSkillInstructions(projected.skills, snapshot),
    loadedSkillBlocks: () => loadedSkills(projected.skills, snapshot).map(skillContextBlock),
    modelOutputBlocks: (name: string, args: unknown, text: string): TextContentBlock[] | undefined => {
      if (name !== 'load_skill') return undefined;
      const skill = resolveSkill(projected.skills, String(recordOf(args).name ?? ''));
      if (!skill) return undefined;
      const block = skillContextBlock(skill);
      const expected = skillLoadResult(skill, executableCapabilities);
      if (!text.startsWith(expected)) return undefined;
      return [block, { type: 'text', text: text.slice(block.text.length) }];
    },
    load: async (name: string) => {
      if (!publicToolNames.has(name)) return false;
      if (!alwaysLoaded.has(name)) {
        await persist(touchToolInSnapshot(snapshot, name, config.maxLoadedPerSession));
      }
      return true;
    },
  });
  const resolvedTools = resolveDeferredApiTools(
    catalog,
    alwaysLoaded,
    controller.loadedToolNames(),
  );

  return Object.freeze({
    capabilities,
    allTools: Object.freeze(allTools),
    resolvedTools: Object.freeze(resolvedTools),
    catalog: Object.freeze(catalog),
    deferredStats: buildDeferredStats(catalog, resolvedTools),
    controller,
  });
}

/**
 * Upper bound on plugin tools that may become resident through their own
 * `alwaysLoaded: true` flag in one turn. Each resident schema is sent on every
 * model call, so a misbehaving plugin set must not silently flood the context.
 * Tools past the limit stay deferred (still reachable via `discover` /
 * `load_tool`) and a warning names them once. Operators who need more can list
 * tools in `deferredTools.alwaysLoadedTools`, which this limit does not touch.
 */
export const MAX_DECLARED_RESIDENT_TOOLS = 8;

const warnedOverLimitTools = new Set<string>();

/**
 * Names of public tools whose author set `alwaysLoaded: true`, in projection
 * order and capped at {@link MAX_DECLARED_RESIDENT_TOOLS}.
 *
 * - Absent or `false` keeps the tool deferred (the default for every plugin).
 * - `deferredTools.alwaysLoadedMode: replace` means the operator's list is the
 *   complete resident set, so author declarations are ignored.
 * - Only public (non-hidden) capabilities that already passed ingress and the
 *   capability ceiling are considered; the flag never grants access.
 */
export function declaredResidentToolNames(
  tools: readonly Pick<ToolCapability, 'name' | 'alwaysLoaded'>[],
  config: DeferredCapabilityPlanOptions['config'],
): string[] {
  if (config.deferredTools?.alwaysLoadedMode === 'replace') return [];
  const declared = tools.filter(tool => tool.alwaysLoaded === true).map(tool => tool.name);
  const overLimit = declared.slice(MAX_DECLARED_RESIDENT_TOOLS)
    .filter(name => !warnedOverLimitTools.has(name));
  if (overLimit.length > 0) {
    for (const name of overLimit) warnedOverLimitTools.add(name);
    logger.warn(
      `${declared.length} plugin tools declare alwaysLoaded; only the first ${MAX_DECLARED_RESIDENT_TOOLS} are resident. `
      + `Still deferred: ${overLimit.join(', ')}. List them in ai.agent.deferredTools.alwaysLoadedTools to keep them loaded.`,
    );
  }
  return declared.slice(0, MAX_DECLARED_RESIDENT_TOOLS);
}

function projectCapabilities(
  capabilities: AgentCapabilities,
  ceiling: DeferredCapabilityCeiling | undefined,
): Readonly<Pick<AgentCapabilities, 'tools' | 'skills'>> {
  if (!ceiling) {
    return Object.freeze({
      tools: Object.freeze(capabilities.tools.filter(tool => !isReservedControlToolName(tool.name))),
      skills: capabilities.skills,
    });
  }
  const out = ceiling.project(capabilities);
  if (!out || !Array.isArray(out.tools) || !Array.isArray(out.skills)) {
    throw new Error('capability ceiling must return arrays for tools and skills');
  }
  const allowedTools = new Set<ToolCapability>(capabilities.tools);
  const allowedSkills = new Set<SkillDescriptor>(capabilities.skills);
  for (const tool of out.tools) {
    if (!allowedTools.has(tool)) {
      throw new Error(`capability ceiling returned a tool/skill that is not part of the input projection: tool "${tool?.name}"`);
    }
  }
  for (const skill of out.skills) {
    if (!allowedSkills.has(skill)) {
      throw new Error(`capability ceiling returned a tool/skill that is not part of the input projection: skill "${skill?.qualifiedName}"`);
    }
  }
  return Object.freeze(out);
}

function projectSessionSnapshot(
  snapshot: DeferredToolSessionSnapshot,
  capabilities: Readonly<Pick<AgentCapabilities, 'tools' | 'skills'>>,
): DeferredToolSessionSnapshot {
  const allowedSkills = new Set(capabilities.skills.flatMap(
    skill => [skill.qualifiedName, skill.name],
  ));
  const loadedSkills = snapshot.loadedSkills.filter(name => allowedSkills.has(name));
  const allowedTools = new Set(capabilities.tools
    .filter((tool) => !tool.hidden)
    .map((tool) => tool.name));
  const loadedSkillNames = new Set(loadedSkills);
  for (const skill of capabilities.skills) {
    if (!loadedSkillNames.has(skill.qualifiedName) && !loadedSkillNames.has(skill.name)) continue;
    for (const tool of resolveSkillTools(skill, capabilities.tools)) allowedTools.add(tool);
  }
  return {
    loadedTools: Object.fromEntries(Object.entries(snapshot.loadedTools)
      .filter(([name]) => allowedTools.has(name))),
    loadedSkills,
  };
}

export function capabilityAsAgentTool(tool: ToolCapability): AgentTool {
  const parameters = toolInputSchemaToParameters(tool.inputSchema);
  const modelParameters = structuredClone(parameters) as AgentTool['parameters'];
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    parameters: modelParameters,
    source: tool.source,
    permissions: tool.permissions,
    tags: tool.tags ? [...tool.tags] : undefined,
    keywords: tool.keywords ? [...tool.keywords] : undefined,
    requiresApproval: tool.requiresApproval,
    ...(tool.risk ? { risk: tool.risk } : {}),
    ...(tool.riskCategory ? { riskCategory: tool.riskCategory } : {}),
    execute: async () => {
      throw new Error(`AgentCore must execute capability ${tool.name} through ToolExecutionAuthority`);
    },
  });
}

interface MetaCapabilityOptions {
  readonly owner: AgentCapabilities['owner'];
  readonly catalog: readonly ToolCatalogItem[];
  readonly skills: readonly SkillDescriptor[];
  readonly tools: readonly ToolCapability[];
  readonly platform?: string;
  readonly topK: number;
  readonly maxLoaded: number;
  /** Always-loaded tools: never written to the snapshot, so they never count against `maxLoaded`. */
  readonly pinned: ReadonlySet<string>;
  readonly getSnapshot: () => DeferredToolSessionSnapshot;
  readonly persist: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
  readonly decision?: AgentDecisionRuntime;
}

function createMetaCapabilities(options: MetaCapabilityOptions): readonly ToolCapability[] {
  const byName = new Map(options.catalog.map((item) => [item.name, item]));
  return Object.freeze([
    metaCapability(options.owner, 'discover', 'Search deferred tools and skills by intent.', {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['tool', 'skill', 'all'] },
      },
    }, async (raw, invocation) => {
      const input = recordOf(raw);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const kind = input.kind === 'tool' || input.kind === 'skill' ? input.kind : 'all';
      const catalog = disclosedToolCatalog(options);
      const fallbackTools = kind === 'skill' ? [] : discoverInCatalog({
        query,
        kind: 'tool',
        topK: options.topK,
        platform: options.platform,
        skillRegistry: null,
        catalog,
      });
      const fallbackSkills = kind === 'tool' ? [] : discoverSkills(options.skills, query, options.topK);
      const [rankedTools, rankedSkills] = query ? await Promise.all([
        kind === 'skill' ? undefined : rankDecisionCandidates(options.decision, 'tools', query,
          catalog.map(item => ({ name: item.name, description: item.fullTool.description })), invocation.signal),
        kind === 'tool' ? undefined : rankDecisionCandidates(options.decision, 'skills', query,
          options.skills.map(skill => ({ name: skill.qualifiedName, description: skill.description })), invocation.signal),
      ]) : [];
      const tools = rankedTools?.applied
        ? rankedTools.selectedNames.flatMap(name => {
          const item = catalog.find(candidate => candidate.name === name);
          return item ? [{ kind: 'tool' as const, name, brief: item.brief }] : [];
        }) : fallbackTools;
      const skills = rankedSkills?.applied
        ? rankedSkills.selectedNames.flatMap(name => {
          const skill = options.skills.find(candidate => candidate.qualifiedName === name);
          return skill ? [{ kind: 'skill' as const, name, brief: skill.description }] : [];
        }) : fallbackSkills;
      const rows = [...tools, ...skills];
      return rows.length > 0
        ? rows.map((item) => `- [${item.kind}] ${item.name}: ${item.brief}`).join('\n')
        : 'No matches.';
    }),
    metaCapability(options.owner, 'load_tool', 'Load a deferred tool schema into this session.', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }, async (raw) => {
      const name = String(recordOf(raw).name ?? '');
      const item = byName.get(name);
      if (!item) return `Tool "${name}" not found in catalog.`;
      if (!options.pinned.has(name)) {
        await options.persist(touchToolInSnapshot(options.getSnapshot(), name, options.maxLoaded));
      }
      return `Loaded tool "${name}". Use its tool definition for arguments.\n__zhin_tools_mutated__`;
    }),
    metaCapability(options.owner, 'load_skill', 'Load projected skill instructions into this session.', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }, async (raw) => {
      const name = String(recordOf(raw).name ?? '');
      const skill = resolveSkill(options.skills, name);
      if (!skill) return `Skill '${name}' not found in the active generation.`;
      await options.persist(
        activateSkill(options.getSnapshot(), skill, options.tools, options.maxLoaded, options.pinned),
      );
      return skillLoadResult(skill, options.tools);
    }),
  ]);
}

function metaCapability(
  owner: AgentCapabilities['owner'],
  name: string,
  description: string,
  inputSchema: ToolInputSchema,
  execute: (input: unknown, context: ToolInvocationContext) => Promise<unknown>,
): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description,
    inputSchema,
    requiresApproval: 'never',
    source: 'builtin:agent-runtime',
    execute: <TInput = unknown, TResult = unknown>(input: TInput, context: ToolInvocationContext) =>
      execute(input, context) as Promise<TResult>,
  });
}

function discoverSkills(
  skills: readonly SkillDescriptor[],
  query: string,
  topK: number,
): Array<{ kind: 'skill'; name: string; brief: string }> {
  const needle = query.toLocaleLowerCase();
  return skills
    .filter((skill) => !needle || [
      skill.qualifiedName,
      skill.description,
      ...(skill.keywords ?? []),
      ...(skill.tags ?? []),
    ].join(' ').toLocaleLowerCase().includes(needle))
    .slice(0, topK)
    .map((skill) => ({ kind: 'skill', name: skill.qualifiedName, brief: skill.description }));
}

function resolveSkill(skills: readonly SkillDescriptor[], name: string): SkillDescriptor | undefined {
  const matches = skills.filter((skill) => skill.qualifiedName === name || skill.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function loadedSkillInstructions(
  skills: readonly SkillDescriptor[],
  snapshot: DeferredToolSessionSnapshot,
): string[] {
  return loadedSkills(skills, snapshot).map(skill => skill.instructions);
}

function loadedSkills(skills: readonly SkillDescriptor[], snapshot: DeferredToolSessionSnapshot): SkillDescriptor[] {
  const loaded = new Set(snapshot.loadedSkills);
  return skills.filter(skill => skill.always === true || loaded.has(skill.qualifiedName) || loaded.has(skill.name));
}

function skillLoadResult(skill: SkillDescriptor, tools: readonly ToolCapability[]): string {
  const names = resolveSkillTools(skill, tools);
  const unlocked = names.length ? `\nUnlocked tools: ${names.join(', ')}` : '';
  return `${skillContextBlock(skill).text}${unlocked}\n__zhin_tools_mutated__`;
}

function activateSkill(
  snapshot: DeferredToolSessionSnapshot,
  skill: SkillDescriptor,
  tools: readonly ToolCapability[],
  maxLoaded: number,
  pinned: ReadonlySet<string>,
): DeferredToolSessionSnapshot {
  const toolNames = resolveSkillTools(skill, tools).filter(name => !pinned.has(name));
  return touchToolsInSnapshot(addSkillToSnapshot(snapshot, skill.qualifiedName), toolNames, maxLoaded);
}

function disclosedToolCatalog(options: MetaCapabilityOptions): ToolCatalogItem[] {
  const loaded = new Set(getLoadedToolNamesFromSnapshot(options.getSnapshot()));
  const privateTools = options.tools.filter(tool => tool.hidden && loaded.has(tool.name));
  return [...options.catalog,
    ...buildToolCatalog({ tools: privateTools.map(capabilityAsAgentTool), alwaysLoaded: new Set<string>() })];
}

function resolveSkillTools(
  skill: SkillDescriptor,
  tools: readonly ToolCapability[],
): string[] {
  const requested = new Set(skill.toolNames ?? []);
  if (requested.size === 0) return [];
  return tools.filter((tool) => tool.owner === skill.owner
    && belongsToSkill(tool, skill) && [...requested].some(
    name => tool.name === name || tool.name.endsWith(`__${name}`),
  )).map((tool) => tool.name);
}

function belongsToSkill(tool: ToolCapability, skill: SkillDescriptor): boolean {
  const placement = tool.placement;
  if (!placement) return !tool.hidden;
  if (placement.kind === 'agent') return placement.agent === skill.agentName;
  if (placement.kind === 'skill') return !skill.agentName && placement.skill === skill.name;
  return placement.agent === skill.agentName && placement.skill === skill.name;
}

function uniqueBestAgentSkill(
  skills: readonly SkillDescriptor[],
  intent: string,
): SkillDescriptor | undefined {
  const haystack = intent.normalize('NFKC').toLocaleLowerCase().trim();
  if (!haystack) return undefined;
  const scored = skills
    .filter((skill) => skill.agentName && skill.keywords?.length)
    .map((skill) => ({ skill, score: keywordAffinity(skill.keywords ?? [], haystack) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || left.skill.qualifiedName.localeCompare(right.skill.qualifiedName));
  if (!scored[0] || scored[0].score === scored[1]?.score) return undefined;
  return scored[0].skill;
}

function keywordAffinity(keywords: readonly string[], normalizedIntent: string): number {
  let score = 0;
  for (const value of new Set(keywords)) {
    const keyword = value.normalize('NFKC').toLocaleLowerCase().trim();
    if (keyword && normalizedIntent.includes(keyword)) score += [...keyword].length;
  }
  return score;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
