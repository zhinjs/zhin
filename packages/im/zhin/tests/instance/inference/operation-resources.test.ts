import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore, rootPluginId, childPluginId, createCapabilitySlot, createRootPrivateToken, type SnapshotState } from '@zhin.js/plugin-runtime';
import { RuntimeMessage } from '@zhin.js/core/runtime';
import type { TurnRequest } from '@zhin.js/agent';
import {
  aiInferenceClientToken,
  aiProviderDefinitionsToken,
  type InferenceClient,
  type ProviderDefinition,
  type ProviderGraph,
} from '@zhin.js/ai/provider';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { HostInference } from '@zhin.js/agent/runtime';
import { createHostOperationResources } from '@zhin.js/agent/runtime';
import { openAiProvider } from '../../../../ai/src/providers/api-key.js';
import { CommandIndex, commandFeatureId, defineCommand } from '../../../../command/src/index.js';
import { ToolIndex, toolFeatureId, defineAgentTool } from '../../../../tool/src/index.js';
import { dispatchLeaseToken, dispatchLeaseWithheldToken } from '../../../../agent/src/plugin-runtime/inference/dispatch-lease.js';
import { createRuntimeManagementCommands } from '../../../../agent/src/init/runtime-management-commands.js';

async function fixture(native = false, plugins: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'inference-capability-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const root = rootPluginId(), requests = vi.fn(async () => native ? Response.json({ id: 'synthetic', object: 'chat.completion', created: 1,
    model: 'native', choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic SDK result' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }) : new Response('synthetic image'));
  vi.stubGlobal('fetch', requests);
  const definition: ProviderDefinition<unknown, unknown> = native ? openAiProvider : { id: 'fixture', contractVersion: '1',
    serviceSchema: { parse: value => value }, authentication: { methods: ['none'] }, models: service => service.models,
    targets: () => ({ authentication: [], inference: ['https://synthetic.test/image'] }),
    createExecution({ fetch, context, credentials }) { return { image: { generate: async ({ signal }) => {
      const target = new URL('https://synthetic.test/image');
      const grant = await credentials.authorize({ target, signal });
      await fetch(credentials.bindRequest({ grant, request: new Request(target, { method: 'POST', signal, body: 'synthetic' }) }));
      return { model: 'image', mimeType: 'image/png', base64: context.ownerId };
    } } }; },
  };
  const children = plugins.map(name => childPluginId(root, name));
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: directory, children }],
    ...children.map((id, index) => [id, { id, parent: root, instanceKey: plugins[index]!, packageName: plugins[index]!, packageRoot: join(directory, plugins[index]!), children: [] }] as const)]),
    config: new Map(), resources: new Map([[root, new Map([[aiProviderDefinitionsToken.id, [{ owner: root, definition }]]])], ...children.map(id => [id, new Map()] as const)]),
    capabilities: new Map(), projections: new Map() };
  const snapshots = new SnapshotStore(state), resolveSource = vi.fn();
  const host = new HostInference({ projectRoot: directory, database: db, snapshots: () => snapshots, resolveSource, personalOwners: [] });
  const graph: ProviderGraph = { rootId: host.rootId, revision: 1, services: { service: { id: 'service', rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1,
    driver: { id: definition.id, owner: root, contractVersion: '1' }, options: native ? { baseUrl: 'https://synthetic.test/v1' } : {},
    models: native ? { native: { id: 'native', kinds: ['language'], protocol: 'openai-chat', input: ['text'] } } : { image: { id: 'image', kinds: ['image'], protocol: 'fixture' } } } },
    accounts: { account: { id: 'account', rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1, serviceId: 'service', incarnation: 'first', authentication: { method: native ? 'api-key' : 'none' } } },
    profiles: { profile: { id: 'profile', rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1, accountId: 'account', model: native ? 'native' : 'image', parameters: native ? { maxRetries: 0 } : {} } },
    purposes: { defaults: native ? { chat: 'profile' } : { image: 'profile' } } };
  await db.start(); await host.repository.commit({ rootId: host.rootId, expectedRevision: 0, mutationId: 'create', fingerprint: 'create', graph, result: null });
  if (native) await host.accounts.putKey({ account: graph.accounts.account!, key: 'synthetic-api-key', expectedRevision: 0, authContractVersion: '1' });
  const quota = { check: vi.fn(() => ({ allowed: true as const })), checkTokens: vi.fn(() => ({ allowed: true as const })), record: vi.fn() };
  const ports = createHostOperationResources({ host, quota });
  const conversation = { endpoint: { adapter: 'root', id: 'root\0zhin.adapter\0qq' }, kind: 'group' as const, id: 'group' };
  const signal = new AbortController().signal;
  const message = new RuntimeMessage({ conversation, content: 'hello', endpointId: 'account', sender: { id: 'alice', roles: ['user'] } },
    { generation: snapshots.current.generation, clientAdapter: 'qq', signal, reply: vi.fn() });
  const turn: TurnRequest = { identity: { traceId: 'trace', turnId: 'turn' }, origin: { kind: 'im', platform: 'qq', endpoint: 'account', scope: 'group', sceneId: 'group', conversation },
    principal: { subjectId: 'alice', roles: ['user'] }, intent: { kind: 'new' }, input: { text: 'hello' }, session: { key: 'scene-task' },
    policy: { permissions: ['user'], unattended: false }, signal, ports: {} };
  return { host, snapshots, quota, ports, root, message, turn, signal, requests, resolveSource,
    async close() { vi.unstubAllGlobals(); await host.close(); await snapshots.close(); await db.stop(); await rm(directory, { recursive: true, force: true }); } };
}

