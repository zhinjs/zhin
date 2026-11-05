import { assistantTextReply } from '../../../../../../packages/im/agent/tests/helpers/mock-llm-api.js';
import { ingressInferenceFixture } from './inference-fixture.js';
import { RuntimeMessage } from '../../../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { MessageDispatcher } from '../../../../../../packages/im/core/src/plugin-runtime/im/message-dispatcher.js';
import { RuntimeInteractionCoordinator } from '../../../../../../packages/im/core/src/plugin-runtime/im/interaction-runtime.js';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentCapabilities, AgentDecisionRuntime } from '@zhin.js/agent/runtime';
import { AiControlPlane, DecisionEventLog, requestApprovalOutcome, type TurnRequest } from '@zhin.js/agent';
import { HostMailbox } from '@zhin.js/agent/turn';
import type { CoreReplyStream, Message, OpenReplyStreamOptions } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore, type ConversationEvent, type ConversationRef } from '@zhin.js/im-contract';
import { ConversationRuntime } from '../../../../../../packages/im/core/src/plugin-runtime/im/conversation-runtime.js';
import { rootPluginId, SnapshotStore, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
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
        $projection: 'zhin.adapter-index/1', capabilityProfile: () => sceneProfile, connection: () => ({ identity: endpoint, selfUserId: '8596238' }), management: () => ({ inspectGroupMember }),
      }]]),
    } as unknown as RuntimeSnapshot;
    const read = vi.fn().mockResolvedValue({ agents: [], tools: [] });
    const executeLeased = vi.fn().mockResolvedValue({ status: 'completed', output: [] });
    const reply = vi.fn().mockResolvedValue({ status: 'sent' });
    const message = new RuntimeMessage(
      {
        conversation: conversation,
        content: '#hello',
        sender: { id: 'sender' },
        metadata: {},
        segments: [],
        endpointId: 'configured-bot',
      },
      { generation: 1, reply: reply },
    );
    const snapshots = new SnapshotStore(snapshot);
    const inference = ingressInferenceFixture();
    const route = new AgentTurnIngressRoute({
      withInferenceScope: inference.withInferenceScope,
      projectRoot: process.cwd(), runtime: { executeLeased } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }) } as never,
      ingress: { read } as never,
      agent: { service: {
        getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
        getTriggerConfig: () => ({ enabled: true }), getAgentConfig: () => ({}),
      }, agent: {} } as never,
    });
    return { read, executeLeased, inspectGroupMember, snapshots, reply, inference,
      run: async () => {
        const lease = snapshots.acquire();
        try { return await route.route(message, lease, rootPluginId(), undefined); }
        finally { lease.release(); }
      },
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
    const access = (f.read.mock.calls[0]![0] as { turn: TurnRequest }).turn;
    const request = f.executeLeased.mock.calls[0]![2] as TurnRequest;
    expect(access.input.contextState).toEqual({ bot: { id: '8596238', platformRole: 'admin' } });
    expect(request.input.contextState).toBe(access.input.contextState);
    expect(f.inspectGroupMember).toHaveBeenCalledOnce();
    expect(f.inference.closed).toBe(1);
    expect(f.inference.generations).toEqual([(f.read.mock.calls[0]![0] as { snapshot: RuntimeSnapshot }).snapshot]);
  });

  it('continues the admitted turn on its leased snapshot after an unrelated HMR commit', async () => {
    const f = roleIngress(); const running = f.run();
    await vi.waitFor(() => expect(f.inspectGroupMember).toHaveBeenCalledOnce());
    f.snapshots.commit(0, { snapshot: f.snapshots.current, dispose: () => undefined });
    f.resolve();
    await running;
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.executeLeased).toHaveBeenCalledOnce();
    await f.snapshots.close();
  });

  it('does not disclose capabilities or run a model after explicit Root stop cancels the role lookup', async () => {
    const f = roleIngress(); const running = f.run();
    await vi.waitFor(() => expect(f.inspectGroupMember).toHaveBeenCalledOnce());
    const stopping = f.snapshots.close();
    f.resolve();
    await running;

    expect(f.read).not.toHaveBeenCalled();
    expect(f.executeLeased).not.toHaveBeenCalled();
    expect(f.inference.generations).toEqual([]);
    await stopping;
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
    const message = new RuntimeMessage(
      {
        conversation: conversation,
        content: '#hello',
        sender: { id: 'sender' },
        metadata: {},
        segments: [],
        message: scenario.messageId ? { conversation, id: scenario.messageId } : undefined,
        endpointId: 'bot',
      },
      { generation: 1, reply: reply },
    );
    const snapshot = {
      root: rootPluginId(), resources: new Map(), tree: new Map(),
      projections: new Map([[adapterFeatureId, {
        $projection: 'zhin.adapter-index/1', capabilityProfile: () => ({}),
        connection: (adapter: string, id: string) => adapter === endpoint.id && id === endpoint.id
          ? { identity: endpoint, selfUserId: 'actual-platform-account' }
          : undefined,
      }]]),
      capabilities: new Map([[endpoint.id, { definition: { segments: {
        supported: ['text', 'share'],
        model: { share: { scopes: ['group', 'channel'], hint: 'Use the room share card.' } },
        reaction: { scopes: ['group', 'channel'], values: [{ value: '76', label: '赞' }] },
      } } }]]),
    } as unknown as RuntimeSnapshot;
    const executeLeased = vi.fn().mockResolvedValue({ status: 'completed', output: [] });
    const binding = { name: 'zhin', mcpServers: [] };
    const route = new AgentTurnIngressRoute({
      withInferenceScope: ingressInferenceFixture().withInferenceScope,
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
    const { provider, evaluate } = decisionFixture();
    evaluate.mockResolvedValue({
      model: 'jev-test', usage: { inputTokens: 1, outputTokens: 1 },
      answers: { candidate_0: { type: 'score', score: 0.95, confidence: 0.99, legend: { 0: 'irrelevant', 1: 'relevant' }, probabilities: { 0: 0.05, 1: 0.95 } } },
    });
    const decisionRuntime: AgentDecisionRuntime = {
      forTask: task => task === 'agents' ? provider : undefined, config: { agents: { profile: 'decision', mode: 'active' } },
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
    const { provider, evaluate } = decisionFixture();
    const routed = kind === 'platform' ? { userText: 'request', agent: specialist }
      : { userText: kind === 'explicit' ? '@zhin request' : 'request' };
    await expect(selectDecisionAgentRoute({
      routed, capabilities: { agents: [specialist] },
      decisionRuntime: { forTask: task => task === 'agents' ? provider : undefined, config: { agents: { profile: 'decision', mode: 'active' } } },
      workroomTurn: kind === 'workroom', signal: new AbortController().signal,
    })).resolves.toBe(routed);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps the current default when the active selector abstains', async () => {
    const { provider, evaluate } = decisionFixture();
    evaluate.mockResolvedValue({
      model: 'jev-test', usage: { inputTokens: 1, outputTokens: 1 },
      answers: { candidate_0: { type: 'score', score: 0.01, confidence: 0.99, legend: { 0: 'irrelevant', 1: 'relevant' }, probabilities: { 0: 0.99, 1: 0.01 } } },
    });
    const routed = { userText: 'hello' };
    await expect(selectDecisionAgentRoute({
      routed, capabilities: { agents: [agent('reminders')] },
      decisionRuntime: { forTask: task => task === 'agents' ? provider : undefined, config: { agents: { profile: 'decision', mode: 'active' } } },
      workroomTurn: false, signal: new AbortController().signal,
    })).resolves.toBe(routed);
  });
});

function decisionFixture() {
  const provider: DecisionProvider = { async evaluate() { throw new Error('Unexpected synthetic decision request'); } };
  return { provider, evaluate: vi.spyOn(provider, 'evaluate') };
}

function agent(name: string): AgentCapabilities['agents'][number] {
  return {
    $feature: 'zhin.agent/1', name, displayName: name, version: '1.0.0',
    description: `Specialist ${name}`, triggerRules: { filePatterns: [], keywords: [] },
    entryPoints: ['system.md', 'boundaries.md', 'conventions.md'], instructions: 'Specialist rules',
    workflows: [], knowledge: [], owner: rootPluginId(), qualifiedName: `root:${name}`,
    source: `agents/${name}/agent.json`,
  };
}

function progressiveIngress(options: {
  supported?: boolean;
  portAbsent?: boolean;
  expectExecutionError?: boolean;
  execute(request: TurnRequest, flow: ReturnType<typeof progressiveFacts>): Promise<unknown>;
}) {
  const flow = progressiveFacts();
  let executionError: unknown;
  const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) => {
    try { return await options.execute(request, flow); }
    catch (error) { executionError = error; throw error; }
  });
  const route = new AgentTurnIngressRoute({
    withInferenceScope: ingressInferenceFixture().withInferenceScope,
    projectRoot: '/synthetic/allowed-workspace', runtime: { executeLeased } as never,
    im: { createInteraction: () => ({ ask: vi.fn() }), endpoints: { captureOperation: flow.captureOperation } } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: {
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
      getTriggerConfig: () => ({ enabled: true }), getAgentConfig: () => ({ mailbox: { merge: { enabled: false } } }),
      imageAssets: { ownsUrl: flow.ownsUrl },
    }, agent: { getControlPlane: () => flow.control } } as never,
  });
  if (options.supported === false) flow.openReplyStream.mockReturnValue(undefined);
  if (options.portAbsent) flow.captureOperation.mockReturnValue({ release: flow.release });
  return { ...flow, executeLeased,
    async run() {
      try {
        const result = await route.route(flow.message, { value: flow.snapshot, active: true } as never, rootPluginId(), undefined);
        // The production ingress handles engine errors; assertions inside the fake engine must still fail this test.
        if (executionError && !options.expectExecutionError) throw executionError;
        expect(flow.profileRelease).toHaveBeenCalledOnce();
        return result;
      }
      finally { route.dispose(); }
    },
  };
}

