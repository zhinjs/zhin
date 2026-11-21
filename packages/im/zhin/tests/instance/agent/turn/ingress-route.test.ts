import { assistantTextReply } from '../../../../../agent/tests/helpers/mock-llm-api.js';
import { ingressInferenceFixture } from './inference-fixture.js';
import { userSetReplyLocale } from '../../../../../agent/src/prompt/rules/reply-language.js';
import { RuntimeMessage } from '../../../../../core/src/plugin-runtime/im/contracts.js';
import { MessageDispatcher } from '../../../../../core/src/plugin-runtime/im/message-dispatcher.js';
import { RuntimeInteractionCoordinator } from '../../../../../core/src/plugin-runtime/im/interaction-runtime.js';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentCapabilities, AgentDecisionRuntime } from '@zhin.js/agent/runtime';
import { AiControlPlane, DecisionEventLog, requestApprovalOutcome, type TurnRequest } from '@zhin.js/agent';
import { HostMailbox } from '@zhin.js/agent/turn';
import type { CoreReplyStream, Message, OpenReplyStreamOptions } from '@zhin.js/core/runtime';
import { InboundOutcomeLedger, createIngressRouteFacade, inboundOutcomeSink } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore, type ConversationEvent, type ConversationRef } from '@zhin.js/im-contract';
import { ConversationRuntime } from '../../../../../core/src/plugin-runtime/im/conversation-runtime.js';
import { executeInboundTurnSpine } from '../../../../../core/src/plugin-runtime/im/inbound-spine.js';
import { createCapabilitySlot, rootPluginId, SnapshotStore, userLocalePreferencesToken, type Locale, type PluginId, type RuntimeSnapshot,
  type SnapshotLease, type SnapshotReader, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
import { AgentTurnIngressRoute, auditStaleReply, createHostOperationResources, mergedMemberAccess, mergedTurnSenders,
  selectDecisionAgentRoute } from '@zhin.js/agent/runtime';
import { createRuntimeManagementCommands } from '@zhin.js/agent';
import { dispatchLeaseToken } from '../../../../../agent/src/plugin-runtime/inference/dispatch-lease.js';
import { CommandIndex, commandFeatureId } from '@zhin.js/command';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';

/**
 * #1250 第 83 批: the Host's IM operation resources for one message, as Core opens them with the lease
 * it holds for the message (`imOperationResourcesToken`): a management command retains that generation.
 */
/** One Agent Host's operation resources: its `im` port and the `isDispatchLease` the management commands get. */
const hostResources = createHostOperationResources({ host: {} as never, quota: {} as never });

function hostOperationResources(lease: SnapshotLease, snapshots: Pick<SnapshotReader, 'retain'>, conversationSequence?: number) {
  const port = hostResources.im;
  return (input: Readonly<{ message: unknown; owner: PluginId; signal: AbortSignal }>) =>
    port.open({ lease, snapshots: snapshots as SnapshotReader, message: input.message as never, owner: input.owner, signal: input.signal,
      ...(conversationSequence !== undefined ? { conversationSequence } : {}) });
}
const operationInputResources = Symbol.for('zhin.operation-input-resources/1');

/**
 * #1250 第 83 批: makes `snapshot` a generation whose Root holds the Agent management commands, wired
 * to `route` the way the Agent Host registers them.
 */
function installManagementCommands(snapshot: RuntimeSnapshot, route: () => AgentTurnIngressRoute, zhinAgent: unknown): void {
  const root = rootPluginId();
  const mutable = snapshot as unknown as { generation: number; tree: Map<unknown, unknown>; resources: Map<unknown, Map<string, unknown>>;
    capabilities: Map<unknown, unknown>; projections: Map<unknown, unknown>; config: Map<unknown, unknown> };
  mutable.generation ??= 1;
  mutable.config ??= new Map();
  mutable.tree.set(root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] });
  if (!mutable.resources.has(root)) mutable.resources.set(root, new Map());
  mutable.resources.get(root)!.set(permissionHostToken.id, new PermissionHost());
  const slots = createRuntimeManagementCommands({
    zhinAgent: zhinAgent as never,
    isDispatchLease: hostResources.isDispatchLease,
    open: (message, dispatch, run) => route().runManagementOperation(message, dispatch, run),
    clear: async (message, dispatch) => { await route().clearAsCommand(message, dispatch); },
  }).map(command => createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: command.name,
    source: `/agent/${command.name}`, definition: command.definition }));
  for (const slot of slots) mutable.capabilities.set(slot.id, slot);
  mutable.projections.set(commandFeatureId, new CommandIndex(slots, snapshot, {}));
}

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
      projectRoot: process.cwd(), runtime: { executeLeased, ownsLease: (lease: SnapshotLease) => snapshots.owns(lease) } as never,
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
    { source: 'group', messageId: undefined, share: true, reaction: false },
    { source: 'channel', messageId: undefined, share: true, reaction: false },
    { source: 'group', messageId: 'm1', share: true, reaction: true },
    { source: 'private', messageId: 'm1', share: false, reaction: false },
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
    // The IM runtime's lease for the message: the route runs only on a lease the Root's store issued.
    const lease = { value: snapshot, active: true } as unknown as SnapshotLease;
    const route = new AgentTurnIngressRoute({
      withInferenceScope: ingressInferenceFixture().withInferenceScope,
      projectRoot: process.cwd(),
      runtime: { executeLeased, ownsLease: (candidate: SnapshotLease) => candidate === lease } as never,
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
    });

    await route.route(message, lease, rootPluginId(), undefined);

    expect(reply).not.toHaveBeenCalled();
    expect(executeLeased).toHaveBeenCalledOnce();
    const request = executeLeased.mock.calls[0]![2] as TurnRequest;
    expect(request.input.contextState).toEqual({ bot: { id: 'actual-platform-account' } });
    const profile = request.ports.reply!.segments!;
    expect(profile.types.includes('share')).toBe(scenario.share);
    expect(profile.extensions?.share?.hint).toBe(scenario.share ? 'Use the room share card.' : undefined);
    expect(profile.reaction).toEqual(scenario.reaction ? { values: [{ value: '76', label: '赞' }] } : undefined);
  });

  it('behaves as a no-op pre-route on the IngressRoute interface', async () => {
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
  // The IM runtime's lease for the message: the route runs only on a lease the Root's store issued.
  const lease = { value: flow.snapshot, active: true } as unknown as SnapshotLease;
  const route = new AgentTurnIngressRoute({
    withInferenceScope: ingressInferenceFixture().withInferenceScope,
    projectRoot: '/synthetic/allowed-workspace', runtime: { executeLeased, ownsLease: (candidate: SnapshotLease) => candidate === lease } as never,
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
        const result = await route.route(flow.message, lease, rootPluginId(), undefined);
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
      expect(options.mediaTrust?.source).toBe('agent:reply');
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
    // Model output is delivered as untrusted content: Core holds its media to the untrusted-source policy.
    expect(f.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      $content: 'zhin.untrusted-content/1',
      content: [{ type: 'text', data: { text: 'ordinary answer' } }],
      trust: expect.objectContaining({ source: 'agent:reply' }),
    }));
    expect(f.native.finish).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
});


