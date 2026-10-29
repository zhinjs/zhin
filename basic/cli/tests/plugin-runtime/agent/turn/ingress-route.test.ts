import { RuntimeMessage } from '../../../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { MessageDispatcher } from '../../../../../../packages/im/core/src/plugin-runtime/im/message-dispatcher.js';
import { RuntimeInteractionCoordinator } from '../../../../../../packages/im/core/src/plugin-runtime/im/interaction-runtime.js';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentCapabilities, AgentDecisionRuntime } from '@zhin.js/agent/runtime';
import type { TurnRequest } from '@zhin.js/agent';
import type { Message } from '@zhin.js/core/runtime';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
import { AgentTurnIngressRoute, auditStaleReply, mergedMemberAccess, mergedTurnSenders, selectDecisionAgentRoute } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';

/** A declared profile (not a legacy-derived one): group scene lookups are usable, private ones are not. */
const sceneProfile = { group: { scene: { groupInfo: true, memberProfile: true } } };

describe('AgentTurnIngressRoute', () => {
  function roleIngress() {
    const endpoint = { id: 'root\u0000zhin.adapter\u0000icqq', adapter: 'icqq' };
    const conversation = { endpoint, kind: 'group' as const, id: '100' };
    let completeLookup!: (value: { canModerate: boolean; platformRole: 'admin' }) => void;
    const inspectGroupMember = vi.fn(() => new Promise<{ canModerate: boolean; platformRole: 'admin' }>(resolve => { completeLookup = resolve; }));
    const snapshot = {
      root: rootPluginId(), resources: new Map(), tree: new Map(), capabilities: new Map(),
      projections: new Map([[adapterFeatureId, {
        $projection: 'zhin.adapter-index/1', capabilityProfile: () => sceneProfile, connection: () => ({ selfUserId: '8596238', management: { inspectGroupMember } }),
      }]]),
    } as unknown as RuntimeSnapshot;
    const read = vi.fn().mockResolvedValue({ agents: [], tools: [] });
    const executeLeased = vi.fn().mockResolvedValue({ status: 'completed', output: [] });
    const reply = vi.fn().mockResolvedValue({ status: 'sent' });
    const message = { conversation, content: '#hello', endpointId: 'configured-bot', sender: { id: 'sender' }, $reply: reply } as Message;
    const retirement = new AbortController();
    const route = new AgentTurnIngressRoute({
      projectRoot: process.cwd(), runtime: { executeLeased } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }) } as never,
      ingress: { read } as never,
      agent: { service: {
        getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'fixture', model: 'fixture' }) }),
        getTriggerConfig: () => ({ enabled: true }), getAgentConfig: () => ({}),
      }, agent: {} } as never,
    });
    return { read, executeLeased, inspectGroupMember, retirement, reply,
      run: () => route.route(message, { value: snapshot, active: true, retirementSignal: retirement.signal } as never, rootPluginId(), undefined),
      resolve: () => completeLookup({ canModerate: false, platformRole: 'admin' }),
    };
  }

  it('queries the Bot role before capability disclosure and reuses that turn snapshot', async () => {
    const f = roleIngress(); const running = f.run();
    await vi.waitFor(() => expect(f.inspectGroupMember).toHaveBeenCalledOnce());
    expect(f.read).not.toHaveBeenCalled();
    expect(f.executeLeased).not.toHaveBeenCalled();
    f.resolve();
    await running;

    expect(f.read).toHaveBeenCalledOnce();
    const access = f.read.mock.calls[0]![3] as TurnRequest;
    const request = f.executeLeased.mock.calls[0]![2] as TurnRequest;
    expect(access.input.contextState).toEqual({ bot: { id: '8596238', platformRole: 'admin' } });
    expect(request.input.contextState).toBe(access.input.contextState);
    expect(f.inspectGroupMember).toHaveBeenCalledOnce();
  });

  it('does not disclose capabilities or run a model after the role lookup is cancelled', async () => {
    const f = roleIngress(); const running = f.run();
    await vi.waitFor(() => expect(f.inspectGroupMember).toHaveBeenCalledOnce());
    f.retirement.abort(new Error('generation retired'));
    f.resolve();
    await running;

    expect(f.read).not.toHaveBeenCalled();
    expect(f.executeLeased).not.toHaveBeenCalled();
  });

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
      projections: new Map([[adapterFeatureId, {
        $projection: 'zhin.adapter-index/1', capabilityProfile: () => ({}),
        connection: (adapter: string, id: string) => adapter === endpoint.id && id === endpoint.id
          ? { selfUserId: 'actual-platform-account' }
          : undefined,
      }]]),
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
    expect(request.input.contextState).toEqual({ bot: { id: 'actual-platform-account' } });
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