function progressiveFacts() {
  const conversation = { endpoint: { adapter: 'sandbox', id: 'root\u0000zhin.adapter\u0000sandbox' }, kind: 'private' as const, id: 'user' };
  class NativeEvent { readonly team_id = 'trusted-team'; nativeMethod() { return 'sdk'; } }
  const event = new NativeEvent(), client = { native: 'exact-client-instance' };
  const control = new AiControlPlane();
  const controller = new AbortController();
  const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
  const messageRef = { conversation, id: 'native-message' };
  const reply = vi.fn(async () => ({ status: 'sent' as const, message: { conversation, id: 'ordinary-reply' } }));
  const message = new RuntimeMessage({ conversation, content: '#hello', sender: { id: 'sender' }, message: messageRef,
    metadata: { event: { team_id: 'forged-team' }, client: { native: 'forged-client' } }, segments: [], endpointId: 'bot',
  }, { generation: 1, reply, client: () => client, clientAdapter: 'sandbox',
    session: { adapterName: 'sandbox', adapter: {} as never, endpoint: client as never, scene: conversation,
      sender: { id: 'sender' }, message: { ref: messageRef, id: messageRef.id, text: '#hello', receivedAt: 1 },
      event, signal: controller.signal },
  });
  const receipt = { status: 'sent' as const, message: { conversation, id: 'progressive-reply' } };
  const native: CoreReplyStream = { receipt, confirmed: [{ key: 'one', message: receipt.message, segments: [{ type: 'text', data: { text: 'answer' } }] }],
    update: vi.fn(), finish: vi.fn(async () => receipt), cancel: vi.fn(async () => receipt) };
  const openReplyStream = vi.fn((_options: OpenReplyStreamOptions): CoreReplyStream | undefined => native);
  const release = vi.fn(), profileRelease = vi.fn();
  const captureOperation = vi.fn((_input: unknown): { openReplyStream?: typeof openReplyStream; release: typeof release } => ({ openReplyStream, release }))
    .mockReturnValueOnce({ release: profileRelease });
  const ownsUrl = vi.fn((url: string) => url === 'https://assets.fixture.test/owned.png');
  return { conversation, event, client, controller, control, snapshot, message, reply, native, openReplyStream, release, profileRelease, captureOperation, ownsUrl };
}