function localizedIngress(options: { prefix?: string; locale?: 'zh-CN' | 'en'; text: string; enabled?: boolean; errorTemplate?: string;
  execute?: (request: TurnRequest) => Promise<unknown>;
  /** #1250 第 83 批: the generation holds the Agent management Root commands. */
  commands?: boolean;
  /** #1250 b69: `/language` settings by sender id, served through the root preference port. */
  preferences?: Readonly<Record<string, Locale>>; senderId?: string; metadata?: Readonly<Record<string, unknown>> }) {
  const endpoint = { adapter: 'root', id: 'root\u0000zhin.adapter\u0000fixture' };
  const conversation = { endpoint, kind: 'private' as const, id: options.senderId ?? 'user' };
  const preferencePort: UserLocalePreferences | undefined = options.preferences ? {
    get: async (_endpoint, senderId) => options.preferences![senderId],
    set: async () => {},
  } : undefined;
  const resources = preferencePort
    ? new Map([[rootPluginId(), new Map<string, unknown>([[userLocalePreferencesToken.id, preferencePort]])]]) : new Map();
  const snapshot = { root: rootPluginId(), resources, tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
  const dispatcher = new MessageDispatcher(() => options.prefix!);
  const coordinator = new RuntimeInteractionCoordinator();
  const release = vi.fn();
  // The IM runtime's lease for the message; a command retains it through the Host operation resources.
  const held = { value: snapshot, active: true, release: vi.fn() } as unknown as SnapshotLease;
  // The leases this fixture's store issued: the Host checks a dispatch lease against its real store.
  const issued = new WeakSet<object>();
  const openResources = hostOperationResources(held, { retain: () => {
    const lease = { value: snapshot, active: true, release };
    issued.add(lease);
    return lease as never;
  } });
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
      // The bot owner (ADR 0056: Runtime-set chat role).
      sender: { id: options.senderId ?? 'user', chatRole: 'owner', chatRoleLevels: { owner: 'global' } },
      metadata: options.metadata ?? {},
      // The command dispatch matches the structured view when present: keep it aligned with the text.
      segments: options.commands ? [{ type: 'text', data: { text: options.text } }] : [],
      endpointId: 'bot',
      mentioned: false,
    },
    {
      generation: 1,
      ...(options.commands ? { snapshot, createOperationResources: openResources } : {}),
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
    projectRoot: process.cwd(), runtime: { executeLeased, ownsLease: (lease: SnapshotLease) => lease === held || issued.has(lease) } as never,
    holdsDispatchLease: hostResources.holdsDispatchLease,
    resolveEndpointOwner: () => 'user',
    im: { createInteraction: (source: Message) => coordinator.create(source) } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: {
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
      getTriggerConfig: () => ({ enabled: options.enabled ?? false, errorTemplate: options.errorTemplate }),
      getAgentConfig: () => ({ execApprovalMode: 'ask' }),
    }, agent: {} } as never,
  });
  if (options.commands) installManagementCommands(snapshot, () => route, {});
  return { run: () => route.route(message, held, rootPluginId(), undefined), reply, inference, executeLeased,
    dispatch: () => dispatcher.dispatchWithReply(message, snapshot), release };
}

