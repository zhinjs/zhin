import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { residentToolNames, resolveDeferredApiTools } from '../../src/tool-catalog/tool-catalog.js';
import {
  createDeferredCapabilityPlan,
  declaredResidentToolNames,
  isReservedControlToolName,
  MAX_DECLARED_RESIDENT_TOOLS,
  primeAgentSkillForIntent,
  RESERVED_CONTROL_TOOL_PREFIX,
} from '../../src/plugin-runtime/deferred-capability-plan.js';

describe('DeferredCapabilityPlan', () => {
  const bareCapabilities = (owner: ReturnType<typeof rootPluginId>, tools: readonly ToolCapability[], skills: AgentCapabilities['skills'] = Object.freeze([])): AgentCapabilities => Object.freeze({
    generation: 1,
    owner,
    tools: Object.freeze(tools),
    skills,
    agents: Object.freeze([]),
    mcp: Object.freeze([]),
    promptSections: Object.freeze([]),
  });

  it('exposes only what an injected ceiling returns and propagates ceiling failures', () => {
    const owner = rootPluginId();
    const allowedSkill = skill(owner, 'allowed', 'Allowed workflow.');
    const capabilities = bareCapabilities(
      owner,
      [tool(owner, 'alpha', 'Alpha'), tool(owner, 'beta', 'Beta')],
      Object.freeze([allowedSkill, skill(owner, 'denied', 'Denied workflow.')]),
    );
    const base = {
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['alpha', 'beta'] } },
      persistSnapshot: async () => undefined,
    };
    const plan = createDeferredCapabilityPlan({
      ...base,
      ceiling: {
        project: (given) => ({
          tools: given.tools.filter(item => item.name === 'alpha'),
          skills: given.skills.filter(item => item.qualifiedName === 'allowed'),
        }),
      },
    });
    expect(plan.capabilities.map(item => item.name)).toContain('alpha');
    expect(plan.capabilities.map(item => item.name)).not.toContain('beta');
    expect(plan.resolvedTools.map(item => item.name)).toContain('alpha');
    expect(plan.resolvedTools.map(item => item.name)).not.toContain('beta');

    expect(() => createDeferredCapabilityPlan({
      ...base,
      ceiling: { project: () => { throw new Error('untrusted projection'); } },
    })).toThrow('untrusted projection');
  });

  it('hides reserved workroom control tools when no ceiling is injected', () => {
    const owner = rootPluginId();
    const plan = createDeferredCapabilityPlan({
      capabilities: bareCapabilities(owner, [
        tool(owner, 'weather', 'Weather'),
        tool(owner, 'workroom_transition', 'control'),
        tool(owner, 'x__workroom_create_run', 'control'),
      ]),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['weather', 'workroom_transition', 'x__workroom_create_run'] } },
      persistSnapshot: async () => undefined,
    });
    const names = plan.capabilities.map(item => item.name);
    expect(names).toContain('weather');
    expect(names).not.toContain('workroom_transition');
    expect(names).not.toContain('x__workroom_create_run');
  });

  it('exposes the reserved control prefix constant', () => {
    expect(RESERVED_CONTROL_TOOL_PREFIX).toBe('workroom_');
    expect(isReservedControlToolName('workroom_x')).toBe(true);
    expect(isReservedControlToolName('plugin__workroom_x')).toBe(true);
    expect(isReservedControlToolName('x_workroom_x')).toBe(false);
    expect(isReservedControlToolName('weather')).toBe(false);
  });

  describe('legacy authority option and ceiling validation', () => {
    const owner = rootPluginId();
    const alpha = tool(owner, 'alpha', 'Alpha');
    const beta = tool(owner, 'beta', 'Beta');
    const s1 = skill(owner, 'one', 'One.');
    const capabilities = bareCapabilities(owner, [alpha, beta], Object.freeze([s1]));
    const baseOptions = {
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['alpha', 'beta'] } },
      persistSnapshot: async () => undefined,
    };
    const planWith = (project: (given: AgentCapabilities) => unknown) => createDeferredCapabilityPlan({
      ...baseOptions,
      ceiling: { project: project as never },
    });

    it('rejects the legacy authority option (fail-closed)', () => {
      expect(() => createDeferredCapabilityPlan({ ...baseOptions, authority: { kind: 'workroom_assignment' } } as any))
        .toThrow(/authority.*createWorkroomDeferredCapabilityPlan/s);
      expect(() => createDeferredCapabilityPlan({ ...baseOptions, authority: undefined } as any))
        .toThrow(/authority/);
    });

    it('still works without authority', () => {
      expect(createDeferredCapabilityPlan(baseOptions).capabilities.map(item => item.name)).toContain('alpha');
    });

    it('rejects ceilings that return cloned or fabricated tools', () => {
      expect(() => planWith(() => ({ tools: [{ ...alpha }], skills: [] }))).toThrow(/not part of the input projection.*alpha/s);
      expect(() => planWith(() => ({ tools: [tool(owner, 'ghost', 'Ghost')], skills: [] }))).toThrow(/ghost/);
    });

    it('rejects ceilings that return extra or cloned skills', () => {
      expect(() => planWith(() => ({ tools: [], skills: [s1, skill(owner, 'extra', 'Extra.')] }))).toThrow(/extra/);
      expect(() => planWith(() => ({ tools: [], skills: [{ ...s1 }] }))).toThrow(/not part of the input projection/);
    });

    it('rejects non-array ceiling results', () => {
      expect(() => planWith(() => ({ tools: undefined, skills: [] }))).toThrow(/arrays/);
      expect(() => planWith(() => ({ tools: [], skills: undefined }))).toThrow(/arrays/);
    });

    it('accepts a strict subset of the same references', () => {
      const plan = planWith(given => ({ tools: [given.tools[0]], skills: given.skills }));
      const names = plan.capabilities.map(item => item.name);
      expect(names).toContain('alpha');
      expect(names).not.toContain('beta');
    });
  });

  it('loads projected tools and skills without a classic registry or ambient runtime', async () => {
    const owner = rootPluginId();
    const saved: import('@zhin.js/ai').DeferredToolSessionSnapshot[] = [];
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 4,
      owner,
      tools: Object.freeze([tool(owner, 'weather', 'Look up weather')]),
      skills: Object.freeze([Object.freeze({
        $feature: 'zhin.skill/1' as const,
        owner,
        name: 'research',
        qualifiedName: 'research',
        description: 'Research workflow',
        instructions: 'Verify primary sources before answering.',
        toolNames: Object.freeze(['weather']),
        source: '/skills/research/SKILL.md',
      })]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });
    const plan = createDeferredCapabilityPlan({
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['discover', 'load_tool', 'load_skill'] } },
      platform: 'sandbox',
      persistSnapshot: async (snapshot) => { saved.push(snapshot); },
    });

    // Resident tools are sorted by name so the provider tool list is stable (prompt cache).
    expect(plan.resolvedTools.map((entry) => entry.name)).toEqual([
      'discover', 'load_skill', 'load_tool',
    ]);
    await execute(plan.capabilities, 'load_tool', { name: 'weather' });
    expect(plan.controller.loadedToolNames()).toEqual(['weather']);
    await execute(plan.capabilities, 'load_skill', { name: 'research' });
    expect(plan.controller.loadedSkillInstructions()).toEqual([
      'Verify primary sources before answering.',
    ]);
    expect(plan.controller.loadedToolNames()).toEqual(['weather']);
    expect(saved).toHaveLength(2);
  });

  it('never unlocks a Skill tool that was filtered out of the Turn projection', async () => {
    const owner = rootPluginId();
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze([tool(owner, 'read_public', 'Read public data')]),
        skills: Object.freeze([Object.freeze({
          ...skill(owner, 'admin', 'Administrative workflow.'),
          toolNames: Object.freeze(['read_public', 'delete_account']),
        })]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
        promptSections: Object.freeze([]),
      }),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: {} },
      persistSnapshot: async () => undefined,
    });

    await execute(plan.capabilities, 'load_skill', { name: 'admin' });
    expect(plan.controller.loadedToolNames()).toEqual(['read_public']);
  });

  it('always loads platform-scoped plugin tools that already passed ingress', () => {
    const owner = rootPluginId();
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze([
          tool(owner, 'weather', 'Look up weather'),
          Object.freeze({
            ...tool(owner, 'icqq__send_user_like', '给用户点赞'),
            platforms: Object.freeze(['icqq']),
          }),
        ]),
        skills: Object.freeze([]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
      }),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['discover', 'load_tool', 'load_skill'] } },
      persistSnapshot: async () => undefined,
    });

    expect(plan.resolvedTools.map((entry) => entry.name)).toEqual([
      'discover', 'icqq__send_user_like', 'load_skill', 'load_tool',
    ]);
  });

  describe('author-declared resident plugin tools (#857 P1-10)', () => {
    const META = ['discover', 'load_tool', 'load_skill'];
    const residentTool = (owner: ReturnType<typeof rootPluginId>, name: string, extra: Partial<ToolCapability> = {}) =>
      Object.freeze({ ...tool(owner, name, name), alwaysLoaded: true, ...extra }) as ToolCapability;
    const planFor = (
      tools: readonly ToolCapability[],
      deferredTools: Record<string, unknown> = { alwaysLoadedTools: META },
    ) => createDeferredCapabilityPlan({
      capabilities: bareCapabilities(rootPluginId(), tools),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools },
      persistSnapshot: async () => undefined,
    });

    it('keeps plugin tools deferred by default', () => {
      const owner = rootPluginId();
      const plan = planFor([tool(owner, 'weather', 'Weather'), Object.freeze({ ...tool(owner, 'news', 'News'), alwaysLoaded: false })]);
      expect(plan.resolvedTools.map(entry => entry.name)).toEqual([...META].sort());
      expect(plan.catalog.find(item => item.name === 'weather')?.deferDefault).toBe(true);
      expect(plan.catalog.find(item => item.name === 'news')?.deferDefault).toBe(true);
    });

    it('makes opted-in tools resident without counting them against the session budget', async () => {
      const owner = rootPluginId();
      const plan = planFor([tool(owner, 'weather', 'Weather'), residentTool(owner, 'translate')]);
      expect(plan.resolvedTools.map(entry => entry.name)).toEqual([...META, 'translate'].sort());
      expect(plan.catalog.find(item => item.name === 'translate')?.deferDefault).toBe(false);
      await execute(plan.capabilities, 'load_tool', { name: 'translate' });
      expect(plan.controller.loadedToolNames()).toEqual([]);
    });

    it('lets the operator replace mode override author declarations', () => {
      const owner = rootPluginId();
      const plan = planFor([residentTool(owner, 'translate')], { alwaysLoadedTools: META, alwaysLoadedMode: 'replace' });
      expect(plan.resolvedTools.map(entry => entry.name)).toEqual([...META].sort());
    });

    it('never makes a hidden tool resident', () => {
      const owner = rootPluginId();
      const plan = planFor([residentTool(owner, 'internal_lookup', { hidden: true })]);
      expect(plan.resolvedTools.map(entry => entry.name)).not.toContain('internal_lookup');
      expect(plan.catalog.map(entry => entry.name)).not.toContain('internal_lookup');
    });

    it('caps declared resident tools and leaves the rest deferred', () => {
      const owner = rootPluginId();
      const names = Array.from({ length: MAX_DECLARED_RESIDENT_TOOLS + 2 }, (_, index) => `tool_${index}`);
      const plan = planFor(names.map(name => residentTool(owner, name)));
      const resolved = plan.resolvedTools.map(entry => entry.name);
      expect(resolved).toEqual([...META, ...names.slice(0, MAX_DECLARED_RESIDENT_TOOLS)].sort());
      expect(plan.catalog.map(entry => entry.name)).toEqual(expect.arrayContaining(names));
      expect(declaredResidentToolNames(names.map(name => ({ name, alwaysLoaded: true })), {}))
        .toHaveLength(MAX_DECLARED_RESIDENT_TOOLS);
    });

    it('keeps pinned tools resident when the turn rebuilds its tool list after load_tool', async () => {
      const owner = rootPluginId();
      const plan = planFor([
        tool(owner, 'weather', 'Weather'),
        residentTool(owner, 'translate'),
        Object.freeze({ ...tool(owner, 'icqq__poke', 'Poke'), platforms: Object.freeze(['icqq']) }),
      ]);
      await execute(plan.capabilities, 'load_tool', { name: 'weather' });
      // Mirrors AgentCore's mid-turn rebuild: config names alone would drop the pinned tools.
      const resident = residentToolNames(plan.catalog, new Set(META));
      const rebuilt = resolveDeferredApiTools([...plan.catalog], resident, plan.controller.loadedToolNames());
      expect(rebuilt.map(entry => entry.name)).toEqual(expect.arrayContaining(['translate', 'icqq__poke', 'weather']));
      expect(resolveDeferredApiTools([...plan.catalog], new Set(META), plan.controller.loadedToolNames())
        .map(entry => entry.name)).not.toContain('translate');
    });
  });

  it('keeps hidden capabilities callable internally but out of model catalogs', () => {
    const owner = rootPluginId();
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze([Object.freeze({
          ...tool(owner, 'internal_lookup', 'Internal lookup'),
          hidden: true,
        })]),
        skills: Object.freeze([]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
        promptSections: Object.freeze([]),
      }),
      sessionSnapshot: { loadedTools: { internal_lookup: 1 }, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['internal_lookup'] } },
      persistSnapshot: async () => undefined,
    });

    expect(plan.allTools.map((entry) => entry.name)).not.toContain('internal_lookup');
    expect(plan.catalog.map((entry) => entry.name)).not.toContain('internal_lookup');
    expect(plan.controller.loadedToolNames()).toEqual([]);
  });

  it('unlocks a Skill-private Tool only through its owning Skill', async () => {
    const owner = rootPluginId();
    const privateName = 'skill__research__search';
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze([Object.freeze({
          ...tool(owner, privateName, 'Private research search'),
          hidden: true,
          placement: Object.freeze({ kind: 'skill' as const, skill: 'research' }),
        })]),
        skills: Object.freeze([Object.freeze({
          ...skill(owner, 'research', 'Research with private sources.'),
          toolNames: Object.freeze([privateName]),
        })]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
        promptSections: Object.freeze([]),
      }),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: {} },
      persistSnapshot: async () => undefined,
    });

    expect(plan.allTools.map((entry) => entry.name)).toContain(privateName);
    await expect(execute(plan.capabilities, 'load_tool', { name: privateName }))
      .resolves.toContain('not found in catalog');
    await expect(execute(plan.capabilities, 'discover', { query: 'research', kind: 'tool' }))
      .resolves.toBe('No matches.');
    await execute(plan.capabilities, 'load_skill', { name: 'research' });
    expect(plan.controller.loadedToolNames()).toEqual([privateName]);
  });

  it('primes the uniquely matching Agent-private Skill from the turn intent', () => {
    const owner = rootPluginId();
    const muteTool = 'icqq__agent__icqq__skill__icqq-group-admin__set_mute';
    const listMutedTool = 'icqq__agent__icqq__skill__icqq-group-state__list_muted';
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 1,
      owner,
      tools: Object.freeze([
        Object.freeze({
          ...tool(owner, muteTool, 'Mute one group member'),
          hidden: true,
          placement: Object.freeze({
            kind: 'agent-skill' as const,
            agent: 'icqq',
            skill: 'icqq-group-admin',
          }),
        }),
        Object.freeze({
          ...tool(owner, listMutedTool, 'List muted group members'),
          hidden: true,
          placement: Object.freeze({
            kind: 'agent-skill' as const,
            agent: 'icqq',
            skill: 'icqq-group-state',
          }),
        }),
      ]),
      skills: Object.freeze([
        Object.freeze({
          ...skill(owner, 'icqq-group-admin', 'Administer an ICQQ group.'),
          qualifiedName: 'icqq__agent__icqq__icqq-group-admin',
          agentName: 'icqq',
          keywords: Object.freeze(['icqq', '禁言', '踢人']),
          toolNames: Object.freeze(['set_mute']),
        }),
        Object.freeze({
          ...skill(owner, 'icqq-group-state', 'Inspect ICQQ group state.'),
          qualifiedName: 'icqq__agent__icqq__icqq-group-state',
          agentName: 'icqq',
          keywords: Object.freeze(['icqq', '禁言列表']),
          toolNames: Object.freeze(['list_muted']),
        }),
      ]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });

    const primed = primeAgentSkillForIntent({
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      intent: '请把 1830837693 禁言 1800 秒',
      config: { deferredTools: {} },
    });
    expect(primed.skill?.name).toBe('icqq-group-admin');
    expect(primed.snapshot.loadedSkills).toEqual([
      'icqq__agent__icqq__icqq-group-admin',
    ]);
    expect(Object.keys(primed.snapshot.loadedTools)).toEqual([muteTool]);

    const plan = createDeferredCapabilityPlan({
      capabilities,
      sessionSnapshot: primed.snapshot,
      config: { deferredTools: {} },
      persistSnapshot: async () => undefined,
    });
    expect(plan.resolvedTools.map((entry) => entry.name)).toContain(muteTool);
    expect(plan.resolvedTools.map((entry) => entry.name)).not.toContain(listMutedTool);
    expect(plan.controller.loadedSkillInstructions()).toEqual(['Administer an ICQQ group.']);
  });

  it('does not prime an Agent-private Skill when keyword affinity is ambiguous', () => {
    const owner = rootPluginId();
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 1,
      owner,
      tools: Object.freeze([]),
      skills: Object.freeze([
        Object.freeze({
          ...skill(owner, 'directory', 'Directory'),
          agentName: 'icqq',
          keywords: Object.freeze(['icqq']),
        }),
        Object.freeze({
          ...skill(owner, 'admin', 'Admin'),
          agentName: 'icqq',
          keywords: Object.freeze(['icqq']),
        }),
      ]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
      promptSections: Object.freeze([]),
    });

    const primed = primeAgentSkillForIntent({
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      intent: 'icqq',
      config: { deferredTools: {} },
    });
    expect(primed.skill).toBeUndefined();
    expect(primed.snapshot).toEqual({ loadedTools: {}, loadedSkills: [] });
  });

  it('fails closed on ambiguous or missing projected skills', async () => {
    const owner = rootPluginId();
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze([]),
        skills: Object.freeze([]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
      }),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: {} },
      persistSnapshot: async () => undefined,
    });

    await expect(execute(plan.capabilities, 'load_skill', { name: 'missing' }))
      .resolves.toContain("Skill 'missing' not found");
    expect(plan.controller.loadedSkillInstructions()).toEqual([]);
  });

  it('keeps every Workroom writer and projector capability out of ordinary chat', async () => {
    const owner = rootPluginId();
    const forbidden = [
      'workroom_claim_task',
      'plugin__workroom_advance_clock',
      'workroom_accept_task',
      'plugin__workroom_lease_recovery',
      'workroom_projector_apply',
    ];
    const plan = createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 7,
        owner,
        tools: Object.freeze([
          tool(owner, 'spawn_task', 'Spawn a chat-only subtask'),
          tool(owner, 'workroomish_helper', 'Ordinary domain tool with a similar word'),
          ...forbidden.map(name => tool(owner, name, name)),
        ]),
        skills: Object.freeze([]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
      }),
      sessionSnapshot: {
        loadedTools: Object.fromEntries(forbidden.map((name, index) => [name, index + 1])),
        loadedSkills: [],
      },
      config: { deferredTools: { alwaysLoadedTools: ['spawn_task', ...forbidden] } },
      persistSnapshot: async () => undefined,
    });

    expect(plan.allTools.map(entry => entry.name)).toContain('spawn_task');
    expect(plan.allTools.map(entry => entry.name)).toContain('workroomish_helper');
    expect(plan.allTools.map(entry => entry.name)).not.toEqual(expect.arrayContaining(forbidden));
    const discovery = String(await execute(
      plan.capabilities,
      'discover',
      { query: 'workroom', kind: 'tool' },
    ));
    expect(discovery).toContain('workroomish_helper');
    for (const name of forbidden) expect(discovery).not.toContain(name);
    await expect(execute(plan.capabilities, 'load_tool', { name: forbidden[0] }))
      .resolves.toContain('not found in catalog');
  });

});