it('does no model/secret/quota work for has/use, an unconsumed stream or a closed unused capability', async () => {
  const f = await fixture(), lease = f.snapshots.acquire();
  try {
    const read = vi.spyOn(f.host.repository, 'readGraph');
    const view = f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner: f.root, signal: f.signal })!;
    expect(view.has(aiInferenceClientToken)).toBe(true);
    const client = view.use(aiInferenceClientToken);
    // The stream request is deliberately never consumed; no configured language profile is required.
    const run = await client.stream({ request: { context: { systemPrompt: '', messages: [] } } });
    await run.close(); await view.close();
    expect(read).not.toHaveBeenCalled(); expect(f.requests).not.toHaveBeenCalled();
    expect(f.resolveSource).not.toHaveBeenCalled(); expect(f.quota.check).not.toHaveBeenCalled(); expect(f.quota.record).not.toHaveBeenCalled();
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});

it('exposes the dispatching generation to an IM command operation only, by token identity (#1250 第 83 批)', async () => {
  const f = await fixture(), lease = f.snapshots.acquire();
  try {
    const im = f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner: f.root, signal: f.signal })!;
    const tool = f.ports.agent.open({ lease, snapshots: f.snapshots, request: f.turn, owner: f.root, signal: f.signal })!;
    expect(im.has(dispatchLeaseToken)).toBe(true);
    expect(tool.has(dispatchLeaseToken)).toBe(false);
    // A look-alike token with the same id is not the dispatch lease.
    const lookalike = createRootPrivateToken('zhin.agent.dispatch-lease');
    expect(im.has(lookalike)).toBe(false);
    expect(() => im.use(lookalike)).toThrow('Resource is not available in this operation');
    const dispatched = lease.value.generation;
    // A newer generation is published meanwhile: the command still retains the one that dispatched it.
    f.snapshots.commit(dispatched, { snapshot: { ...lease.value, generation: dispatched + 1 } as never, dispose() {} });
    expect(f.snapshots.current.generation).toBe(dispatched + 1);
    const retained = im.use(dispatchLeaseToken).retain();
    expect(retained.value.generation).toBe(dispatched);
    expect(f.snapshots.owns(retained)).toBe(true);
    retained.release();
    expect(lease.active).toBe(true);
    await im.close(); await tool.close();
  } finally { lease.release(); await f.close(); }
});

it('offers the dispatch lease only to a Root-owned IM operation, never a plugin command (#1250 第 84 批)', async () => {
  const f = await fixture(), lease = f.snapshots.acquire();
  try {
    const plugin = childPluginId(f.root, 'some-plugin');
    const view = f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner: plugin, signal: f.signal })!;
    expect(view.has(dispatchLeaseToken)).toBe(false);
    expect(() => view.use(dispatchLeaseToken)).toThrow('Resource is not available in this operation');
    // The plugin still gets its inference client.
    expect(view.has(aiInferenceClientToken)).toBe(true);
    await view.close();
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});