it.each(['!', '', '/'])('runs the management Root commands with the real dispatcher prefix %j (#1250 第 83 批)', async prefix => {
  const en = localizedIngress({ prefix, locale: 'en', text: `${prefix}models`, commands: true });
  const zh = localizedIngress({ prefix, text: `${prefix}models`, commands: true });
  const [enResult, zhResult] = await Promise.all([en.dispatch(), zh.dispatch()]);
  expect(enResult.dispatch).toMatchObject({ matched: true, status: 'executed', command: 'models' });
  expect(enResult.reply?.content).toEqual(expect.stringContaining('Available models'));
  expect(zhResult.reply?.content).toEqual(expect.stringContaining('可用模型'));
  expect(en.executeLeased).not.toHaveBeenCalled();
  // One operation-bound inference scope on the leased generation, closed and released afterwards.
  expect(en.inference.generations).toHaveLength(1);
  expect(en.inference.closed).toBe(1);
  expect(en.release).toHaveBeenCalledOnce();
  const namespaced = localizedIngress({ prefix, locale: 'en', text: `${prefix}plugin/models`, commands: true });
  expect((await namespaced.dispatch()).dispatch.matched).toBe(false);
  expect(namespaced.inference.generations).toEqual([]);
  // The Agent ingress no longer parses management commands itself.
  const ingress = localizedIngress({ prefix, locale: 'en', text: `${prefix}models` });
  expect(await ingress.run()).toBe(false);
  expect(ingress.inference.generations).toEqual([]);
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

describe('#1250 b69 reply language set with /language', () => {
  async function captured(options: Parameters<typeof localizedIngress>[0]) {
    let input: TurnRequest['input'] | undefined;
    const flow = localizedIngress({ prefix: '!', enabled: true, ...options,
      execute: async (request) => { input = request.input; return { status: 'completed', output: [] }; } });
    expect(await flow.run()).toBe(true);
    return input!;
  }

  it('marks the turn locale as the sender\'s own setting, so the turn context names /language', async () => {
    const input = await captured({ locale: 'en', text: '今天天气怎么样', preferences: { user: 'en' } });
    expect(input.locale).toBe('en');
    expect(input.metadata).toMatchObject({ zhinUserLocale: 'en' });
    expect(userSetReplyLocale(input)).toBe('en');
  });

  it('keeps the project fallback when the sender never set a language', async () => {
    const input = await captured({ locale: 'en', text: '今天天气怎么样', preferences: {} });
    expect(input.metadata).toMatchObject({ zhinUserLocale: false });
    expect(userSetReplyLocale(input)).toBeUndefined();
    const noPort = await captured({ locale: 'en', text: 'hi' });
    expect(userSetReplyLocale(noPort)).toBeUndefined();
  });

  it('does not let adapter metadata claim a user-set locale', async () => {
    const input = await captured({ locale: 'en', text: 'hi', metadata: { zhinUserLocale: 'en' } });
    expect(input.metadata).toMatchObject({ zhinUserLocale: false });
    expect(userSetReplyLocale(input)).toBeUndefined();
  });

  it('follows each sender\'s own setting: one sender\'s /language never applies to another', async () => {
    const preferences = { alice: 'en' as const };
    const alice = await captured({ senderId: 'alice', locale: 'en', text: '你好', preferences });
    const bob = await captured({ senderId: 'bob', locale: 'zh-CN', text: 'hello', preferences });
    expect(userSetReplyLocale(alice)).toBe('en');
    expect(userSetReplyLocale(bob)).toBeUndefined();
  });
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
      projectRoot: '/host-a', runtime: { executeLeased, ownsLease: (lease: SnapshotLease) => snapshots.owns(lease) } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }), readConversationContext, commitConversationContext, conversationEventReader: options.events, inboundMediaOrigins: () => [] } as never,
      ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
      agent: {
        service: {
          getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
          getTriggerConfig: () => ({ enabled: true,
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
        conversation: target, content: text, endpointId: account,
        sender: { id: subjectId, ...(options.masters?.includes(subjectId) ? { chatRole: 'owner' as const, chatRoleLevels: { owner: 'global' as const } } : {}) },
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

  it('never clears the shared live-room scene task: 清空, #/new and @bot /reset go on as live messages (#1250)', async () => {
    vi.useFakeTimers();
    const f = fixture({ live: true });
    try {
      const runs = [
        f.run('alice', '清空'),
        f.run('bob', '#/new'),
        f.run('carol', '@zhin /reset', conversation, 'account-a', { mentioned: true }),
      ];
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(runs);
      expect(f.archiveSession).not.toHaveBeenCalled();
      expect(f.executeLeased).toHaveBeenCalled();
      expect(f.requests.every(request => request.session.key.startsWith('scene-task:'))).toBe(true);
    } finally { await f.close(); vi.useRealTimers(); }
  });

  it('an ambient interjection never clears the shared scene task; an @ to the bot clears only the sender’s session (#1250)', async () => {
    const f = fixture({ ambient: true });
    try {
      await f.run('alice', '清空');
      expect(f.archiveSession).not.toHaveBeenCalled();
      // The interjection went on as a normal ambient turn in the shared scene Session.
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]!.session.key).toMatch(/^scene-task:v1:[a-f0-9]{64}$/);
      await mention(f, 'bob', '清空');
      expect(f.archiveSession).toHaveBeenCalledOnce();
      const cleared = (f.archiveSession.mock.calls[0] as unknown[])[0] as string;
      expect(cleared).not.toMatch(/^scene-task:/);
      expect(cleared).not.toBe(f.requests[0]!.session.key);
      expect(f.requests).toHaveLength(1);
    } finally { await f.close(); }
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

describe('inbound message outcomes from the Agent ingress (ADR 0061 P2)', () => {
  const endpoint = { id: 'root\0zhin.adapter\0icqq', adapter: 'icqq' };
  const conversation: ConversationRef = { endpoint, kind: 'group', id: 'quiet-room' };

  function outcomeFixture(trigger: Record<string, unknown>) {
    const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
    const snapshots = new SnapshotStore(snapshot);
    const executeLeased = vi.fn(async () => ({ status: 'completed', output: [] }));
    const route = new AgentTurnIngressRoute({
      withInferenceScope: ingressInferenceFixture({ respond: () => assistantTextReply('{"engage":false,"confidence":0.1,"reason":"secret chat quote"}') }).withInferenceScope,
      projectRoot: '/host-a', runtime: { executeLeased, ownsLease: (lease: SnapshotLease) => snapshots.owns(lease) } as never,
      im: { createInteraction: () => ({ ask: vi.fn() }), readConversationContext: async () => ({ blocks: [{ text: 'hi', eventType: 'message.created' }], cursor: 5 }),
        commitConversationContext: async () => undefined } as never,
      ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
      agent: {
        service: {
          getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
          getTriggerConfig: () => ({ enabled: true, ...trigger }),
          getAgentConfig: () => ({ mailbox: { merge: { enabled: false, quietMs: 0, maxWaitMs: 0 } } }),
        },
        agent: { archiveSession: vi.fn(async () => true), appendSessionEvents: vi.fn(async () => true) },
      } as never,
    });
    const run = async (text: string, extra: Record<string, unknown> = {}) => {
      const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
      const message = {
        conversation, content: text, endpointId: 'account-a', sender: { id: 'alice' },
        message: { conversation, id: 'message-1' }, $reply: vi.fn(async () => ({ status: 'sent' })),
        [inboundOutcomeSink]: () => ledger, ...extra,
      } as unknown as Message;
      const lease = snapshots.acquire();
      try { return { handled: await route.route(message, lease, rootPluginId(), 5), record: ledger.settle() }; }
      finally { lease.release(); }
    };
    return { run, executeLeased, async close() { route.dispose(); await snapshots.close(); } };
  }

  it('records not_addressed when the group is not an interjection group (unaddressed-message-no-record)', async () => {
    const f = outcomeFixture({});
    try {
      const { handled, record } = await f.run('我的积分');
      expect(handled).toBe(false);
      expect(record).toMatchObject({ outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient', reply: 'no' });
      expect(f.executeLeased).not.toHaveBeenCalled();
      expect(record.detail).toContain('no ai.trigger.ambient');
    } finally { await f.close(); }
  });

  it('says why a configured but unlisted group got no interjection (review of #1281)', async () => {
    const f = outcomeFixture({ ambient: { conversations: ['icqq:other-room'] } });
    try {
      const { record } = await f.run('我的积分');
      expect(record).toMatchObject({ outcome: 'not_addressed', reason: 'no_command_not_ambient' });
      expect(record.detail).toContain('not in ai.trigger.ambient.conversations');
    } finally { await f.close(); }
  });

  it('records empty_input for an empty group message', async () => {
    const f = outcomeFixture({ ignorePrefixes: ['!'], ambient: { conversations: ['*'] } });
    try {
      expect((await f.run('   ')).record).toMatchObject({ outcome: 'not_addressed', reason: 'empty_input' });
    } finally { await f.close(); }
  });

  it('records ambient_silent with the judge outcome but never the judge’s reason text', async () => {
    const f = outcomeFixture({ ambient: { conversations: ['*'], quietMs: 0, cooldownMs: 0, judgeIntervalMs: 0 } });
    try {
      const { record } = await f.run('anyone around?');
      expect(record).toMatchObject({ outcome: 'ambient_silent', reason: 'ambient_not_engaged', stage: 'ambient' });
      expect(JSON.stringify(record)).not.toContain('secret chat quote');
    } finally { await f.close(); }
  });

  it('records model_silent for an addressed turn that produced no output, with the turn id', async () => {
    const f = outcomeFixture({});
    try {
      const { handled, record } = await f.run('@zhin hello', { mentioned: true });
      expect(handled).toBe(true);
      expect(record).toMatchObject({ outcome: 'model_silent', reason: 'empty_output', stage: 'model' });
      expect(record.turnId).toEqual(expect.any(String));
    } finally { await f.close(); }
  });
});

describe('chat clear command through the Agent ingress (#1250)', () => {
  const endpoint = { id: 'root\0zhin.adapter\0icqq', adapter: 'icqq' };
  const privateChat: ConversationRef = { endpoint, kind: 'private', id: 'alice' };
  const groupChat: ConversationRef = { endpoint, kind: 'group', id: 'room' };
  const stopped = { blocked: true, switch: 'emergency_stop', level: 'instance', reasonCode: 'control_emergency_stop', outcome: 'deny' };

  function clearFixture(options: { control?: unknown; cannotSpeak?: boolean; access?: Record<string, unknown>; trigger?: Record<string, unknown>; live?: boolean;
    observeInbound?: (input: Record<string, unknown>) => Promise<{ blocked: unknown }> } = {}) {
    const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(),
      capabilities: new Map(options.live ? [[endpoint.id, { definition: { capabilities: ['inbound', 'liveDanmaku'] } }]] : []) } as unknown as RuntimeSnapshot;
    const executeLeased = vi.fn(async () => ({ status: 'completed', output: [] }));
    const archiveSession = vi.fn(async (_key: string) => true);
    // #1250 第 83 批: this generation's Root also holds the Agent management commands.
    installManagementCommands(snapshot, () => route, { archiveSession });
    const snapshots = new SnapshotStore(snapshot);
    const route: AgentTurnIngressRoute = new AgentTurnIngressRoute({
      withInferenceScope: ingressInferenceFixture({ respond: () => assistantTextReply('{"engage":false,"confidence":0.1,"reason":"no"}') }).withInferenceScope,
      // The Root's real store: the route checks a management command's dispatch lease against it.
      projectRoot: '/host-a', runtime: { executeLeased, ownsLease: (lease: SnapshotLease) => snapshots.owns(lease) } as never,
      // #1250 第 85 批: and only a lease this Host's own dispatch handed out.
      holdsDispatchLease: hostResources.holdsDispatchLease,
      im: { createInteraction: () => ({ ask: vi.fn() }), readConversationContext: async () => ({ blocks: [], cursor: 5 }),
        commitConversationContext: async () => undefined, inboundMediaOrigins: () => [] } as never,
      ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
      agent: {
        service: {
          getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', mcpServers: [] }) }),
          getTriggerConfig: () => ({ enabled: true, ...options.trigger }),
          getAccessConfig: () => options.access ?? {},
          getAgentConfig: () => ({ mailbox: { merge: { enabled: false, quietMs: 0, maxWaitMs: 0 } } }),
        },
        agent: {
          archiveSession, appendSessionEvents: vi.fn(async () => true),
          ...(options.control ? { getControlPlane: () => options.control } : {}),
          ...(options.cannotSpeak || options.observeInbound ? { getUserProfiles: () => ({ sessions: {
            observeInbound: options.observeInbound ?? vi.fn(async () => ({ blocked: 'muted' })) } }) } : {}),
        },
      } as never,
    });
    const run = async (text: string, extra: { conversation?: ConversationRef; mentioned?: boolean; owner?: boolean; sender?: string; metadata?: Record<string, unknown> } = {}) => {
      const conversation = extra.conversation ?? privateChat;
      const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
      const $reply = vi.fn(async (_content: unknown) => ({ status: 'sent' }));
      const message = {
        conversation, content: text, endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN',
        sender: { id: extra.sender ?? 'alice', ...(extra.owner ? { chatRole: 'owner' as const, chatRoleLevels: { owner: 'global' as const } } : {}) },
        ...(extra.mentioned !== undefined ? { mentioned: extra.mentioned } : {}),
        ...(extra.metadata ? { metadata: extra.metadata } : {}),
        message: { conversation, id: `message-${text}` }, $reply,
        [inboundOutcomeSink]: () => ledger,
      } as unknown as Message;
      const lease = snapshots.acquire();
      try { return { handled: await route.route(message, lease, rootPluginId(), 5), record: ledger.settle(), $reply }; }
      finally { lease.release(); }
    };
    // #1250 第 83 批: the same message through the command dispatch first (the management Root
    // commands of this generation), then — when no command claimed it — the Agent ingress.
    const dispatcher = new MessageDispatcher(() => '/');
    const spine = async (text: string, extra: { conversation?: ConversationRef; owner?: boolean; mentioned?: boolean } = {}) => {
      const conversation = extra.conversation ?? privateChat;
      const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
      // Like the inbound runtime's reply port: a delivered reply is noted on the message's ledger.
      const $reply = vi.fn(async (_content: unknown) => { ledger.noteReplyDelivered(); return { status: 'sent' }; });
      const message = {
        conversation, content: text, endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN',
        sender: { id: 'alice', ...(extra.owner ? { chatRole: 'owner' as const, chatRoleLevels: { owner: 'global' as const } } : {}) },
        ...(extra.mentioned !== undefined ? { mentioned: extra.mentioned } : {}),
        message: { conversation, id: `message-${text}` }, $reply,
        [inboundOutcomeSink]: () => ledger,
      } as unknown as Message;
      const lease = snapshots.acquire();
      Object.assign(message, { [operationInputResources]: () => {
        const open = hostOperationResources(lease, snapshots, 5);
        const signal = new AbortController().signal;
        return { signal, create: (input: { owner: PluginId; signal: AbortSignal }) => ({ signal: input.signal, resources: open({ message, ...input }) }) };
      } });
      try {
        const outcome = await executeInboundTurnSpine({
          message, lease, requester: rootPluginId(), conversationSequence: 5, ingressRoute: route,
          runHandlers: async () => undefined,
          dispatchInteractive: async () => undefined,
          dispatchCommand: observe => dispatcher.dispatchWithReply(message, lease.value, undefined, observe),
          hasReplied: () => false,
        });
        return { outcome, record: ledger.settle(), $reply };
      } finally { lease.release(); }
    };
    return { run, spine, route, snapshots, executeLeased, archiveSession, async close() { route.dispose(); await snapshots.close(); } };
  }

  it('routes nothing on a lease the Root store did not issue: a forged owner /clear clears nothing (#1250 第 85 批)', async () => {
    const f = clearFixture();
    const other = new SnapshotStore({ root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as never);
    try {
      // What a plugin could forge: a message from an "owner" asking to clear, and look-alike leases.
      const forged = () => {
        const ledger = new InboundOutcomeLedger({ conversation: privateChat, receivedAt: 1 });
        const $reply = vi.fn(async (_content: unknown) => ({ status: 'sent' }));
        const message = {
          conversation: privateChat, content: '/clear', endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN',
          sender: { id: 'alice', chatRole: 'owner', chatRoleLevels: { owner: 'global' } },
          message: { conversation: privateChat, id: 'forged-clear' }, $reply, [inboundOutcomeSink]: () => ledger,
        } as unknown as Message;
        return { message, $reply };
      };
      const real = f.snapshots.acquire();
      const released = f.snapshots.acquire();
      released.release();
      const foreign = other.acquire();
      const facade = createIngressRouteFacade(f.route);
      try {
        for (const lease of [
          { value: real.value, active: true, release() {} } as unknown as SnapshotLease,
          foreign,
          released,
        ]) {
          for (const hook of [f.route, facade]) {
            const { message, $reply } = forged();
            await expect(hook.preRoute!(message, lease, rootPluginId(), 5)).resolves.toBe(false);
            await expect(hook.route(message, lease, rootPluginId(), 5)).resolves.toBe(false);
            expect($reply).not.toHaveBeenCalled();
          }
        }
        expect(f.archiveSession).not.toHaveBeenCalled();
        expect(f.executeLeased).not.toHaveBeenCalled();
        // The same message on the IM runtime's own lease (one the Root store issued) does clear.
        const { message, $reply } = forged();
        await expect(facade.route(message, real, rootPluginId(), 5)).resolves.toBe(true);
        expect(f.archiveSession).toHaveBeenCalledOnce();
        expect($reply).toHaveBeenCalledOnce();
      } finally { real.release(); foreign.release(); }
    } finally { await other.close(); await f.close(); }
  });

  it('clears the sender’s private session on /clear and confirms once, without a model turn', async () => {
    const f = clearFixture();
    try {
      const { handled, record, $reply } = await f.run('/clear');
      expect(handled).toBe(true);
      expect(record).toMatchObject({ outcome: 'cleared', reason: 'clear_command', stage: 'agent_gate' });
      expect(f.archiveSession).toHaveBeenCalledOnce();
      expect(f.executeLeased).not.toHaveBeenCalled();
      expect($reply).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('已清空本会话的 AI 多轮上下文'));
      // The same personal session a triggered `清空` clears.
      await f.run('清空');
      expect(f.archiveSession).toHaveBeenCalledTimes(2);
      expect(f.archiveSession.mock.calls[1]![0]).toBe(f.archiveSession.mock.calls[0]![0]);
      // Another sender's private chat is another session.
      await f.run('/clear', { conversation: { endpoint, kind: 'private', id: 'bob' }, sender: 'bob' });
      expect(f.archiveSession.mock.calls[2]![0]).not.toBe(f.archiveSession.mock.calls[0]![0]);
    } finally { await f.close(); }
  });

  it('accepts a full-width slash and any letter case for /clear, /reset and /new', async () => {
    const f = clearFixture();
    try {
      for (const text of ['／CLEAR', '/New', '／ｒｅｓｅｔ']) {
        expect((await f.run(text)).record).toMatchObject({ outcome: 'cleared' });
      }
      expect(f.archiveSession).toHaveBeenCalledTimes(3);
      expect((await f.run('/clear all')).record.outcome).not.toBe('cleared');
      expect(f.archiveSession).toHaveBeenCalledTimes(3);
    } finally { await f.close(); }
  });

  it('does not repeat the confirmation for a quick repeat with nothing left to clear', async () => {
    const f = clearFixture();
    f.archiveSession.mockResolvedValueOnce(true).mockResolvedValue(false);
    try {
      const first = await f.run('/clear');
      const second = await f.run('/clear');
      expect(first.$reply).toHaveBeenCalledOnce();
      expect(second.handled).toBe(true);
      expect(second.$reply).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('in a group, clears only when the bot is mentioned, and only the sender’s own session', async () => {
    const f = clearFixture();
    try {
      const unmentioned = await f.run('/clear', { conversation: groupChat });
      expect(unmentioned.$reply).not.toHaveBeenCalled();
      expect(f.archiveSession).not.toHaveBeenCalled();
      const mentioned = await f.run('@zhin /clear', { conversation: groupChat, mentioned: true });
      expect(mentioned.record).toMatchObject({ outcome: 'cleared' });
      // The mention as a segment leaves `/clear` alone (an ignored trigger prefix): the untriggered path.
      await f.run('/clear', { conversation: groupChat, mentioned: true, sender: 'bob' });
      expect(f.archiveSession).toHaveBeenCalledTimes(2);
      expect(f.archiveSession.mock.calls[0]![0]).not.toBe(f.archiveSession.mock.calls[1]![0]);
    } finally { await f.close(); }
  });

  it('neither clears nor answers when the control plane stops the conversation or outbound, or the bot cannot speak', async () => {
    for (const options of [
      { control: { gate: () => stopped, outboundGate: () => stopped } },
      { control: { gate: () => ({ blocked: false }), outboundGate: () => stopped } },
      { cannotSpeak: true },
    ]) {
      const f = clearFixture(options);
      try {
        const { $reply } = await f.run('/clear');
        expect(f.archiveSession).not.toHaveBeenCalled();
        expect($reply).not.toHaveBeenCalled();
      } finally { await f.close(); }
    }
  });

  it('a triggered 清空 neither clears nor answers while outbound is stopped, like the slash spelling', async () => {
    const f = clearFixture({ control: { gate: () => ({ blocked: false }), outboundGate: () => stopped } });
    try {
      for (const text of ['清空', '#/clear']) {
        const { record, $reply } = await f.run(text);
        expect(record.outcome).not.toBe('cleared');
        expect($reply).not.toHaveBeenCalled();
      }
      expect(f.archiveSession).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('does not consult ai.access (no IM ingress path enforces it): the clear acts wherever the bot answers you', async () => {
    for (const access of [{ mode: 'closed' }, { mode: 'whitelist', users: ['someone-else'] }, { mode: 'whitelist', users: ['alice'] }]) {
      const f = clearFixture({ access });
      try {
        expect((await f.run('/clear')).record).toMatchObject({ outcome: 'cleared' });
        expect(f.archiveSession).toHaveBeenCalledOnce();
      } finally { await f.close(); }
    }
  });

  it('accepts a mention reported as metadata.mentioned, like the AI trigger', async () => {
    const f = clearFixture();
    try {
      const { record } = await f.run('/clear', { conversation: groupChat, metadata: { mentioned: true } });
      expect(record).toMatchObject({ outcome: 'cleared' });
      expect(f.archiveSession).toHaveBeenCalledOnce();
    } finally { await f.close(); }
  });

  it('accepts Telegram-style /clear@<bot> in a group only for this bot’s own handle', async () => {
    const f = clearFixture();
    try {
      for (const text of ['/clear@ZhinBot', '/reset@zhinbot', '/new@ZHINBOT']) {
        expect((await f.run(text, { conversation: groupChat, metadata: { botUsername: 'ZhinBot' } })).record).toMatchObject({ outcome: 'cleared' });
      }
      expect(f.archiveSession).toHaveBeenCalledTimes(3);
      for (const extra of [{ metadata: { botUsername: 'ZhinBot' } }, { metadata: {} }]) {
        const other = await f.run('/clear@OtherBot', { conversation: groupChat, ...extra });
        expect(other.record.outcome).not.toBe('cleared');
        expect(other.$reply).not.toHaveBeenCalled();
      }
      expect(f.archiveSession).toHaveBeenCalledTimes(3);
    } finally { await f.close(); }
  });

  it('leaves /reset to the management command when the command prefix claims it (command first)', async () => {
    const f = clearFixture();
    try {
      // Operator: the management Root command archives the session once (no second clear, no clear
      // confirmation), and its fixed confirmation is the only reply.
      const owner = await f.spine('/reset', { owner: true });
      expect(owner.outcome.stage).toBe('command');
      expect(owner.record).toMatchObject({ outcome: 'command_replied', command: 'reset' });
      expect(f.archiveSession).toHaveBeenCalledOnce();
      expect(owner.$reply).toHaveBeenCalledExactlyOnceWith('✅ 已归档当前会话，下次 @ 将使用新上下文');
      expect(f.executeLeased).not.toHaveBeenCalled();
      // It archives the same personal session a `/clear` through the Agent ingress clears.
      await f.run('/clear', { owner: true });
      expect(f.archiveSession).toHaveBeenCalledTimes(2);
      expect(f.archiveSession.mock.calls[1]![0]).toBe(f.archiveSession.mock.calls[0]![0]);
    } finally { await f.close(); }
  });

  it('runs /reset from a member as the chat clear command: same session, confirmation, mention rule and gates (#1250 第 83 批)', async () => {
    const f = clearFixture();
    try {
      // Private chat: exactly what `/clear` does — the sender's own session, the fixed clear confirmation, no model turn.
      const member = await f.spine('/reset');
      expect(member.outcome.stage).toBe('command');
      expect(member.record).toMatchObject({ outcome: 'command_replied', command: 'reset' });
      expect(member.record.facets).toContain('cleared:clear_command');
      expect(member.record).not.toMatchObject({ outcome: 'permission_denied' });
      expect(member.$reply).toHaveBeenCalledExactlyOnceWith('已清空本会话的 AI 多轮上下文。长期记忆和定时任务不受影响。');
      expect(f.archiveSession).toHaveBeenCalledOnce();
      expect(f.executeLeased).not.toHaveBeenCalled();
      await f.run('/clear');
      expect(f.archiveSession.mock.calls[1]![0]).toBe(f.archiveSession.mock.calls[0]![0]);
      // Group without a mention: like `/clear`, nothing is cleared and nothing is said — and the
      // outcome says so (#1250 第 84 批): no `command_replied` for a reset that did not clear.
      const unaddressed = await f.spine('/reset', { conversation: groupChat });
      expect(unaddressed.$reply).not.toHaveBeenCalled();
      expect(unaddressed.outcome.reply).toBeUndefined();
      expect(unaddressed.record).toMatchObject({ outcome: 'not_addressed', reason: 'clear_command', stage: 'agent_gate' });
      expect(unaddressed.record.facets).not.toContain('command_replied:executed');
      expect(f.archiveSession).toHaveBeenCalledTimes(2);
      expect(f.executeLeased).not.toHaveBeenCalled();
      // Group with a mention: the sender's own group session is cleared.
      const addressed = await f.spine('/reset', { conversation: groupChat, mentioned: true });
      expect(addressed.$reply).toHaveBeenCalledExactlyOnceWith('已清空本会话的 AI 多轮上下文。长期记忆和定时任务不受影响。');
      expect(f.archiveSession).toHaveBeenCalledTimes(3);
      expect(f.archiveSession.mock.calls[2]![0]).not.toBe(f.archiveSession.mock.calls[0]![0]);
      expect(f.executeLeased).not.toHaveBeenCalled();
    } finally { await f.close(); }
    // The clear's own gates hold: a control-plane stop or a muted sender clears nothing.
    for (const [options, reason] of [
      [{ control: { gate: () => stopped, outboundGate: () => stopped } }, 'control_emergency_stop'],
      [{ control: { gate: () => ({ blocked: false }), outboundGate: () => stopped } }, 'outbound_stopped'],
      [{ cannotSpeak: true }, 'cannot_speak_muted'],
    ] as const) {
      const g = clearFixture(options);
      try {
        const stoppedReset = await g.spine('/reset');
        expect(g.archiveSession).not.toHaveBeenCalled();
        expect(stoppedReset.$reply).not.toHaveBeenCalled();
        expect(stoppedReset.outcome.reply).toBeUndefined();
        expect(stoppedReset.record).toMatchObject({ outcome: 'filtered_by_policy', reason });
      } finally { await g.close(); }
    }
    // The AI trigger is off for private chats: no clear, like `/clear`.
    const off = clearFixture({ trigger: { respondToPrivate: false } });
    try {
      const silent = await off.spine('/reset');
      expect(off.archiveSession).not.toHaveBeenCalled();
      expect(silent.$reply).not.toHaveBeenCalled();
      expect(silent.record).toMatchObject({ outcome: 'not_addressed', reason: 'clear_command' });
    } finally { await off.close(); }
  });

  it('refuses a dispatch lease the Root\'s real store did not issue, on both management paths (#1250 第 84 批)', async () => {
    const f = clearFixture();
    try {
      const lease = f.snapshots.acquire();
      try {
        // Shaped like a lease on the real generation, but the store never issued it.
        const foreign = { value: lease.value, active: true, release: vi.fn() } as unknown as SnapshotLease;
        const message = { conversation: groupChat, content: '/reset', endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN', mentioned: true,
          sender: { id: 'alice' }, message: { conversation: groupChat, id: 'foreign-reset' }, $reply: vi.fn() } as unknown as Message;
        const dispatch = { signal: new AbortController().signal, retainLease: () => foreign };
        const run = vi.fn();
        // #1250 第 85 批: a sender-facing refusal (`refused` / `dispatch_lease_rejected`), not a plain failure.
        const rejected = { message: 'The dispatch lease does not belong to this Root', reason: 'dispatch_lease_rejected' };
        await expect(f.route.clearAsCommand(message, dispatch)).rejects.toMatchObject(rejected);
        await expect(f.route.runManagementOperation(message, dispatch, run)).rejects.toMatchObject(rejected);
        // #1250 第 85 批: a lease the real store issued is not enough either — whoever reaches the store
        // can `acquire()` one. Only a lease this Host's dispatch handed out runs.
        for (const direct of [() => f.snapshots.acquire(), () => f.snapshots.retain(lease)]) {
          const before = lease.active;
          await expect(f.route.clearAsCommand(message, { signal: dispatch.signal, retainLease: direct })).rejects.toMatchObject(rejected);
          await expect(f.route.runManagementOperation(message, { signal: dispatch.signal, retainLease: direct }, run)).rejects.toMatchObject(rejected);
          expect(lease.active).toBe(before);
        }
        expect(run).not.toHaveBeenCalled();
        expect(message.$reply).not.toHaveBeenCalled();
        // A lease the Host's own dispatch lease port retained still runs.
        const port = hostResources.im.open({ lease, snapshots: f.snapshots, message: message as never, owner: rootPluginId(), signal: dispatch.signal })!
          .use(dispatchLeaseToken);
        await expect(f.route.runManagementOperation(message, { signal: dispatch.signal, retainLease: () => port.retain() },
          async operation => operation.sessionKey)).resolves.toEqual(expect.any(String));
      } finally { lease.release(); }
      expect(f.archiveSession).not.toHaveBeenCalled();
      expect(f.executeLeased).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('releases a retained dispatch lease when the Host check throws, and refuses a dispatch without one (#1250 第 85 批)', async () => {
    const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
    const snapshots = new SnapshotStore(snapshot);
    const failure = new Error('holds check failed');
    const checks = { owns: (lease: SnapshotLease) => snapshots.owns(lease), holds: (_lease: SnapshotLease): boolean => { throw failure; } };
    const route = new AgentTurnIngressRoute({
      projectRoot: '/host-a', runtime: { executeLeased: vi.fn(), ownsLease: (lease: SnapshotLease) => checks.owns(lease) } as never,
      holdsDispatchLease: lease => checks.holds(lease),
      im: {} as never, ingress: {} as never,
      agent: { service: { getAgentConfig: () => ({}), getTriggerConfig: () => ({}) }, agent: {} } as never,
    });
    const message = { conversation: groupChat, content: '/reset', endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN', mentioned: true,
      sender: { id: 'alice' }, message: { conversation: groupChat, id: 'throwing-check' }, $reply: vi.fn() } as unknown as Message;
    const lease = snapshots.acquire();
    const run = vi.fn();
    try {
      const retained: SnapshotLease[] = [];
      const dispatch = { signal: new AbortController().signal, retainLease: () => { const next = snapshots.retain(lease); retained.push(next); return next; } };
      // `holdsDispatchLease` throws: the error propagates and the lease the dispatch retained is released.
      await expect(route.clearAsCommand(message, dispatch)).rejects.toBe(failure);
      await expect(route.runManagementOperation(message, dispatch, run)).rejects.toBe(failure);
      // `ownsLease` throws: likewise.
      checks.owns = () => { throw failure; };
      await expect(route.clearAsCommand(message, dispatch)).rejects.toBe(failure);
      await expect(route.runManagementOperation(message, dispatch, run)).rejects.toBe(failure);
      expect(retained).toHaveLength(4);
      expect(retained.every(entry => !entry.active)).toBe(true);
      expect(lease.active).toBe(true);
      // A dispatch without `retainLease` is refused on both paths alike.
      const rejected = { reason: 'dispatch_lease_rejected' };
      await expect(route.clearAsCommand(message, { signal: dispatch.signal })).rejects.toMatchObject(rejected);
      await expect(route.runManagementOperation(message, { signal: dispatch.signal }, run)).rejects.toMatchObject(rejected);
      expect(run).not.toHaveBeenCalled();
      expect(message.$reply).not.toHaveBeenCalled();
    } finally { lease.release(); route.dispose(); await snapshots.close(); }
  });

  it('keeps /reset from a member silent in a live room: no clear, no AI turn, outcome not_addressed (#1250 第 84 批)', async () => {
    const f = clearFixture({ live: true });
    try {
      for (const mentioned of [false, true]) {
        const live = await f.spine('/reset', { conversation: groupChat, mentioned });
        expect(live.outcome.stage).toBe('command');
        expect(live.$reply).not.toHaveBeenCalled();
        expect(live.record).toMatchObject({ outcome: 'not_addressed', reason: 'live_room_clear', stage: 'agent_gate' });
      }
      expect(f.archiveSession).not.toHaveBeenCalled();
      expect(f.executeLeased).not.toHaveBeenCalled();
      // Calling the clear path directly gives the same answer.
      const lease = f.snapshots.acquire();
      try {
        const ledger = new InboundOutcomeLedger({ conversation: groupChat, receivedAt: 1 });
        const message = { conversation: groupChat, content: '/reset', endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN', mentioned: true,
          sender: { id: 'alice' }, message: { conversation: groupChat, id: 'live-reset' }, $reply: vi.fn(), [inboundOutcomeSink]: () => ledger } as unknown as Message;
        const port = hostResources.im.open({ lease, snapshots: f.snapshots, message: message as never, owner: rootPluginId(),
          signal: new AbortController().signal })!.use(dispatchLeaseToken);
        await expect(f.route.clearAsCommand(message, { signal: new AbortController().signal, retainLease: () => port.retain() })).resolves.toBe(false);
        expect(ledger.settle()).toMatchObject({ outcome: 'not_addressed', reason: 'live_room_clear' });
      } finally { lease.release(); }
      expect(f.archiveSession).not.toHaveBeenCalled();
      expect(f.executeLeased).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('folds scene events up to the /reset message itself: the speaking gate gets its conversation sequence (#1250 第 84 批)', async () => {
    const observeInbound = vi.fn(async (_input: Record<string, unknown>) => ({ blocked: 'muted' as unknown }));
    const f = clearFixture({ observeInbound });
    try {
      const muted = await f.spine('/reset');
      expect(observeInbound).toHaveBeenCalledOnce();
      expect(observeInbound.mock.calls[0]![0]).toMatchObject({ throughSequence: 5 });
      expect(muted.record).toMatchObject({ outcome: 'filtered_by_policy', reason: 'cannot_speak_muted' });
      expect(f.archiveSession).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('is never reached when a plugin command already handled /clear (command first)', async () => {
    const f = clearFixture();
    try {
      const spine = (matched: boolean) => {
        const message = { conversation: privateChat, content: '/clear', endpointId: 'account-a', commandPrefix: '/', locale: 'zh-CN', sender: { id: 'alice' },
          message: { conversation: privateChat, id: 'm-1' }, $reply: vi.fn(async () => ({ status: 'sent' })) } as unknown as Message;
        const lease = f.snapshots.acquire();
        return executeInboundTurnSpine({
          message, lease, requester: rootPluginId(), conversationSequence: 5, ingressRoute: f.route,
          runHandlers: async () => undefined,
          dispatchInteractive: async () => undefined,
          dispatchCommand: async () => ({ dispatch: matched ? { matched: true, command: 'clear' } : { matched: false } }) as never,
          hasReplied: () => false,
        }).finally(() => lease.release());
      };
      const handled = await spine(true);
      expect(handled.stage).toBe('command');
      expect(f.archiveSession).not.toHaveBeenCalled();
      // Without a command for it, the same message reaches the Agent ingress and clears.
      const unhandled = await spine(false);
      expect(unhandled.stage).toBe('agent-ingress');
      expect(f.archiveSession).toHaveBeenCalledOnce();
    } finally { await f.close(); }
  });
});
