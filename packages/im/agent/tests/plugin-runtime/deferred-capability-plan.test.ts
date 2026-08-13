import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';

describe('DeferredCapabilityPlan', () => {
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
        source: '/agent/skills/research.md',
      })]),
      agents: Object.freeze([]),
      mcp: Object.freeze([]),
    });
    const plan = createDeferredCapabilityPlan({
      capabilities,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['discover', 'load_tool', 'load_skill'] } },
      platform: 'sandbox',
      persistSnapshot: async (snapshot) => { saved.push(snapshot); },
    });

    expect(plan.resolvedTools.map((entry) => entry.name)).toEqual([
      'discover', 'load_tool', 'load_skill',
    ]);
    await execute(plan.capabilities, 'load_tool', { name: 'weather' });
    expect(plan.controller.loadedToolNames()).toEqual(['weather']);
    await execute(plan.capabilities, 'load_skill', { name: 'research' });
    expect(plan.controller.loadedSkillInstructions()).toEqual([
      'Verify primary sources before answering.',
    ]);
    expect(saved).toHaveLength(2);
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
    approval: 'never',
    source: `/agent/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
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