describe('CLI progressive reply ingress', () => {
  it('captures trusted native facts, preserves media authorization, and releases after completion', async () => {
    const f = progressiveIngress({ execute: async (request, flow) => {
      expect(flow.release).not.toHaveBeenCalled();
      expect(flow.profileRelease).not.toHaveBeenCalled();
      const stream = request.ports.reply!.openStream!()!;
      expect(flow.captureOperation).toHaveBeenCalledTimes(2);
      const captured = flow.captureOperation.mock.calls.at(-1)![0] as unknown as Record<string, unknown>;
      expect(captured).toMatchObject({ target: flow.conversation, requester: rootPluginId() });
      expect(captured.client).toBe(flow.client);
      const options = flow.openReplyStream.mock.calls[0]![0];
      expect(options.source).toEqual({ messageId: 'native-message', senderId: 'sender', event: flow.event });
      expect(options.source!.event).toBe(flow.event);
      expect((options.source!.event as typeof flow.event).nativeMethod()).toBe('sdk');
      expect(options.beforeSubmit).not.toThrow();
      const owned = { type: 'image' as const, data: { media: { kind: 'url' as const, value: 'https://assets.fixture.test/owned.png' } } };
      expect(await options.prepare!([owned], request.signal)).toEqual([owned]);
      const denied = await options.prepare!([{ type: 'image', data: { media: { kind: 'url', value: 'https://private.fixture.test/secret.png' } } },
        { type: 'image', data: { media: { kind: 'path', value: '/outside/private.png' } } }], request.signal);
      expect(denied.every(segment => segment.type === 'text')).toBe(true);
      await stream.finish({ revision: 1, messages: [] });
      expect(flow.release).not.toHaveBeenCalled();
      return { status: 'completed', output: [] };
    } });
    await f.run();
    expect(f.native.finish).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.reply).not.toHaveBeenCalled();
  });

  it('rechecks the control plane immediately before each progressive submission', async () => {
    const f = progressiveIngress({ execute: async (request, flow) => {
      request.ports.reply!.openStream!();
      const beforeSubmit = flow.openReplyStream.mock.calls[0]![0].beforeSubmit!;
      expect(beforeSubmit).not.toThrow();
      await flow.control.set({ expectedRevision: 0, instance: { emergency_stop: true }, actorId: 'operator' });
      expect(beforeSubmit).toThrow(expect.objectContaining({ code: 'reply_suppressed', disposition: 'not_sent' }));
      return { status: 'completed', output: [] };
    } });
    await f.run();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.native.update).not.toHaveBeenCalled();
  });

  it('rechecks the current admission stale verdict rather than caching initial permission', async () => {
    const admit = HostMailbox.prototype.admit;
    let stale = false;
    const spy = vi.spyOn(HostMailbox.prototype, 'admit').mockImplementation(async function (this: HostMailbox, ...args) {
      const admitted = await admit.apply(this, args);
      return admitted.kind === 'run' ? { ...admitted, staleCheck: () => stale
        ? { kind: 'discard' as const, senders: ['sender'] } : admitted.staleCheck() } : admitted;
    });
    const f = progressiveIngress({ execute: async (request, flow) => {
      request.ports.reply!.openStream!();
      const beforeSubmit = flow.openReplyStream.mock.calls[0]![0].beforeSubmit!;
      expect(beforeSubmit).not.toThrow(); stale = true;
      expect(beforeSubmit).toThrow(expect.objectContaining({ code: 'reply_suppressed', disposition: 'not_sent' }));
      return { status: 'completed', output: [] };
    } });
    try { await f.run(); expect(f.release).toHaveBeenCalledOnce(); }
    finally { spy.mockRestore(); }
  });

  it('releases captured authority when executeLeased throws', async () => {
    const f = progressiveIngress({ expectExecutionError: true, execute: async (request) => {
      request.ports.reply!.openStream!();
      throw new Error('synthetic engine failure');
    } });
    await f.run();
    expect(f.executeLeased).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it.each(['unsupported', 'off'] as const)('keeps ordinary delivery when progressive replies are %s', async mode => {
    const f = progressiveIngress({ supported: mode !== 'unsupported', portAbsent: mode === 'off', execute: async (request) => {
      expect(request.ports.reply!.openStream!()).toBeUndefined();
      expect(await request.ports.reply!.send([{ type: 'message', segments: [{ type: 'text', data: { text: 'ordinary answer' } }] }]))
        .toMatchObject({ status: 'sent' });
      return { status: 'completed', output: [] };
    } });
    await f.run();
    expect(f.reply).toHaveBeenCalledExactlyOnceWith([{ type: 'text', data: { text: 'ordinary answer' } }]);
    expect(f.native.finish).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
});


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
  const message = new RuntimeMessage(
    {
      conversation: conversation,
      content: options.text,
      sender: { id: 'user' },
      metadata: {},
      segments: [],
      endpointId: 'bot',
      mentioned: false,
    },
    {
      generation: 1,
      reply: reply,
      clientAdapter: 'fixture',
      presentation: {
        locale: options.locale,
        ...(options.prefix === undefined
          ? {}
          : { resolveCommands: (value) => dispatcher.commandEnvironment(value, snapshot) }),
      },
    },
  );
  const inference = ingressInferenceFixture();
  const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) =>
    options.execute ? options.execute(request) : { status: 'completed', output: [] });
  const route = new AgentTurnIngressRoute({
    withInferenceScope: inference.withInferenceScope,
    projectRoot: process.cwd(), runtime: { executeLeased } as never, resolveEndpointOwner: () => 'user',
    im: { createInteraction: (source: Message) => coordinator.create(source) } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: {
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
      getTriggerConfig: () => ({ enabled: options.enabled ?? false, masters: ['user'], errorTemplate: options.errorTemplate }),
      getAgentConfig: () => ({ execApprovalMode: 'ask' }),
    }, agent: {} } as never,
  });
  return { run: () => route.route(message, { value: snapshot, active: true } as never, rootPluginId(), undefined), reply, inference, executeLeased };
}

