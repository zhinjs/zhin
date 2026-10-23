import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentCapabilities, AgentDecisionRuntime } from '@zhin.js/agent/runtime';
import type { TurnRequest } from '@zhin.js/agent';
import type { Message } from '@zhin.js/core/runtime';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { AgentTurnIngressRoute, selectDecisionAgentRoute } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';

describe('AgentTurnIngressRoute', () => {
  it.each([
    { source: 'group', target: undefined, messageId: undefined, share: true, reaction: false },
    { source: 'channel', target: undefined, messageId: undefined, share: true, reaction: false },
    { source: 'group', target: undefined, messageId: 'm1', share: true, reaction: true },
    { source: 'private', target: 'group', messageId: 'm1', share: true, reaction: false },
    { source: 'group', target: 'channel', messageId: 'm1', share: true, reaction: false },
    { source: 'group', target: 'private', messageId: 'm1', share: false, reaction: false },
  ] as const)('discloses target-scoped segments independently of reaction eligibility: %j', async scenario => {
    const endpoint = { id: 'root\u0000zhin.adapter\u0000test', adapter: 'root' };
    const conversation = { endpoint, kind: scenario.source, id: 'source' };
    const reply = vi.fn().mockResolvedValue({ status: 'sent' });
    const message = {
      conversation, content: '#hello', endpointId: 'bot', sender: { id: 'sender' },
      ...(scenario.messageId ? { message: { conversation, id: scenario.messageId } } : {}),
      $reply: reply,
    } as Message;
    const snapshot = {
      root: rootPluginId(), resources: new Map(), tree: new Map(),
      capabilities: new Map([[endpoint.id, { definition: { segments: {
        supported: ['text', 'share'],
        model: { share: { scopes: ['group', 'channel'], hint: 'Use the room share card.' } },
        reaction: { scopes: ['group', 'channel'], values: [{ value: '76', label: '赞' }] },
      } } }]]),
    } as unknown as RuntimeSnapshot;
    const executeLeased = vi.fn().mockResolvedValue({ status: 'completed', output: [] });
    const binding = { name: 'zhin', providerAlias: 'test', model: 'test' };
    const route = new AgentTurnIngressRoute({
      projectRoot: process.cwd(),
      runtime: { executeLeased } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }) } as never,
      ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
      agent: {
        service: {
          getBindingRegistry: () => ({ requireZhinBinding: () => binding }),
          getTriggerConfig: () => ({ enabled: true }),
          getAgentConfig: () => ({}),
        },
        agent: {},
      } as never,
      ...(scenario.target ? { workroom: {
        preRoute: async () => false,
        hasAgentTurn: () => true,
        takeAgentTurn: () => ({ projectId: 'p', proposalId: 'case', space: 'workroom', agentDefinitionId: 'zhin' }),
        resolveOrchestratorConversation: async () => ({ endpoint, kind: scenario.target!, id: 'target' }),
      } } : {}),
    });

    await route.route(message, { value: snapshot, active: true } as never, rootPluginId(), undefined);

    expect(reply).not.toHaveBeenCalled();
    expect(executeLeased).toHaveBeenCalledOnce();
    const request = executeLeased.mock.calls[0]![2] as TurnRequest;
    const profile = request.ports.reply!.segments!;
    expect(profile.types.includes('share')).toBe(scenario.share);
    expect(profile.extensions?.share?.hint).toBe(scenario.share ? 'Use the room share card.' : undefined);
    expect(profile.reaction).toEqual(scenario.reaction ? { values: [{ value: '76', label: '赞' }] } : undefined);
  });

  it('adapts the durable Workroom pre-route through the IngressRoute interface', async () => {
    const preRoute = vi.fn().mockResolvedValue(true);
    const route = new AgentTurnIngressRoute({
      projectRoot: process.cwd(),
      runtime: {} as never,
      im: {} as never,
      ingress: {} as never,
      agent: {} as never,
      workroom: { preRoute } as never,
    });
    const message = {} as never;

    await expect(route.preRoute(message, {} as never, {} as never, 42)).resolves.toBe(true);
    expect(preRoute).toHaveBeenCalledWith(message, 42);
  });

  it('behaves as a no-op Workroom pre-route when Workroom is not installed', async () => {
    const route = new AgentTurnIngressRoute({
      projectRoot: process.cwd(),
      runtime: {} as never,
      im: {} as never,
      ingress: {} as never,
      agent: {} as never,
    });
    const message = {} as never;

    await expect(route.preRoute(message, {} as never, {} as never, 1)).resolves.toBe(false);
    expect(route.shouldRouteBeforeDispatch(message)).toBe(false);
  });

  it('selects a visible specialist only when no deterministic Agent was selected', async () => {
    const specialist = agent('reminders');
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue({
      model: 'jev-test', usage: { inputTokens: 1, outputTokens: 1 },
      answers: { candidate_0: { type: 'score', score: 0.95, confidence: 0.99, legend: { 0: 'irrelevant', 1: 'relevant' }, probabilities: { 0: 0.05, 1: 0.95 } } },
    });
    const decisionRuntime: AgentDecisionRuntime = {
      provider: { evaluate }, config: { provider: '/typesafe', agents: { mode: 'active' } },
    };
    const selection = await selectDecisionAgentRoute({
      routed: { userText: 'Remind me tomorrow' }, capabilities: { agents: [specialist] },
      decisionRuntime, workroomTurn: false, signal: new AbortController().signal,
    });
    expect(selection.agent).toBe(specialist);
    expect(evaluate.mock.calls[0]![0].state).toMatchObject({ candidates: { candidate_0: { name: specialist.qualifiedName } } });
  });

  it.each(['platform', 'workroom', 'explicit'])('preserves %s routing without consulting Jev', async (kind) => {
    const specialist = agent('qq');
    const evaluate = vi.fn<DecisionProvider['evaluate']>();
    const routed = kind === 'platform' ? { userText: 'request', agent: specialist }
      : { userText: kind === 'explicit' ? '@zhin request' : 'request' };
    await expect(selectDecisionAgentRoute({
      routed, capabilities: { agents: [specialist] },
      decisionRuntime: { provider: { evaluate }, config: { provider: '/typesafe', agents: { mode: 'active' } } },
      workroomTurn: kind === 'workroom', signal: new AbortController().signal,
    })).resolves.toBe(routed);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps the current default when the active selector abstains', async () => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue({
      model: 'jev-test', usage: { inputTokens: 1, outputTokens: 1 },
      answers: { candidate_0: { type: 'score', score: 0.01, confidence: 0.99, legend: { 0: 'irrelevant', 1: 'relevant' }, probabilities: { 0: 0.99, 1: 0.01 } } },
    });
    const routed = { userText: 'hello' };
    await expect(selectDecisionAgentRoute({
      routed, capabilities: { agents: [agent('reminders')] },
      decisionRuntime: { provider: { evaluate }, config: { provider: '/typesafe', agents: { mode: 'active' } } },
      workroomTurn: false, signal: new AbortController().signal,
    })).resolves.toBe(routed);
  });
});

function agent(name: string): AgentCapabilities['agents'][number] {
  return {
    $feature: 'zhin.agent/1', name, displayName: name, version: '1.0.0',
    description: `Specialist ${name}`, triggerRules: { filePatterns: [], keywords: [] },
    entryPoints: ['system.md', 'boundaries.md', 'conventions.md'], instructions: 'Specialist rules',
    workflows: [], knowledge: [], owner: rootPluginId(), qualifiedName: `root:${name}`,
    source: `agents/${name}/agent.json`,
  };
}