function tool(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  description: string,
): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description,
    requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  });
}

function skill(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  instructions: string,
) {
  return Object.freeze({
    $feature: 'zhin.skill/1' as const,
    owner,
    name,
    qualifiedName: name,
    description: name,
    instructions,
    source: `/skills/${name}/SKILL.md`,
  });
}

async function execute(
  tools: readonly ToolCapability[],
  name: string,
  input: unknown,
): Promise<unknown> {
  const capability = tools.find((entry) => entry.name === name);
  if (!capability) throw new Error(`missing ${name}`);
  return capability.execute(input, invocation());
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

describe('DeferredCapabilityPlan core workspace tools', () => {
  function planFor(
    toolNames: readonly string[],
    options: {
      snapshot?: import('@zhin.js/ai').DeferredToolSessionSnapshot;
      maxLoadedPerSession?: number;
      saved?: import('@zhin.js/ai').DeferredToolSessionSnapshot[];
    } = {},
  ) {
    const owner = rootPluginId();
    return createDeferredCapabilityPlan({
      capabilities: Object.freeze({
        generation: 1,
        owner,
        tools: Object.freeze(toolNames.map(name => tool(owner, name, `${name} tool`))),
        skills: Object.freeze([]),
        agents: Object.freeze([]),
        mcp: Object.freeze([]),
        promptSections: Object.freeze([]),
      }),
      sessionSnapshot: options.snapshot ?? { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { maxLoadedPerSession: options.maxLoadedPerSession } },
      platform: 'sandbox',
      persistSnapshot: async (snapshot) => { options.saved?.push(snapshot); },
    });
  }

  it('exposes the core file tools by default, but only those the turn was given', () => {
    const plan = planFor(['read_file', 'grep', 'weather']);
    const names = plan.resolvedTools.map(entry => entry.name);

    expect(names).toEqual(expect.arrayContaining(['read_file', 'grep']));
    expect(names).not.toContain('weather');
    // write_file is a core tool, but this turn was not allowed to have it.
    expect(names).not.toContain('write_file');
  });

  it('load() refuses tools outside the turn projection', async () => {
    const plan = planFor(['read_file', 'weather']);

    expect(await plan.controller.load('weather')).toBe(true);
    expect(plan.controller.loadedToolNames()).toEqual(['weather']);
    expect(await plan.controller.load('write_file')).toBe(false);
    expect(await plan.controller.load('no_such_tool')).toBe(false);
  });

  it('pinned tools never enter the snapshot, so the load cap cannot evict them', async () => {
    const saved: import('@zhin.js/ai').DeferredToolSessionSnapshot[] = [];
    const plan = planFor(['read_file', 'a', 'b', 'c'], { maxLoadedPerSession: 2, saved });

    await execute(plan.capabilities, 'load_tool', { name: 'read_file' });
    for (const name of ['a', 'b', 'c']) await plan.controller.load(name);

    expect(plan.controller.loadedToolNames()).not.toContain('read_file');
    expect(plan.controller.loadedToolNames()).toHaveLength(2);

    const nextTurn = planFor(['read_file', 'a', 'b', 'c'], { snapshot: saved.at(-1), maxLoadedPerSession: 2 });
    expect(nextTurn.resolvedTools.map(entry => entry.name)).toContain('read_file');
  });
});