it.each(['!', '', '/'])('reads the real dispatcher prefix %j at the Agent management ingress', async prefix => {
  const en = localizedIngress({ prefix, locale: 'en', text: `${prefix}models` });
  const zh = localizedIngress({ prefix, text: `${prefix}models` });
  await Promise.all([en.run(), zh.run()]);
  expect(en.reply).toHaveBeenCalledWith(expect.stringContaining('Available models'));
  expect(zh.reply).toHaveBeenCalledWith(expect.stringContaining('可用模型'));
  expect(en.executeLeased).not.toHaveBeenCalled();
  expect(en.inference.generations).toHaveLength(1);
  expect(en.inference.closed).toBe(1);
  const namespaced = localizedIngress({ prefix, locale: 'en', text: `${prefix}plugin/models` });
  expect(await namespaced.run()).toBe(false);
  expect(namespaced.inference.generations).toEqual([]);
});

it('does not invent a prefix for an API message with no command environment', async () => {
  const api = localizedIngress({ locale: 'en', text: '/models' });
  expect(await api.run()).toBe(false);
  expect(api.inference.generations).toEqual([]);
});

it('passes captured ingress locale into a real pending human approval', async () => {
  const flow = localizedIngress({ prefix: '!', locale: 'en', text: 'hello', enabled: true,
    execute: async request => {
      const result = await requestApprovalOutcome(request.ports.approval!, { requestId: 'approval', toolName: 'synthetic-operation', question: 'Custom question', humanOnly: true, timeoutMs: 1000, signal: request.signal });
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


describe('personal Session IM ingress', () => {
  const endpoint = { id: 'root\0zhin.adapter\0icqq', adapter: 'icqq' };
  const conversation: ConversationRef = { endpoint, kind: 'group', id: 'shared-room' };

  function fixture(options: { merge?: boolean; quietMs?: number; masters?: string[]; log?: DecisionEventLog; hold?: boolean; live?: boolean; ambient?: boolean; events?: MemoryConversationEventStore; execute?: (request: TurnRequest) => Promise<void> } = {}) {
    const requests: TurnRequest[] = [];
    const complete: Array<() => void> = [];
    let released = false;
    const snapshot = {
      root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(),
      capabilities: new Map(options.live ? [[endpoint.id, { definition: { capabilities: ['inbound', 'liveDanmaku'] } }]] : []),
    } as unknown as RuntimeSnapshot;
    const snapshots = new SnapshotStore(snapshot);
    const archiveSession = vi.fn(async () => true);
    const appendSessionEvents = vi.fn(async (_sessionKey: string, _events: unknown, _options: unknown) => true);
    const readConversationContext = vi.fn(async (_conversation: ConversationRef, _consumer: string) => ({
      blocks: options.ambient ? [{ text: 'Unanswered question', eventType: 'message.created' }] : [], cursor: 5,
    }));
    const commitConversationContext = vi.fn(async (_conversation: ConversationRef, _consumer: string, _cursor: number) => undefined);
    const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) => {
      requests.push(request);
      await options.execute?.(request);
      if (options.hold && !released) await new Promise<void>(resolve => complete.push(resolve));
      return { status: 'completed', output: [] };
    });
    const route = new AgentTurnIngressRoute({
      withInferenceScope: ingressInferenceFixture({ respond: () => assistantTextReply('{"engage":true,"confidence":0.9,"reason":"unanswered"}') }).withInferenceScope,
      projectRoot: '/host-a', runtime: { executeLeased } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }), readConversationContext, commitConversationContext, conversationEventReader: options.events } as never,
      ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
      agent: {
        service: {
          getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
          getTriggerConfig: () => ({ enabled: true,
            ...(options.masters ? { masters: options.masters } : {}),
            ...(options.events ? { sceneEvents: { conversations: ['*'] } } : {}),
            ...(options.ambient ? { ambient: { conversations: ['*'], quietMs: 0, cooldownMs: 0, judgeIntervalMs: 0 } } : {}),
          }),
          getAgentConfig: () => ({ mailbox: { merge: { enabled: options.merge ?? false, quietMs: options.quietMs ?? 0, maxWaitMs: (options.quietMs ?? 0) * 4 },
            ...(options.live ? { live: { windowMs: 50, minIntervalMs: 0 } } : {}) } }),
        },
        agent: { archiveSession, appendSessionEvents, ...(options.log ? { getDecisionEvents: () => options.log } : {}) },
      } as never,
    });
    const run = async (subjectId: string, text = '#hello', target = conversation, account = 'account-a', extra: Partial<Message> = {}) => {
      const message = {
        ...extra,
        conversation: target, content: text, endpointId: account, sender: { id: subjectId },
        message: { conversation: target, id: `message-${subjectId}` },
        $reply: vi.fn(async () => ({ status: 'sent' })),
      } as unknown as Message;
      const lease = snapshots.acquire();
      try { return await route.route(message, lease, rootPluginId(), 5); }
      finally { lease.release(); }
    };
    return { route, run, requests, async close() { route.dispose(); await snapshots.close(); }, release: () => { released = true; complete.splice(0).forEach(resolve => resolve()); }, executeLeased, archiveSession, appendSessionEvents, readConversationContext, commitConversationContext };
  }

  /** An `@bot` plain-text group message: mergeable under ADR 0038 §1. */
  const mention = (f: ReturnType<typeof fixture>, subjectId: string, text: string) =>
    f.run(subjectId, text, conversation, 'account-a', { mentioned: true });
  const mergeRows = (log: DecisionEventLog) => log.recent()
    .filter(row => row.reasonCode.startsWith('merge_window_'))
    .map(row => ({ reasonCode: row.reasonCode, userId: row.userId, payload: row.payload }));

  it('merges two people @-ing the Bot in one group into one scene Session turn (ADR 0038 §验收1, R0-fix)', async () => {
    vi.useFakeTimers();
    const log = new DecisionEventLog();
    const f = fixture({ merge: true, quietMs: 100, log });
    try {
      const alice = mention(f, 'alice', '今晚几点开会');
      const bob = mention(f, 'bob', '在哪个会议室');
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([alice, bob]);
      expect(f.executeLeased).toHaveBeenCalledTimes(1);
      const request = f.requests[0]!;
      expect(request.session.key).toMatch(/^scene-task:v1:[a-f0-9]{64}$/);
      expect(request.session.personal).toBeUndefined();
      expect(request.input.mergedSenders?.map(sender => sender.subjectId)).toEqual(['alice', 'bob']);
      expect(request.input.mergedSenders?.map(sender => sender.texts)).toEqual([['今晚几点开会'], ['在哪个会议室']]);
      await vi.waitFor(() => expect(mergeRows(log).map(row => row.reasonCode)).toContain('merge_window_flushed'));
      const rows = mergeRows(log);
      expect(rows.filter(row => row.reasonCode === 'merge_window_joined').map(row => row.userId)).toEqual(['alice', 'bob']);
      expect(rows.filter(row => row.reasonCode === 'merge_window_flushed')).toEqual([
        { reasonCode: 'merge_window_flushed', userId: 'alice', payload: expect.objectContaining({ source: 'message', senders: ['alice', 'bob'], waitedMs: 100 }) },
      ]);
    } finally { await f.close(); vi.useRealTimers(); }
  });

  it('keeps each sender in their personal Session when group merging is disabled', async () => {
    const log = new DecisionEventLog();
    const f = fixture({ merge: false, hold: true, log });
    const alice = mention(f, 'alice', 'alice question');
    const bob = mention(f, 'bob', 'bob question');
    try {
      await vi.waitFor(() => expect(f.executeLeased).toHaveBeenCalledTimes(2));
      expect(new Set(f.requests.map(request => request.session.key)).size).toBe(2);
      expect(f.requests.every(request => !request.session.key.startsWith('scene-task:'))).toBe(true);
      expect(f.requests.map(request => request.session.personal?.subjectId).sort()).toEqual(['alice', 'bob']);
      expect(f.requests.every(request => request.input.mergedSenders === undefined)).toBe(true);
      expect(mergeRows(log)).toEqual([]);
    } finally {
      f.release();
      await Promise.all([alice, bob]);
      await f.close();
    }
  });

  it('keeps a master @ in its own personal turn while members merge in the scene Session (ADR 0038 §0.3)', async () => {
    vi.useFakeTimers();
    const log = new DecisionEventLog();
    const f = fixture({ merge: true, quietMs: 100, masters: ['boss'], log });
    try {
      const turns = [mention(f, 'alice', 'alice question'), mention(f, 'boss', 'boss question'), mention(f, 'bob', 'bob question')];
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all(turns);
      expect(f.executeLeased).toHaveBeenCalledTimes(2);
      const master = f.requests.find(request => request.principal.subjectId === 'boss')!;
      expect(master.session.personal?.subjectId).toBe('boss');
      expect(master.session.key.startsWith('scene-task:')).toBe(false);
      expect(master.input.mergedSenders).toBeUndefined();
      const merged = f.requests.find(request => request !== master)!;
      expect(merged.session.key).toMatch(/^scene-task:v1:[a-f0-9]{64}$/);
      expect(merged.input.mergedSenders?.map(sender => sender.subjectId)).toEqual(['alice', 'bob']);
      await vi.waitFor(() => expect(mergeRows(log).map(row => row.reasonCode)).toContain('merge_window_flushed'));
      expect(mergeRows(log).filter(row => row.userId === 'boss')).toEqual([]);
    } finally { await f.close(); vi.useRealTimers(); }
  });

  it('keeps non-mergeable @ messages (media, quote) in personal Sessions with merging enabled', async () => {
    const f = fixture({ merge: true, quietMs: 100, hold: true });
    const image = f.run('alice', 'look', conversation, 'account-a', {
      mentioned: true, segments: [{ type: 'image', data: { url: 'https://example.test/a.png' } }],
    } as Partial<Message>);
    const quote = f.run('bob', 'what about this', conversation, 'account-a', {
      mentioned: true, replyTo: { id: 'quoted-1' },
    } as Partial<Message>);
    try {
      await vi.waitFor(() => expect(f.executeLeased).toHaveBeenCalledTimes(2));
      expect(f.requests.every(request => !request.session.key.startsWith('scene-task:'))).toBe(true);
      expect(f.requests.map(request => request.session.personal?.subjectId).sort()).toEqual(['alice', 'bob']);
      expect(f.requests.every(request => request.input.mergedSenders === undefined)).toBe(true);
    } finally {
      f.release();
      await Promise.all([image, quote]);
      await f.close();
    }
  });

  it('lets the carrier stop a merged scene turn with a stop word from its personal routing', async () => {
    vi.useFakeTimers();
    const f = fixture({ merge: true, quietMs: 100, hold: true });
    try {
      const alice = mention(f, 'alice', 'alice question');
      const bob = mention(f, 'bob', 'bob question');
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(f.requests).toHaveLength(1));
      const merged = f.requests[0]!;
      expect(merged.session.key).toMatch(/^scene-task:/);
      await mention(f, 'alice', '取消');
      expect(merged.signal.aborted).toBe(true);
      f.release();
      await Promise.all([alice, bob]);
    } finally { f.release(); await f.close(); vi.useRealTimers(); }
  });

  it('keeps prefix-triggered turns of two people in their personal Sessions even with group merging enabled', async () => {
    const f = fixture({ merge: true, hold: true });
    const alice = f.run('alice', '#alice question');
    const bob = f.run('bob', '#bob question');
    try {
      await vi.waitFor(() => expect(f.executeLeased).toHaveBeenCalledTimes(2));
      expect(new Set(f.requests.map(request => request.session.key)).size).toBe(2);
      expect(f.requests.map(request => request.input.text).sort()).toEqual(['alice question', 'bob question']);
      expect(f.requests.every(request => request.input.mergedSenders === undefined)).toBe(true);
      expect(f.requests.map(request => request.session.personal?.subjectId).sort()).toEqual(['alice', 'bob']);
      expect(f.requests.every(request => request.signal.aborted === false)).toBe(true);
    } finally {
      f.release();
      await Promise.all([alice, bob]);
      await f.close();
    }
  });

  it('retains a shared system scene task for a multi-person live window', async () => {
    vi.useFakeTimers();
    const f = fixture({ live: true });
    try {
      const alice = f.run('alice', 'alice question');
      const bob = f.run('bob', 'bob question');
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([alice, bob]);
      expect(f.requests).toHaveLength(1);
      const request = f.requests[0]!;
      expect(request.session.key).toMatch(/^scene-task:v1:[a-f0-9]{64}$/);
      expect(request.session.personal).toBeUndefined();
      expect(request.input.liveDanmaku?.senders.map(sender => sender.subjectId).sort()).toEqual(['alice', 'bob']);
      expect(request.policy.permissions).toEqual(['user']);
      expect(request.policy.filesystem?.access).toBe('read-only');
    } finally { await f.close(); vi.useRealTimers(); }
  });

  it('uses a shared system Session for ambient participation without a personal owner', async () => {
    const f = fixture({ ambient: true });
    try {
      await f.run('alice', 'A question nobody answered');
      await f.run('bob', 'Another question');
      expect(f.requests).toHaveLength(2);
      expect(f.requests[0]!.session.key).toMatch(/^scene-task:v1:[a-f0-9]{64}$/);
      expect(f.requests[0]!.session.key).toBe(f.requests[1]!.session.key);
      expect(f.requests.every(request => request.session.personal === undefined)).toBe(true);
      // The judge reads public events as its own non-committing consumer.
      expect(f.readConversationContext.mock.calls.map(call => call[1])).toEqual(['zhin.ambient-engagement', 'zhin.ambient-engagement']);
      expect(f.commitConversationContext).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('keeps public conversation consumers independent for each personal Session', async () => {
    const read = new Set<string>();
    const f = fixture({ execute: async request => {
      if (read.has(request.session.key)) return;
      read.add(request.session.key);
      await request.ports.conversationContext!.readPending(request.signal);
      if (read.size === 1) await request.ports.conversationContext!.commit(5);
    } });
    try {
      await f.run('alice');
      await f.run('bob');
      await f.run('alice', '#again');
      const [alice, bob, again] = f.requests;
      expect(alice.session.key).toBe(again.session.key);
      expect(alice.session.key).not.toBe(bob.session.key);
      expect(f.readConversationContext.mock.calls.map(call => call[1])).toEqual([
        `agent-session:${alice.session.key}`, `agent-session:${bob.session.key}`,
      ]);
      expect(f.commitConversationContext).toHaveBeenCalledExactlyOnceWith(conversation, `agent-session:${alice.session.key}`, 5);
      await expect(alice.ports.conversationContext!.readPending(alice.signal)).rejects.toThrow('generation lease expired');
    } finally { await f.close(); }
  });

  it('passes shared card/title changes to each personal turn even though they are stored only in the scene-task history', async () => {
    const events = new MemoryConversationEventStore();
    const f = fixture({ events });
    try {
      for (const [index, change] of [
        { type: 'member.card_changed', value: 'changed' },
        { type: 'member.title_changed', value: 'moderator' },
      ].entries()) {
        const event = { ...change, eventId: `profile-${index}`, conversation, member: { id: 'bob' }, timestamp: Date.now() } as ConversationEvent;
        const { sequence } = await events.append(event);
        f.route.handleSceneEvent({ sequence, event, selfIds: ['account-a'], endpointId: 'account-a' });
      }
      // Core deliberately excludes these event types from its ordinary conversation blocks.
      expect((await new ConversationRuntime(events).readContext(conversation, 'independent-check', 2)).blocks).toEqual([]);
      await f.run('alice');
      await f.run('carol');
      await f.run('alice', '#again');
      const expected = ['bob title → "moderator"', 'bob card → "changed"'];
      expect(f.requests[0]!.input.sceneEvents).toEqual(expected);
      expect(f.requests[1]!.input.sceneEvents).toEqual(expected);
      expect(f.requests[2]!.input.sceneEvents).toBeUndefined();
      expect(f.appendSessionEvents).toHaveBeenCalledTimes(2);
      expect(new Set(f.appendSessionEvents.mock.calls.map(([key]) => key)).size).toBe(1);
      expect(f.requests.every(request => f.appendSessionEvents.mock.calls.every(([key]) => key !== request.session.key))).toBe(true);
    } finally { await f.close(); }
  });

  it('isolates actual account instances, parents and threads through the real request path', async () => {
    const f = fixture();
    try {
      await f.run('alice');
      await f.run('alice', '#other account', conversation, 'account-b');
      await f.run('alice', '#parent', { ...conversation, parent: { kind: 'group', id: 'guild' } });
      await f.run('alice', '#thread', { ...conversation, threadId: 'thread' });
      expect(new Set(f.requests.map(request => request.session.key)).size).toBe(4);
    } finally { await f.close(); }
  });

  it('clears only the caller Session and cancels only that caller active turn', async () => {
    const f = fixture({ hold: true });
    const alice = f.run('alice');
    const bob = f.run('bob');
    try {
      await vi.waitFor(() => expect(f.requests).toHaveLength(2));
      const aliceRequest = f.requests.find(request => request.principal.subjectId === 'alice')!;
      const bobRequest = f.requests.find(request => request.principal.subjectId === 'bob')!;
      await f.run('alice', '#clear');
      expect(f.archiveSession).toHaveBeenCalledExactlyOnceWith(aliceRequest.session.key);
      expect(f.archiveSession).not.toHaveBeenCalledWith(bobRequest.session.key);
      expect(f.archiveSession).not.toHaveBeenCalledWith('icqq:account-a:group:shared-room');
      await f.run('alice', '#cancel');
      expect(aliceRequest.signal.aborted).toBe(true);
      expect(bobRequest.signal.aborted).toBe(false);
    } finally {
      f.release();
      await Promise.all([alice, bob]);
      await f.close();
    }
  });
});

it('CLI progressive cancellation interrupts a pending finish instead of waiting behind it', async () => {
  const f = progressiveIngress({ execute: async (request, flow) => {
    let release!: (value: CoreReplyStream['receipt']) => void;
    const cancelled: CoreReplyStream['receipt'] = { status: 'failed', parts: [{ message: flow.native.receipt.message }],
      failure: { code: 'cancelled', message: 'cancelled', retryable: false, deliveryUnknown: true } };
    const finish = vi.spyOn(flow.native, 'finish').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const cancel = vi.spyOn(flow.native, 'cancel').mockResolvedValue(cancelled);
    const stream = request.ports.reply!.openStream!()!;
    const finishing = stream.finish({ revision: 1, messages: [] });
    const cancelling = stream.cancel();
    try {
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(await cancelling).toBe(cancelled);
    } finally { release(flow.native.receipt); }
    expect(await finishing).toBe(cancelled);
    expect(finish).toHaveBeenCalledOnce();
    return { status: 'completed', output: [] };
  } });
  await f.run();
  expect(f.release).toHaveBeenCalledOnce();
});