it('a plugin command that names the Root as owner still gets no dispatch lease (#1250 第 84 批)', async () => {
  const f = await fixture(false, ['some-plugin']), lease = f.snapshots.acquire();
  const plugin = childPluginId(f.root, 'some-plugin');
  const opened: { owner: string; delegatedFrom?: string }[] = [];
  const message = new RuntimeMessage({ conversation: f.message.conversation, content: 'grab', endpointId: 'account', sender: { id: 'alice', roles: ['user'] } }, {
    generation: lease.value.generation, snapshot: lease.value, clientAdapter: 'qq', signal: f.signal, reply: vi.fn(),
    createOperationResources: input => {
      opened.push({ owner: input.owner, ...(input.delegatedFrom ? { delegatedFrom: input.delegatedFrom } : {}) });
      return f.ports.im.open({ ...input, lease, snapshots: f.snapshots });
    },
  });
  // The global symbols a plugin can reach; the command executor binds the view to the command's owner.
  const snapshotHook = Symbol.for('zhin.operation-input-snapshot/1');
  const resourcesHook = Symbol.for('zhin.operation-input-resources/1');
  const bindingHook = Symbol.for('zhin.operation-input-binding/1');
  type Hooked = Record<symbol, (...args: unknown[]) => unknown>;
  type Created = { resources?: { has(token: unknown): boolean; close(): Promise<void> } };
  const attempts: string[] = [];
  const command = createCapabilitySlot({ owner: plugin, feature: commandFeatureId, localName: 'grab', source: '/commands/grab/index.ts',
    definition: defineCommand({ execute: async context => {
      const input = context.input as unknown as Hooked;
      const snapshot = input[snapshotHook]!() as typeof lease.value;
      // Its own operation (created by the executor for the plugin) has no dispatch lease.
      expect(() => context.use(dispatchLeaseToken)).toThrow();
      const factory = input[resourcesHook]!(snapshot) as { signal: AbortSignal; create(i: { owner: string; signal: AbortSignal }): Created };
      // Naming the Root from its own view opens nothing at all (and never throws).
      const own = factory.create({ owner: snapshot.root, signal: factory.signal });
      attempts.push(`own view: ${own.resources === undefined ? 'no resources' : 'resources'}`);
      // Rebinding its message to the Root does not launder the claim: the Root operation is delegated.
      const rebound = input[bindingHook]!(snapshot.root, snapshot) as Hooked;
      const reboundFactory = rebound[resourcesHook]!(snapshot) as typeof factory;
      const laundered = reboundFactory.create({ owner: snapshot.root, signal: factory.signal });
      attempts.push(`rebound: lease ${laundered.resources?.has(dispatchLeaseToken) ? 'granted' : 'withheld'}, `
        + `marker ${laundered.resources?.has(dispatchLeaseWithheldToken)}, inference ${laundered.resources?.has(aiInferenceClientToken)}`);
      await laundered.resources?.close();
      return 'done';
    } }) });
  try {
    const result = await new CommandIndex([command], lease.value).dispatch({ input: 'grab', source: message });
    expect(result).toMatchObject({ status: 'executed', value: 'done' });
    expect(attempts).toEqual(['own view: no resources', 'rebound: lease withheld, marker true, inference true']);
    // The executor's operation for the plugin, then the laundered Root one — opened delegated.
    expect(opened).toEqual([{ owner: plugin }, { owner: f.root, delegatedFrom: plugin }]);
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});

it('runs a Root command a plugin dispatched with the Root\'s resources but without the dispatch lease (#1250 第 84 批)', async () => {
  const f = await fixture(false, ['p', 'q']), lease = f.snapshots.acquire();
  const p = childPluginId(f.root, 'p'), q = childPluginId(f.root, 'q');
  const opened: { owner: string; delegatedFrom?: string }[] = [];
  const message = new RuntimeMessage({ conversation: f.message.conversation, content: 'x', endpointId: 'account', sender: { id: 'alice', roles: ['user'] } }, {
    generation: lease.value.generation, snapshot: lease.value, clientAdapter: 'qq', signal: f.signal, reply: vi.fn(),
    createOperationResources: input => {
      opened.push({ owner: input.owner, ...(input.delegatedFrom ? { delegatedFrom: input.delegatedFrom } : {}) });
      return f.ports.im.open({ ...input, lease, snapshots: f.snapshots });
    },
  });
  const bindingHook = Symbol.for('zhin.operation-input-binding/1');
  type Binder = Record<symbol, (owner: string, snapshot: unknown) => RuntimeMessage>;
  const bind = (view: RuntimeMessage, owner: string) => (view as unknown as Binder)[bindingHook]!(owner, lease.value);
  const seen: string[] = [];
  const probe = (label: string) => defineCommand({ execute: context => {
    seen.push(`${label}: lease ${context.has(dispatchLeaseToken)}, marker ${context.has(dispatchLeaseWithheldToken)}, inference ${context.has(aiInferenceClientToken)}`);
    return label;
  } });
  const slots = [
    createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName: 'rootcmd', source: '/commands/rootcmd/index.ts', definition: probe('root') }),
    createCapabilitySlot({ owner: q, feature: commandFeatureId, localName: 'qcmd', source: '/commands/qcmd/index.ts', definition: probe('q') }),
  ];
  const index = new CommandIndex(slots, lease.value);
  try {
    // Root's own dispatch (Core's dispatcher holds the unbound view): the lease is there.
    await index.dispatch({ input: 'rootcmd', source: message });
    // A plugin middleware dispatching a Root command: it runs, keeps the inference client, no lease.
    await index.dispatch({ input: 'rootcmd', source: bind(message, p) });
    // The same with an explicit snapshot that is the message's own: the same resources.
    await index.dispatch({ input: 'rootcmd', source: bind(message, p), snapshot: lease.value });
    // P → Q: Q's own command operation.
    await index.dispatch({ input: 'qcmd', source: bind(message, p) });
    // P → Q → Root and Root → P → Root: delegated, recorded as P.
    const pq = bind(bind(message, p), q);
    await index.dispatch({ input: 'rootcmd', source: pq });
    const rootPRoot = bind(bind(message, f.root), p);
    await index.dispatch({ input: 'rootcmd', source: rootPRoot });
    // A Root middleware (its own view) dispatching a Root command keeps the lease.
    await index.dispatch({ input: 'rootcmd', source: bind(message, f.root) });
    expect(seen).toEqual([
      'root: lease true, marker false, inference true',
      'root: lease false, marker true, inference true',
      'root: lease false, marker true, inference true',
      'q: lease false, marker false, inference true',
      'root: lease false, marker true, inference true',
      'root: lease false, marker true, inference true',
      'root: lease true, marker false, inference true',
    ]);
    // Multi-hop rebinding records the first plugin author: P → Q → Root and Root → P → Root are P's.
    expect(opened).toEqual([
      { owner: f.root }, { owner: f.root, delegatedFrom: p }, { owner: f.root, delegatedFrom: p },
      { owner: q, delegatedFrom: p }, { owner: f.root, delegatedFrom: p }, { owner: f.root, delegatedFrom: p }, { owner: f.root },
    ]);
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});

