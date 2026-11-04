import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { DeferredToolSessionSnapshot } from '@zhin.js/ai';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import {
  createDeferredCapabilityPlan,
  DISCOVER_SCHEMA_LIMIT,
  type DeferredCapabilityPlan,
} from '../../src/plugin-runtime/deferred-capability-plan.js';
import { resolveToolTier } from '../../src/plugin-runtime/tool-tier.js';
import { createMissingToolResolver } from '../../src/core/missing-tool-resolver.js';
import { buildLlmToolsForProvider } from '../../src/tool/deferred-resolution.js';
import { residentToolNames, resolveDeferredApiTools } from '../../src/tool-catalog/tool-catalog.js';
import { DEFERRED_META_TOOL_NAMES, type ToolTier } from '../../src/tool-catalog/types.js';

const owner = rootPluginId();

const DEV = ['read_file', 'write_file', 'edit_file', 'grep', 'glob', 'list_dir', 'bash'];
const CHAT = ['memory_search', 'conversation_info', 'pick_sticker'];
const OTHER = ['group_kick', 'set_reminder', 'group_announcement', 'weather'];

function tool(name: string, description = `${name} tool`): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description,
    inputSchema: {
      type: 'object',
      properties: { arg: { type: 'string', description: `SCHEMA-OF-${name}` } },
      required: ['arg'],
    },
    requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  } as ToolCapability);
}

