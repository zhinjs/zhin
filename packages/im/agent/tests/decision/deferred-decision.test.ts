import type { DecisionProvider, DecisionQuestions, DecisionRequest, DecisionResult } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan, primeSkillsForIntent } from '../../src/plugin-runtime/deferred-capability-plan.js';
import type { AgentDecisionRuntime } from '../../src/decision/types.js';

const owner = rootPluginId();
function capabilities(): AgentCapabilities {
  return {
    generation: 1, owner, agents: [], mcp: [], promptSections: [],
    tools: ['admin', 'inspect', 'unrelated'].map(name => ({
      owner, name: `${name}__action`, qualifiedName: `${name}__action`,
      description: `${name} private action`, inputSchema: { type: 'object' }, source: '/tools/action/index.ts',
      hidden: true, placement: { kind: 'agent-skill' as const, agent: 'icqq', skill: name },
      execute: async () => undefined,
    } as ToolCapability)),
    skills: ['admin', 'inspect', 'unrelated'].map(name => ({
      $feature: 'zhin.skill/1' as const, owner, name, qualifiedName: name,
      description: `${name} workflow`, instructions: `${name} SECRET instructions`,
      toolNames: ['action'], agentName: 'icqq', keywords: name === 'admin' ? ['禁言'] : [],
      source: `/agents/icqq/skills/${name}/SKILL.md`,
    })),
  };
}

function decision(mode: 'off' | 'shadow' | 'active', relevance: number = 0.95): AgentDecisionRuntime {
  const provider: DecisionProvider = {
    async evaluate<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      const state = request.state as { candidates: Record<string, { name: string }> };
      return { model: 'jev-fixed', usage: { inputTokens: 1, outputTokens: 1 },
        answers: Object.fromEntries(Object.keys(request.questions).map(key => [key,
          { type: 'score', score: state.candidates[key]!.name === 'unrelated' ? 0.1 : relevance,
            confidence: 0.9, legend: {}, probabilities: {} },
        ])) } as DecisionResult<Q>;
    },
  };
  return { provider, config: { provider: 'root/typesafe', skills: { mode, maxSelections: 2 }, tools: { mode } } };
}

const invocation: ToolInvocationContext = {
  signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'session',
  origin: { kind: 'internal', source: 'test' }, principal: { subjectId: 'user', roles: ['admin'] },
  policy: { permissions: ['admin'], unattended: false, network: { enabled: false } },
};

describe('decision-driven deferred capabilities', () => {
  it('activates multiple relevant Skills and only their private Tools under the existing cap', async () => {
    const primed = await primeSkillsForIntent({ capabilities: capabilities(),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] }, intent: 'restrict a member and inspect the result',
      config: { deferredTools: { maxLoadedPerSession: 1 } }, decision: decision('active'), signal: invocation.signal });
    expect(primed.skills?.map(skill => skill.name)).toEqual(['admin', 'inspect']);
    expect(Object.keys(primed.snapshot.loadedTools)).toEqual(['admin__action']);
    expect(primed.snapshot.loadedSkills).not.toContain('unrelated');
  });

  it('preserves deterministic priming in shadow/off/failure, but honors active abstention', async () => {
    const options = { capabilities: capabilities(), sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      intent: '禁言这个成员', config: { deferredTools: {} }, signal: invocation.signal };
    expect((await primeSkillsForIntent({ ...options, decision: decision('off') })).skill?.name).toBe('admin');
    expect((await primeSkillsForIntent({ ...options, decision: decision('shadow') })).skill?.name).toBe('admin');
    expect((await primeSkillsForIntent({ ...options, decision: decision('active', 0.1) })).skill).toBeUndefined();
    expect((await primeSkillsForIntent({ ...options, decision: {
      ...decision('active'), provider: { evaluate: async () => { throw new Error('network'); } },
    } })).skill?.name).toBe('admin');
  });

  it('discloses private Tool descriptors only after its Skill is loaded, and sends no instructions', async () => {
    const runtime = decision('active');
    const evaluate = vi.spyOn(runtime.provider, 'evaluate');
    const plan = createDeferredCapabilityPlan({ capabilities: capabilities(),
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] }, config: { deferredTools: {} },
      decision: runtime, persistSnapshot: async () => undefined });
    const call = (name: string, input: unknown) => plan.capabilities.find(tool => tool.name === name)!.execute(input, invocation);
    expect(await call('discover', { query: 'mute', kind: 'tool' })).toBe('No matches.');
    expect(evaluate).not.toHaveBeenCalled();
    await call('discover', { query: 'restrict', kind: 'skill' });
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('SECRET');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('private action');
    await call('load_skill', { name: 'admin' });
    expect(plan.controller.loadedToolNames()).toEqual(['admin__action']);
    expect(await call('discover', { query: 'member', kind: 'tool' })).toContain('admin__action');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('inspect private action');
  });
});