it('answers an Agent management command a plugin dispatched with a request to send it directly (#1250 第 84 批)', async () => {
  const f = await fixture(false, ['buttons']), lease = f.snapshots.acquire();
  const plugin = childPluginId(f.root, 'buttons');
  const message = new RuntimeMessage({ conversation: f.message.conversation, content: 'btn', endpointId: 'account',
    sender: { id: 'alice', roles: ['user'] } }, {
    generation: lease.value.generation, snapshot: lease.value, clientAdapter: 'qq', signal: f.signal, reply: vi.fn(),
    createOperationResources: input => f.ports.im.open({ ...input, lease, snapshots: f.snapshots }),
  });
  const open = vi.fn(), clear = vi.fn();
  const slots = createRuntimeManagementCommands({ zhinAgent: {} as never, open, clear }).map(command => createCapabilitySlot({
    owner: f.root, feature: commandFeatureId, localName: command.name, source: `/agent/${command.name}`, definition: command.definition }));
  const bindingHook = Symbol.for('zhin.operation-input-binding/1');
  const pluginView = (message as unknown as Record<symbol, (owner: string, snapshot: unknown) => RuntimeMessage>)[bindingHook]!(plugin, lease.value);
  try {
    const index = new CommandIndex(slots, lease.value);
    // `reset` has no permit (the others need a chat role, checked before they run).
    const result = await index.dispatch({ input: 'reset', source: pluginView, locale: 'en' });
    expect(result).toMatchObject({ matched: true, status: 'executed', refused: true, refusalReason: 'direct_command_required',
      value: 'ℹ️ This command cannot run when a plugin forwards it. Send reset directly.' });
    expect(open).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});

it('uses personal IM ownership, token-only admitted Tool accounting and independently closes each real client', async () => {
  const f = await fixture(), lease = f.snapshots.acquire();
  const views: Array<{ close(): Promise<void> }> = [];
  try {
    const im = f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner: f.root, signal: f.signal })!;
    const tool = f.ports.agent.open({ lease, snapshots: f.snapshots, request: f.turn, owner: f.root, signal: f.signal })!;
    views.push(im, tool);
    const commandClient = im.use(aiInferenceClientToken), toolClient = tool.use(aiInferenceClientToken);
    const generated = await commandClient.generateImage({ request: { prompt: 'synthetic image' } });
    expect(generated.base64).not.toBe(f.host.hostOwnerId);
    // Normal Command admission counts the group request once; submit rechecks tokens only.
    expect(f.quota.check).toHaveBeenCalledOnce(); expect(f.quota.checkTokens).toHaveBeenCalledTimes(1);
    expect(f.quota.check.mock.calls[0]?.[0]).toEqual({ userId: 'alice', groupId: 'qq:account:group', owner: false });
    await im.close();
    await expect(toolClient.generateImage({ request: { prompt: 'second synthetic image' } })).resolves.toMatchObject({ base64: f.host.hostOwnerId });
    // The admitted Tool checks tokens at begin and submit, never a second group-rate slot.
    expect(f.quota.check).toHaveBeenCalledOnce(); expect(f.quota.checkTokens).toHaveBeenCalledTimes(3);
    expect(f.quota.record.mock.calls.reduce((sum, [, tokens]) => sum + tokens, 0)).toBeGreaterThan(0); expect(f.requests).toHaveBeenCalledTimes(2);
    expect(lease.active).toBe(true); await tool.close();
    await expect(commandClient.generateImage({ request: { prompt: 'closed' } })).rejects.toMatchObject({ code: 'operation-closed' });
  } finally { await Promise.all(views.map(view => view.close())); lease.release(); await f.close(); }
});