function planFor(options: {
  tier?: ToolTier;
  tools?: readonly string[];
  descriptions?: Record<string, string>;
  config?: Parameters<typeof createDeferredCapabilityPlan>[0]['config'];
  snapshot?: DeferredToolSessionSnapshot;
  saved?: DeferredToolSessionSnapshot[];
  ceilingDeny?: readonly string[];
} = {}): DeferredCapabilityPlan {
  const names = options.tools ?? [...DEV, ...CHAT, ...OTHER];
  return createDeferredCapabilityPlan({
    capabilities: Object.freeze({
      generation: 1,
      owner,
      tools: Object.freeze(names.map(name => tool(name, options.descriptions?.[name]))),
      skills: Object.freeze([]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    }),
    ...(options.ceilingDeny ? {
      ceiling: {
        project: (given) => ({
          tools: given.tools.filter(item => !options.ceilingDeny!.includes(item.name)),
          skills: given.skills,
        }),
      },
    } : {}),
    sessionSnapshot: options.snapshot ?? { loadedTools: {}, loadedSkills: [] },
    config: options.config ?? { deferredTools: {} },
    toolTier: options.tier,
    persistSnapshot: async (snapshot) => { options.saved?.push(snapshot); },
  });
}

function invocation(): ToolInvocationContext {
  return Object.freeze({
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
  });
}

async function run(plan: DeferredCapabilityPlan, name: string, input: unknown): Promise<string> {
  const capability = plan.capabilities.find(entry => entry.name === name);
  if (!capability) throw new Error(`missing ${name}`);
  return String(await capability.execute(input, invocation()));
}

const resolvedNames = (plan: DeferredCapabilityPlan) => plan.resolvedTools.map(entry => entry.name);

describe('resolveToolTier', () => {
  const imTurn = (scope: string, roles: string[]) => ({
    origin: { kind: 'im', scope },
    principal: { roles },
  });

  it('picks the tier from scene and role', () => {
    expect(resolveToolTier(imTurn('group', ['user']))).toBe('chat');
    expect(resolveToolTier(imTurn('channel', ['user']))).toBe('chat');
    expect(resolveToolTier(imTurn('private', ['user']))).toBe('chat');
    expect(resolveToolTier(imTurn('private', ['user', 'trusted']))).toBe('chat');
    expect(resolveToolTier(imTurn('private', ['master']))).toBe('master');
  });

  it('keeps the dev tier out of group chats even for a master', () => {
    expect(resolveToolTier(imTurn('group', ['master']))).toBe('chat');
  });

  it('leaves non-IM origins on the full default set', () => {
    expect(resolveToolTier({ origin: { kind: 'schedule' }, principal: { roles: ['master'] } })).toBe('full');
  });
});

describe('tool tiers', () => {
  it('chat tier loads chat essentials only: no dev tools, no unrelated tools', () => {
    const names = resolvedNames(planFor({ tier: 'chat' }));
    expect(names).toEqual(expect.arrayContaining([...CHAT, 'discover', 'load_tool', 'load_skill']));
    for (const name of [...DEV, ...OTHER, 'spawn_task', 'ask_user']) expect(names).not.toContain(name);
  });

  it('master tier adds the dev tools', () => {
    const names = resolvedNames(planFor({ tier: 'master', tools: [...DEV, ...CHAT, ...OTHER, 'spawn_task', 'ask_user'] }));
    expect(names).toEqual(expect.arrayContaining([...DEV, ...CHAT, 'spawn_task', 'ask_user']));
    for (const name of OTHER) expect(names).not.toContain(name);
  });

  it('no tier keeps the previous default set', () => {
    const names = resolvedNames(planFor({ tools: [...DEV.filter(n => n !== 'bash'), ...OTHER, 'spawn_task'] }));
    expect(names).toEqual(expect.arrayContaining(['read_file', 'grep', 'spawn_task']));
  });

  it('keeps tier-excluded tools in the authorized deferred catalog', () => {
    const plan = planFor({ tier: 'chat' });
    const deferred = plan.catalog.filter(item => item.deferDefault).map(item => item.name);
    expect(deferred).toEqual(expect.arrayContaining([...DEV, ...OTHER]));
  });

  it('alwaysLoadedTools still adds on top of the tier', () => {
    const names = resolvedNames(planFor({ tier: 'chat', config: { deferredTools: { alwaysLoadedTools: ['read_file', 'weather'] } } }));
    expect(names).toEqual(expect.arrayContaining(['read_file', 'weather', ...CHAT]));
    expect(names).not.toContain('bash');
  });

  it('alwaysLoadedMode replace makes the configured list the whole resident set', () => {
    const names = resolvedNames(planFor({
      tier: 'master',
      config: { deferredTools: { alwaysLoadedMode: 'replace', alwaysLoadedTools: ['weather', 'discover'] } },
    }));
    expect(names.sort()).toEqual(['discover', 'weather']);
  });

  it('the tool list an agent run rebuilds stays tiered (resident set derives from the catalog)', async () => {
    const plan = planFor({ tier: 'chat' });
    await plan.controller.load('group_kick');
    const resident = residentToolNames(plan.catalog, DEFERRED_META_TOOL_NAMES);
    const rebuilt = resolveDeferredApiTools([...plan.catalog], resident, plan.controller.loadedToolNames())
      .map(entry => entry.name);
    expect(rebuilt).toContain('group_kick');
    expect(rebuilt).toContain('memory_search');
    expect(rebuilt).toContain('discover');
    expect(rebuilt).not.toContain('read_file');
    expect(rebuilt).not.toContain('bash');
  });
});

describe('discover-and-call: auto-load by exact name', () => {
  function resolverFor(plan: DeferredCapabilityPlan) {
    return createMissingToolResolver({
      catalog: plan.catalog,
      load: name => plan.controller.load(name),
      rebuild: () => resolveDeferredApiTools(
        [...plan.catalog],
        residentToolNames(plan.catalog, DEFERRED_META_TOOL_NAMES),
        plan.controller.loadedToolNames(),
      ),
    })!;
  }

  it('loads an authorized deferred tool called by name and keeps it for the session', async () => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const plan = planFor({ tier: 'chat', saved });
    const resolve = resolverFor(plan);

    expect((await resolve('group_kick'))?.name).toBe('group_kick');
    expect(plan.controller.loadedToolNames()).toContain('group_kick');
    // Next turn restores it from the persisted snapshot.
    const next = planFor({ tier: 'chat', snapshot: saved.at(-1) });
    expect(resolvedNames(next)).toContain('group_kick');
  });

  it('an unauthorized or unknown name stays unknown and nothing is persisted', async () => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const plan = planFor({ tier: 'chat', saved, ceilingDeny: ['group_kick'] });
    const resolve = resolverFor(plan);

    expect(await resolve('group_kick')).toBeUndefined();
    expect(await resolve('no_such_tool')).toBeUndefined();
    expect(await resolve('workroom_transition')).toBeUndefined();
    expect(saved).toEqual([]);
    // Same answer for "does not exist" and "exists but not authorized": no existence leak.
    expect(plan.catalog.map(item => item.name)).not.toContain('group_kick');
  });

  it('respects maxLoadedPerSession', async () => {
    const plan = planFor({ tier: 'chat', config: { deferredTools: { maxLoadedPerSession: 2 } } });
    const resolve = resolverFor(plan);
    for (const name of ['group_kick', 'set_reminder', 'weather']) await resolve(name);
    expect(plan.controller.loadedToolNames()).toHaveLength(2);
    expect(plan.controller.loadedToolNames()).toContain('weather');
  });
});