function localizedIngress(options: { prefix?: string; locale?: 'zh-CN' | 'en'; text: string; enabled?: boolean; errorTemplate?: string;
  execute?: (request: TurnRequest) => Promise<unknown> }) {
  const endpoint = { adapter: 'root', id: 'root\u0000zhin.adapter\u0000fixture' };
  const conversation = { endpoint, kind: 'private' as const, id: 'user' };
  const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
  const dispatcher = new MessageDispatcher(() => options.prefix!);
  const coordinator = new RuntimeInteractionCoordinator();
  const reply = vi.fn(async (content: unknown) => {
    if (JSON.stringify(content).includes('Confirm operation')) {
      expect(coordinator.resolveClaim({ ...message, content: 'yes', segments: [] } as never)).toBe(true);
    }
    return { status: 'sent' as const };
  });
  const message = new RuntimeMessage(conversation, options.text, 1, reply, { id: 'user' }, {}, [], undefined,
    'bot', false, undefined, undefined, 'fixture', { locale: options.locale,
      ...(options.prefix === undefined ? {} : { resolveCommands: value => dispatcher.commandEnvironment(value, snapshot) }) });
  const listModels = vi.fn(async () => [{ provider: 'fixture', models: ['fixture-model'] }]);
  const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) =>
    options.execute ? options.execute(request) : { status: 'completed', output: [] });
  const route = new AgentTurnIngressRoute({
    projectRoot: process.cwd(), runtime: { executeLeased } as never, resolveEndpointOwner: () => 'user',
    im: { createInteraction: (source: Message) => coordinator.create(source) } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: { listModels,
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'fixture', model: 'fixture' }) }),
      getTriggerConfig: () => ({ enabled: options.enabled ?? false, masters: ['user'], errorTemplate: options.errorTemplate }),
      getAgentConfig: () => ({ execApprovalMode: 'ask' }),
    }, agent: {} } as never,
  });
  return { run: () => route.route(message, { value: snapshot, active: true } as never, rootPluginId(), undefined), reply, listModels, executeLeased };
}

it.each(['!', '', '/'])('reads the real dispatcher prefix %j at the Agent management ingress', async prefix => {
  const en = localizedIngress({ prefix, locale: 'en', text: `${prefix}models` });
  const zh = localizedIngress({ prefix, text: `${prefix}models` });
  await Promise.all([en.run(), zh.run()]);
  expect(en.reply).toHaveBeenCalledWith(expect.stringContaining('Available models'));
  expect(zh.reply).toHaveBeenCalledWith(expect.stringContaining('可用模型'));
  expect(en.executeLeased).not.toHaveBeenCalled();
  const namespaced = localizedIngress({ prefix, locale: 'en', text: `${prefix}plugin/models` });
  expect(await namespaced.run()).toBe(false);
  expect(namespaced.listModels).not.toHaveBeenCalled();
});

it('does not invent a prefix for an API message with no command environment', async () => {
  const api = localizedIngress({ locale: 'en', text: '/models' });
  expect(await api.run()).toBe(false);
  expect(api.listModels).not.toHaveBeenCalled();
});

it('passes captured ingress locale into a real pending human approval', async () => {
  const flow = localizedIngress({ prefix: '!', locale: 'en', text: 'hello', enabled: true,
    execute: async request => {
      const result = await request.ports.approval!.requestApprovalOutcome!({ requestId: 'approval', question: 'Custom question', humanOnly: true, timeoutMs: 1000 });
      expect(result).toMatchObject({ status: 'approved' });
      return { status: 'completed', output: [] };
    },
  });
  expect(await flow.run()).toBe(true);
  expect(JSON.stringify(flow.reply.mock.calls)).toContain('Confirm operation');
});

it('localizes the ingress error fallback and preserves a configured template', async () => {
  const en = localizedIngress({ prefix: '!', locale: 'en', text: 'hello', enabled: true,
    execute: async () => { throw new Error('custom upstream detail'); } });
  expect(await en.run()).toBe(true);
  expect(JSON.stringify(en.reply.mock.calls)).toContain('(custom upstream detail)');
  expect(JSON.stringify(en.reply.mock.calls)).not.toMatch(/[\u3400-\u9fff]/u);
  const custom = localizedIngress({ prefix: '!', locale: 'en', text: 'hello', enabled: true, errorTemplate: '原配置: {error}',
    execute: async () => { throw new Error('upstream'); } });
  await custom.run();
  expect(custom.reply).toHaveBeenCalledWith('原配置: upstream');
});

it('falls back to the anonymous user floor for a merged participant without access (ADR 0038 §2)', () => {
  const carrier = {
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1' },
    principal: { subjectId: 'alice', roles: ['admin', 'user'] },
    policy: { permissions: ['admin', 'user'], unattended: false },
  } as any;
  const bob = { ...carrier, principal: { subjectId: 'bob', roles: ['user'] } };
  const members = mergedMemberAccess([
    { senderId: 'alice', access: carrier },
    { senderId: 'bob', access: bob },
    { senderId: 'carol' },
  ], carrier);
  expect(members[0]).toBe(carrier);
  expect(members[1]).toBe(bob);
  expect(members[2]).toMatchObject({
    origin: carrier.origin,
    principal: { subjectId: 'carol', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false },
  });
});

it('turns merged participants into the turn context sender list (ADR 0038 §3)', () => {
  expect(mergedTurnSenders([
    { senderId: 'alice', senderName: 'Alice', texts: ['a', 'a2'], messageIds: ['m1', 'm3'] },
    { senderId: 'bob', texts: ['b'] },
  ])).toEqual([
    { subjectId: 'alice', displayName: 'Alice', messageIds: ['m1', 'm3'], texts: ['a', 'a2'] },
    { subjectId: 'bob', texts: ['b'] },
  ]);
});

it('audits a dropped stale reply and one sent anyway (ADR 0038 §4)', () => {
  const audit = vi.fn();
  auditStaleReply(audit, { kind: 'discard', senders: ['alice'] });
  auditStaleReply(audit, { kind: 'send', senders: ['bob'], reason: 'starvation' });
  expect(audit.mock.calls.map(([event]) => event)).toEqual([
    { kind: 'outbound', outcome: 'skip', reasonCode: 'merge_reply_stale_discarded', payload: { senders: ['alice'] } },
    { kind: 'outbound', outcome: 'allow', reasonCode: 'merge_reply_stale_sent', payload: { senders: ['bob'], reason: 'starvation' } },
  ]);
});