it('denies quota before model transport and keeps a failed submitted request reservation', async () => {
  const f = await fixture(), lease = f.snapshots.acquire();
  let client: InferenceClient | undefined;
  try {
    f.quota.check.mockImplementationOnce(() => ({ allowed: false, message: 'synthetic quota', scope: 'user', retryAfterSeconds: 1 }) as never);
    const view = f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner: f.root, signal: f.signal })!;
    client = view.use(aiInferenceClientToken);
    await expect(client.generateImage({ request: { prompt: 'denied' } })).rejects.toMatchObject({ name: 'AiCompletionQuotaError' });
    expect(f.requests).not.toHaveBeenCalled(); expect(f.quota.record).not.toHaveBeenCalled();
    f.requests.mockRejectedValueOnce(new Error('synthetic response unknown'));
    await expect(client.generateImage({ request: { prompt: 'submitted synthetic image' } })).rejects.toMatchObject({ code: 'transport' });
    expect(f.requests).toHaveBeenCalledOnce(); expect(f.quota.record).toHaveBeenCalledOnce();
    await view.close();
  } finally { lease.release(); await client?.close(); await f.close(); }
});

it('shares only the captured graph with an admitted Tool and leaves its parent client usable after Tool close', async () => {
  const f = await fixture(), lease = f.snapshots.acquire(), runtime = f.host.createInference(lease);
  const parent = await runtime.openScope({ context: { rootId: f.host.rootId, hostOwnerId: f.host.hostOwnerId, ownerId: f.host.hostOwnerId,
    operationId: f.turn.identity.turnId, sessionKey: f.turn.session.key } });
  const tool = f.ports.agent.open({ lease, snapshots: f.snapshots, request: f.turn, owner: f.root, signal: f.signal, inferenceSnapshot: parent.snapshot })!;
  try {
    await tool.use(aiInferenceClientToken).generateImage({ request: { prompt: 'tool image' } });
    await tool.close();
    await expect(parent.client.generateImage({ request: { prompt: 'parent image' } })).resolves.toMatchObject({ model: 'image' });
    expect(f.requests).toHaveBeenCalledTimes(2);
    expect(f.quota.check).not.toHaveBeenCalled(); expect(f.quota.checkTokens).toHaveBeenCalledTimes(2);
  } finally { await tool.close(); await parent.close(); runtime.retire(); lease.release(); await f.close(); }
});

