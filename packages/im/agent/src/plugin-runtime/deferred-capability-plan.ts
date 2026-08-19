import {
  addSkillToSnapshot,
  getLoadedToolNamesFromSnapshot,
  touchToolInSnapshot,
  type AgentTool,
  type DeferredToolSessionSnapshot,
} from '@zhin.js/ai';
import { toolInputSchemaToParameters } from '@zhin.js/core/tool-zod';
import type { SkillDescriptor } from '@zhin.js/skill';
import type { ToolInvocationContext } from '@zhin.js/tool';
import { buildDeferredStats, buildToolCatalog, discoverInCatalog, resolveDeferredApiTools } from '../tool-catalog/tool-catalog.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import { DEFERRED_META_TOOL_NAMES, type ToolCatalogItem } from '../tool-catalog/types.js';
import type { AgentCapabilities, ToolCapability } from './capability-ingress.js';

export interface DeferredCapabilityController {
  loadedToolNames(): string[];
  loadedSkillInstructions(): string[];
}

export interface DeferredCapabilityPlan {
  readonly capabilities: readonly ToolCapability[];
  readonly allTools: readonly AgentTool[];
  readonly resolvedTools: readonly AgentTool[];
  readonly catalog: readonly ToolCatalogItem[];
  readonly deferredStats: string;
  readonly controller: DeferredCapabilityController;
}

export interface DeferredCapabilityPlanOptions {
  readonly capabilities: AgentCapabilities;
  readonly sessionSnapshot: DeferredToolSessionSnapshot;
  readonly config: Parameters<typeof resolveDeferredToolsConfig>[0];
  readonly platform?: string;
  readonly persistSnapshot: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
}

/**
 * Turn-owned deferred capability authority. It has no filesystem, registry,
 * AsyncLocalStorage, or classic Tool dependency: everything comes from the
 * immutable generation projection and the session snapshot.
 */
export function createDeferredCapabilityPlan(
  options: DeferredCapabilityPlanOptions,
): DeferredCapabilityPlan {
  const config = resolveDeferredToolsConfig(options.config);
  const alwaysLoaded = new Set(config.alwaysLoadedTools);
  const baseCapabilities = options.capabilities.tools.filter(
    (tool) => !DEFERRED_META_TOOL_NAMES.has(tool.name),
  );
  // Platform-scoped adapter tools already passed canAccess for this turn.
  // Keep them in the model tool list so QQ/social actions are not hidden behind discover.
  for (const tool of baseCapabilities) {
    if (tool.platforms?.length) alwaysLoaded.add(tool.name);
  }
  const baseTools = baseCapabilities.map(capabilityAsAgentTool);
  const baseCatalog = buildToolCatalog({ tools: baseTools, alwaysLoaded });
  let snapshot = structuredClone(options.sessionSnapshot);

  const persist = async (next: DeferredToolSessionSnapshot): Promise<void> => {
    snapshot = next;
    await options.persistSnapshot(structuredClone(snapshot));
  };

  const metaCapabilities = createMetaCapabilities({
    owner: options.capabilities.owner,
    catalog: baseCatalog,
    skills: options.capabilities.skills,
    platform: options.platform,
    topK: config.discoverTopK,
    maxLoaded: config.maxLoadedPerSession,
    getSnapshot: () => snapshot,
    persist,
  });
  const capabilities = Object.freeze([...baseCapabilities, ...metaCapabilities]);
  const allTools = capabilities.map(capabilityAsAgentTool);
  const catalog = buildToolCatalog({ tools: allTools, alwaysLoaded });
  const controller: DeferredCapabilityController = Object.freeze({
    loadedToolNames: () => getLoadedToolNamesFromSnapshot(snapshot),
    loadedSkillInstructions: () => loadedSkillInstructions(options.capabilities.skills, snapshot),
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

export function capabilityAsAgentTool(tool: ToolCapability): AgentTool {
  const parameters = toolInputSchemaToParameters(tool.inputSchema);
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: parameters.properties ?? {},
      ...(parameters.required?.length ? { required: parameters.required } : {}),
    },
    source: tool.source,
    permissions: tool.permissions,
    approval: tool.approval,
    execute: async () => {
      throw new Error(`AgentCore must execute capability ${tool.name} through ToolExecutionAuthority`);
    },
  });
}

interface MetaCapabilityOptions {
  readonly owner: AgentCapabilities['owner'];
  readonly catalog: readonly ToolCatalogItem[];
  readonly skills: readonly SkillDescriptor[];
  readonly platform?: string;
  readonly topK: number;
  readonly maxLoaded: number;
  readonly getSnapshot: () => DeferredToolSessionSnapshot;
  readonly persist: (snapshot: DeferredToolSessionSnapshot) => Promise<void>;
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
    }, async (raw) => {
      const input = recordOf(raw);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const kind = input.kind === 'tool' || input.kind === 'skill' ? input.kind : 'all';
      const tools = kind === 'skill' ? [] : discoverInCatalog({
        query,
        kind: 'tool',
        topK: options.topK,
        platform: options.platform,
        skillRegistry: null,
        catalog: [...options.catalog],
      });
      const skills = kind === 'tool' ? [] : discoverSkills(options.skills, query, options.topK);
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
      await options.persist(touchToolInSnapshot(options.getSnapshot(), name, options.maxLoaded));
      return `Loaded tool "${name}".\nParameters schema:\n${JSON.stringify(item.fullTool.parameters, null, 2)}\n__zhin_tools_mutated__`;
    }),
    metaCapability(options.owner, 'load_skill', 'Load projected skill instructions into this session.', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }, async (raw) => {
      const name = String(recordOf(raw).name ?? '');
      const skill = resolveSkill(options.skills, name);
      if (!skill) return `Skill '${name}' not found in the active generation.`;
      await options.persist(addSkillToSnapshot(options.getSnapshot(), skill.qualifiedName));
      return `${skill.instructions}\n__zhin_tools_mutated__`;
    }),
  ]);
}

function metaCapability(
  owner: AgentCapabilities['owner'],
  name: string,
  description: string,
  inputSchema: unknown,
  execute: (input: unknown, context: ToolInvocationContext) => Promise<unknown>,
): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description,
    inputSchema,
    approval: 'never',
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
    .filter((skill) => !needle || `${skill.qualifiedName} ${skill.description}`.toLocaleLowerCase().includes(needle))
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
  const loaded = new Set(snapshot.loadedSkills);
  return skills
    .filter((skill) => loaded.has(skill.qualifiedName) || loaded.has(skill.name))
    .map((skill) => skill.instructions);
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