describe('discover loads schemas without duplicating them in results', () => {
  const descriptions = {
    group_kick: 'Kick a member out of the group.',
    set_reminder: 'Set a reminder at a time.',
    group_announcement: 'Publish a group announcement.',
    weather: 'Look up the weather.',
  };

  it.each(['openai', 'anthropic', 'google'])('loads full schemas in the %s tool list and flags the refresh without echoing them', async (sdk) => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const plan = planFor({ tier: 'chat', descriptions, saved });
    const out = await run(plan, 'discover', { query: 'kick member group', kind: 'tool' });

    expect(out).toContain('group_kick');
    expect(out).toContain('Loaded: group_kick');
    expect(out).not.toContain('SCHEMA-OF-');
    expect(out).not.toContain('"parameters"');
    expect(out).toContain('__zhin_tools_mutated__');
    expect(plan.controller.loadedToolNames()).toContain('group_kick');
    // The tool list for the next model call includes them.
    const next = planFor({ tier: 'chat', descriptions, snapshot: saved.at(-1) });
    expect(resolvedNames(next)).toContain('group_kick');
    const definitions = buildLlmToolsForProvider(sdk, [...next.catalog], next.resolvedTools,
      residentToolNames(next.catalog, DEFERRED_META_TOOL_NAMES), next.controller.loadedToolNames());
    const loaded = definitions.filter(entry => entry.name === 'group_kick');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].inputJsonSchema).toEqual(tool('group_kick').inputSchema);
    expect(loaded[0].deferLoading).not.toBe(true);
  });

  it('loads the best few matches, preserving ranking and the limit', async () => {
    const plan = planFor({
      tier: 'chat',
      tools: [...CHAT, 'a_tool', 'b_tool', 'c_tool', 'd_tool', 'e_tool'],
      descriptions: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(l => [`${l}_tool`, 'handles shared widget requests'])),
    });
    const out = await run(plan, 'discover', { query: 'widget', kind: 'tool' });
    expect(out).not.toContain('SCHEMA-OF-');
    expect(plan.controller.loadedToolNames()).toEqual(['a_tool', 'b_tool', 'c_tool']);
    expect(plan.controller.loadedToolNames()).toHaveLength(DISCOVER_SCHEMA_LIMIT);
    expect(out).toContain('Loaded: a_tool, b_tool, c_tool.');
  });

  it('does not reload tools that are already resident or loaded', async () => {
    const plan = planFor({ tier: 'chat', descriptions });
    await run(plan, 'discover', { query: 'kick member group', kind: 'tool' });
    const again = await run(plan, 'discover', { query: 'kick member group', kind: 'tool' });
    expect(again).toContain('group_kick');
    expect(again).not.toContain('SCHEMA-OF-group_kick');
    expect(again).not.toContain('__zhin_tools_mutated__');
  });

  it('never reveals or loads tools outside the authorized catalog', async () => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const plan = planFor({ tier: 'chat', descriptions, saved, ceilingDeny: ['group_kick'] });
    const out = await run(plan, 'discover', { query: 'kick member group', kind: 'tool' });
    expect(out).not.toContain('group_kick');
    expect(plan.controller.loadedToolNames()).not.toContain('group_kick');
  });

  it('respects maxLoadedPerSession when discovering', async () => {
    const plan = planFor({
      tier: 'chat',
      tools: [...CHAT, 'a_tool', 'b_tool', 'c_tool'],
      descriptions: Object.fromEntries(['a', 'b', 'c'].map(l => [`${l}_tool`, 'handles shared widget requests'])),
      config: { deferredTools: { maxLoadedPerSession: 1 } },
    });
    await run(plan, 'discover', { query: 'widget', kind: 'tool' });
    expect(plan.controller.loadedToolNames()).toHaveLength(1);
  });
});

describe('stable tool list (prompt-cache prefix)', () => {
  const view = (entry: { name: string; description?: string; parameters?: unknown }) =>
    JSON.stringify({ name: entry.name, description: entry.description, parameters: entry.parameters });
  const serialized = (plan: DeferredCapabilityPlan) => resolveDeferredApiTools(
    [...plan.catalog],
    residentToolNames(plan.catalog, DEFERRED_META_TOOL_NAMES),
    plan.controller.loadedToolNames(),
  ).map(view);

  it('is byte-identical across calls and turns when nothing new loads, and the first call matches later rebuilds', () => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const turn1 = planFor({ tier: 'chat', saved });
    const first = turn1.resolvedTools.map(view);
    expect(serialized(turn1)).toEqual(first);
    expect(serialized(turn1)).toEqual(first);

    const turn2 = planFor({ tier: 'chat', snapshot: saved.at(-1) });
    expect(serialized(turn2)).toEqual(first);
  });

  it('a newly loaded tool only appends, in first-load order, within and across turns', async () => {
    const saved: DeferredToolSessionSnapshot[] = [];
    const turn1 = planFor({ tier: 'chat', saved });
    const base = serialized(turn1);

    await turn1.controller.load('weather');
    const afterWeather = serialized(turn1);
    expect(afterWeather.slice(0, base.length)).toEqual(base);
    expect(afterWeather).toHaveLength(base.length + 1);

    // group_kick sorts before weather, but it was loaded later, so it appends.
    await turn1.controller.load('group_kick');
    const afterKick = serialized(turn1);
    expect(afterKick.slice(0, afterWeather.length)).toEqual(afterWeather);
    expect(afterKick.at(-1)).toContain('"group_kick"');

    // Re-touching an already loaded tool never reorders.
    await turn1.controller.load('weather');
    expect(serialized(turn1)).toEqual(afterKick);

    const turn2 = planFor({ tier: 'chat', snapshot: saved.at(-1) });
    expect(serialized(turn2)).toEqual(afterKick);
  });

  it('discover-loaded tools append as well', async () => {
    const plan = planFor({ tier: 'chat', descriptions: { group_kick: 'Kick a member out of the group.' } });
    const base = serialized(plan);
    await run(plan, 'discover', { query: 'kick member group', kind: 'tool' });
    const after = serialized(plan);
    expect(after.slice(0, base.length)).toEqual(base);
    expect(after.length).toBeGreaterThan(base.length);
  });
});