it('uses the official Command and Tool contexts through the real OpenAI SDK, Host credentials/network and quota submit boundary', async () => {
  const f = await fixture(true), lease = f.snapshots.acquire();
  const request = { context: { systemPrompt: '', messages: [{ role: 'user' as const, timestamp: 1, content: [{ type: 'text' as const, text: 'hello' }] }] } };
  const command = createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName: 'infer', source: '/commands/infer/index.ts',
    definition: defineCommand({ execute: context => context.use(aiInferenceClientToken).generate({ request }) }) });
  const tool = createCapabilitySlot({ owner: f.root, feature: toolFeatureId, localName: 'infer', source: '/tools/infer/index.ts',
    definition: defineAgentTool({ description: 'Offline inference fixture', execute: (_input, context) => context.use(aiInferenceClientToken).generate({ request }) }) });
  const commandClose = vi.fn(), toolClose = vi.fn();
  const factory = (kind: 'im' | 'agent') => ({ signal: f.signal, create: ({ owner, signal }: { owner: typeof f.root; signal: AbortSignal }) => {
    const view = kind === 'im' ? f.ports.im.open({ lease, snapshots: f.snapshots, message: f.message, owner, signal })!
      : f.ports.agent.open({ lease, snapshots: f.snapshots, request: f.turn, owner, signal })!;
    return { signal, resources: { has: view.has, use: view.use, close: async () => { (kind === 'im' ? commandClose : toolClose)(); await view.close(); } } };
  } });
  try {
    const result = await new CommandIndex([command], lease.value).dispatch({ input: 'infer', source: f.message, operation: factory('im') });
    expect(result).toMatchObject({ status: 'executed', value: { content: [{ text: 'synthetic SDK result' }], usage: { totalTokens: 10 } } });
    const invoked = await new ToolIndex([tool], lease.value).execute({ requester: f.root, name: 'infer', input: {}, invocation: {
      signal: f.signal, traceId: 'trace', turnId: 'turn', sessionKey: f.turn.session.key, origin: f.turn.origin, principal: f.turn.principal,
      policy: { ...f.turn.policy, network: { enabled: true } },
    }, operation: factory('agent') });
    expect(invoked).toMatchObject({ content: [{ text: 'synthetic SDK result' }], usage: { totalTokens: 10 } });
    expect(f.quota.check).toHaveBeenCalledTimes(1); expect(f.quota.checkTokens).toHaveBeenCalledTimes(3);
    expect(f.quota.check.mock.calls[0]![0]).toEqual({ userId: 'alice', groupId: 'qq:account:group', owner: false });
    expect(commandClose).toHaveBeenCalledTimes(1); expect(toolClose).toHaveBeenCalledTimes(1); expect(f.requests).toHaveBeenCalledTimes(2);
    for (const [input, init] of f.requests.mock.calls) {
      const wire = new Request(input, init);
      expect(wire.url).toBe('https://synthetic.test/v1/chat/completions'); expect(wire.headers.get('authorization')).toBe('Bearer synthetic-api-key');
      expect(await wire.json()).toMatchObject({ model: 'native', messages: expect.any(Array) });
    }
    expect(lease.active).toBe(true);
  } finally { lease.release(); await f.close(); }
});
