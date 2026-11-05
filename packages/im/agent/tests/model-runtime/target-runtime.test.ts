import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { normalizeProviderGraph, persistentProfileSelection, createProfileReference } from '@zhin.js/ai/provider';
import { graphFixture, runtimeFixture, context } from '../../../ai/tests/provider/fixtures.js';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { invocationModel } from '../../src/model-runtime/completion.js';
import { AIService } from '../../src/service.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { executionCandidate } from '../helpers/execution-bundle.js';

function snapshot() {
  const root = rootPluginId();
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map() };
  return new SnapshotStore(state);
}
function fixture() {
  const snapshots = snapshot();
  let graph = graphFixture();
  const created: ReturnType<typeof runtimeFixture>[] = [];
  const inference = { setGraph: (value: typeof graph) => { graph = value; },
    get calls() { return { created: created.reduce((total, item) => total + item.calls.created, 0) }; } };
  const runtime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: context.hostOwnerId,
    inferenceFactory: () => { const current = runtimeFixture({ graph }); created.push(current); return current.runtime; },
    context: () => context });
  const acquire = (extra: Partial<typeof context> = {}, bindingName?: string) => {
    const lease = snapshots.acquire();
    return runtime.acquireForContext({ lease, snapshots, context: { ...context, ...extra }, bindingName })
      .then(scope => ({ scope, lease }), error => { lease.release(); throw error; });
  };
  return { snapshots, inference, runtime, acquire };
}

it('starts the Agent service and facade without a model graph, credentials, or fake Provider', async () => {
  const service = new AIService();
  expect(service.isReady()).toBe(false);
  expect(service.getBindingRegistry().requireZhinBinding()).toEqual({ name: 'zhin', mcpServers: [], nickname: undefined, permission: undefined });
  const agent = new ZhinAgent();
  expect(() => agent.getTurnExecution()).toThrow('not configured');
  await agent.dispose(); await service.dispose();
});

it.each(['providers', 'modelCatalog', 'modelPolicy', 'defaultProvider', 'decisions'])('rejects %s as a second startup model authority', key => {
  expect(() => new AIService({ [key]: {} })).toThrow('migration required');
});

it('reads one graph per operation and changes the next turn without changing an in-flight selection', async () => {
  const f = fixture();
  const first = await f.acquire();
  const original = graphFixture();
  f.inference.setGraph(normalizeProviderGraph({ ...original, revision: 2,
    profiles: { ...original.profiles, text: { ...original.profiles.text, revision: 2, parameters: { maxOutputTokens: 321 } } } }));
  const second = await f.acquire();
  expect(first.scope.chat.binding.profile.revision).toBe(1);
  expect(second.scope.chat.binding.profile.revision).toBe(2);
  expect(first.scope.chat.model.maxTokens).toBe(8192);
  expect(second.scope.chat.model.maxTokens).toBe(321);
  await first.scope.release(); first.lease.release(); await second.scope.release(); second.lease.release();
});

it('uses current Profile parameters for a durable Session identity without inheriting account replacement', async () => {
  const f = fixture();
  const initial = await f.acquire();
  const selection = persistentProfileSelection(createProfileReference({ binding: initial.scope.chat.binding, kind: 'language' }));
  await initial.scope.release(); initial.lease.release();
  const original = graphFixture();
  f.inference.setGraph(normalizeProviderGraph({ ...original, revision: 2,
    profiles: { ...original.profiles, text: { ...original.profiles.text, revision: 2, parameters: { maxOutputTokens: 89 } } } }));
  const updated = await f.acquire({ sessionChat: selection });
  expect(updated.scope.chat.model.maxTokens).toBe(89);
  await updated.scope.release(); updated.lease.release();
  f.inference.setGraph(normalizeProviderGraph({ ...original, revision: 3,
    accounts: { ...original.accounts, account: { ...original.accounts.account, incarnation: 'replacement' } } }));
  await expect(f.acquire({ sessionChat: selection })).rejects.toThrow('stale-reference');
});

it('keeps summary on deployment chat when Session chat is overridden, and pins explicit role Profiles', async () => {
  const f = fixture();
  const original = graphFixture();
  const next = normalizeProviderGraph({ ...original,
    profiles: { ...original.profiles, other: { ...original.profiles.text, id: 'other', parameters: { maxOutputTokens: 91 } } },
    purposes: { ...original.purposes, agents: { reviewer: 'other' } } });
  f.inference.setGraph(next);
  const role = await f.acquire({}, 'reviewer');
  expect(role.scope.chat.binding.profile.id).toBe('other');
  expect(role.scope.summary?.binding.profile.id).toBe('text');
  expect(role.scope.summarySource).toBe('deployment-chat');
  await role.scope.release(); role.lease.release();
  await expect(f.acquire({}, 'missing')).rejects.toThrow('not-configured');
});

it('rejects a foreign context, another snapshot store, and cancelled acquisition before driver I/O', async () => {
  const f = fixture();
  await expect(f.acquire({ rootId: 'other' })).rejects.toThrow('invalid-context');
  const other = snapshot(); const foreign = other.acquire();
  await expect(f.runtime.acquireForContext({ lease: foreign, snapshots: f.snapshots, context })).rejects.toThrow('invalid-context');
  foreign.release();
  const lease = f.snapshots.acquire(); const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await expect(f.runtime.acquireForContext({ lease, snapshots: f.snapshots, context, signal: controller.signal })).rejects.toThrow('cancelled');
  expect(f.inference.calls.created).toBe(0); lease.release();
});

it('leaves undeclared native context capacity unknown and honors Profile output parameters', () => {
  const graph = graphFixture();
  const binding = { graphRevision: 1, service: graph.services.service, account: graph.accounts.account,
    profile: { ...graph.profiles.text, parameters: { maxOutputTokens: 20 } }, model: graph.services.service.models.text };
  expect(invocationModel(binding)).toMatchObject({ contextWindow: 0, maxTokens: 20 });
});

it('runs real agentLoop through Inference and the SDK using the selected Profile output limit', async () => {
  const { createInferenceRuntime } = await import('@zhin.js/ai/provider');
  const { openAiProvider } = await import('@zhin.js/ai/providers');
  const { chatReply } = await import('../../../ai/tests/providers/fixtures.js');
  const { createInvocationCompletion } = await import('../../src/model-runtime/completion.js');
  const requests: Request[] = [];
  const original = graphFixture();
  const graph = normalizeProviderGraph({ ...original,
    services: { service: { ...original.services.service,
      driver: { id: 'openai', owner: 'root/providers', contractVersion: '1' },
      options: { baseUrl: 'https://api.openai.com/v1' },
      models: { 'selected-model': { id: 'selected-model', kinds: ['language'], protocol: 'openai-chat',
        input: ['text'], contextWindow: 16000, maxOutputTokens: 4096 } } } },
    accounts: { account: { ...original.accounts.account, authentication: { method: 'api-key' } } },
    profiles: { text: { ...original.profiles.text, model: 'selected-model', parameters: { maxOutputTokens: 37 } } },
    purposes: { defaults: { chat: 'text' } },
  });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition: openAiProvider, release: () => undefined }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', headers: {}, revision: 'one' }) }),
    fetch: () => async (url, init) => { requests.push(new Request(url, init)); return chatReply('answer'); } });
  const scope = await runtime.openScope({ context });
  const binding = await scope.resolve({ kind: 'language', purpose: 'chat' });
  const chat = { binding, model: invocationModel(binding), completion: createInvocationCompletion({ binding, client: scope.client, purpose: 'chat' }) };
  const models = { chat, graph, context, inference: scope.client, resolve: scope.resolve,
    summarySource: 'deployment-chat' as const, policyRevision: 1, release: () => scope.close() };
  const service = new AIService();
  expect((await service.runAgent('Synthetic input', { models, maxIterations: 1 })).content).toBe('answer');
  expect(requests).toHaveLength(1);
  const body = await requests[0].json();
  expect(body).toMatchObject({ model: 'selected-model', max_tokens: 37 });
  expect(JSON.stringify(body)).not.toContain('synthetic-key');
  await scope.close(); runtime.retire(); await service.dispose();
});

it('imports the wizard-confirmed capabilities and sends real tool schemas through AgentLoop and the SDK', async () => {
  const { materializeAIPlan } = await import('../../../../toolkit/scaffold-wizard/src/ai.js');
  const { reviewProviderPlan, createEmptyProviderGraph, createInferenceRuntime } = await import('@zhin.js/ai/provider');
  const { openAiProvider } = await import('@zhin.js/ai/providers');
  const { chatReply } = await import('../../../ai/tests/providers/fixtures.js');
  const { createInvocationCompletion } = await import('../../src/model-runtime/completion.js');
  const draft = materializeAIPlan({ enabled: true, agentProvider: 'custom', providers: { custom: { sdk: 'openai', models: ['explicit-model'], capabilities: { toolCalling: true, streaming: true, input: ['text'] } } } });
  let sequence = 0;
  const reviewed = await reviewProviderPlan({ input: draft, graph: createEmptyProviderGraph('root'), ownerId: context.hostOwnerId, hostOwnerId: context.hostOwnerId,
    createId: kind => `${kind}:${++sequence}`, resolveService: input => {
      const service = { id: 'preview', rootId: 'root', ownerId: context.hostOwnerId, revision: 1,
        driver: { id: openAiProvider.id, owner: 'root/providers', contractVersion: '1' }, options: openAiProvider.serviceSchema.parse(input.options), models: input.models };
      return { driver: service.driver, options: service.options, models: openAiProvider.models(service) };
    } });
  const requests: Request[] = [];
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => reviewed.graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition: openAiProvider, release: () => undefined }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', headers: {}, revision: 'one' }) }),
    fetch: () => async (url, init) => { requests.push(new Request(url, init)); return chatReply('answer'); } });
  const scope = await runtime.openScope({ context }), binding = await scope.resolve({ kind: 'language', purpose: 'chat' });
  const chat = { binding, model: invocationModel(binding), completion: createInvocationCompletion({ binding, client: scope.client, purpose: 'chat' }) };
  const service = new AIService();
  const result = await service.runAgent('Synthetic question', { maxIterations: 1, models: { chat, summary: executionCandidate(chat), graph: scope.graph, context, inference: scope.client, inferenceSnapshot: scope.snapshot, resolve: scope.resolve,
    summarySource: 'deployment-chat', policyRevision: 1, retainDelegation: () => { throw new Error('No delegation expected'); }, release: () => scope.close() },
    tools: [{ name: 'lookup_fact', description: 'Read a synthetic fact', parameters: { type: 'object', properties: {} }, execute: async () => 'fact' }] });
  expect(result.content).toBe('answer'); expect(requests).toHaveLength(1);
  expect(await requests[0].json()).toMatchObject({ model: 'explicit-model', tools: [{ type: 'function', function: { name: 'lookup_fact' } }] });
  const { mockCommMessage } = await import('../helpers/mock-comm-message.js');
  const mainAgent = new ZhinAgent({ config: { outputSchema: false, deferredTools: { alwaysLoadedTools: ['lookup_fact'] } } });
  requests.length = 0;
  await mainAgent.processTurn({ content: 'Synthetic question', message: mockCommMessage(),
    configuration: { models: { chat, summary: executionCandidate(chat), graph: scope.graph, context, inference: scope.client, inferenceSnapshot: scope.snapshot, resolve: scope.resolve,
      summarySource: 'deployment-chat', policyRevision: 1, retainDelegation: () => { throw new Error('No delegation expected'); }, release: () => scope.close() } },
    tools: [{ name: 'lookup_fact', description: 'Read a synthetic fact', parameters: { type: 'object', properties: {} }, execute: async () => 'fact' }] });
  expect(requests).toHaveLength(1);
  const mainRequest = await requests[0].json();
  expect(mainRequest.model).toBe('explicit-model');
  expect(mainRequest.tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'lookup_fact' }) })]));
  await mainAgent.dispose();
  await scope.close(); runtime.retire(); await service.dispose();
});

it('lets a durable personal Session follow the same Profile to a new native model next turn while isolating old opaque history', async () => {
  const { modelRuntimeFixture } = await import('../helpers/model-runtime.js');
  const { assistant } = await import('../../../ai/tests/provider/fixtures.js');
  const seen: unknown[] = [];
  const f = modelRuntimeFixture({ execution: { language: { generate: async ({ request }) => {
    seen.push(request.context.messages);
    return { ...assistant('answer'), content: [{ type: 'thinking', thinking: 'readable reasoning', providerOptions: { openai: { reasoningEncryptedContent: 'synthetic-opaque-state' } } }, { type: 'text', text: 'answer' }] };
  }, stream: async () => (async function* () {})() } } });
  const first = await f.acquire({ ownerId: 'alice' });
  const selection = persistentProfileSelection(createProfileReference({ binding: first.chat.binding, kind: 'language' }));
  const oldAnswer = await first.chat.completion.complete(first.chat.model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }], timestamp: 1 }] });
  const graph = f.graph;
  f.update({ ...graph, revision: 2, services: { service: { ...graph.services.service, revision: 2, models: { ...graph.services.service.models, replacement: { ...graph.services.service.models.text, id: 'replacement' } } } },
    profiles: { ...graph.profiles, text: { ...graph.profiles.text, revision: 2, model: 'replacement' } } });
  const next = await f.acquire({ ownerId: 'alice', sessionChat: selection });
  expect(first.chat.model.id).toBe('text'); expect(next.chat.model.id).toBe('replacement');
  await first.chat.completion.complete(first.chat.model, { messages: [oldAnswer] });
  await next.chat.completion.complete(next.chat.model, { messages: [oldAnswer] });
  expect(JSON.stringify(seen[1])).toContain('synthetic-opaque-state');
  expect(JSON.stringify(seen[2])).not.toContain('synthetic-opaque-state');
  expect(JSON.stringify(seen[2])).toContain('answer');
  await first.release(); await next.release();
});


it('preserves Driver prompt-family and native deferred-tool behavior in the actual main Agent request', async () => {
  const { createInferenceRuntime } = await import('@zhin.js/ai/provider');
  const { anthropicProvider } = await import('@zhin.js/ai/providers');
  const { mockCommMessage } = await import('../helpers/mock-comm-message.js');
  const requests: Request[] = [];
  const original = graphFixture();
  const graph = normalizeProviderGraph({ ...original,
    services: { service: { ...original.services.service,
      driver: { id: 'anthropic', owner: 'root/providers', contractVersion: '1' },
      options: { baseUrl: 'https://api.anthropic.com/v1' },
      models: { selected: { id: 'selected', kinds: ['language'], protocol: 'anthropic-messages',
        input: ['text'], toolCalling: true, maxOutputTokens: 4096 } } } },
    accounts: { account: { ...original.accounts.account, authentication: { method: 'api-key' } } },
    profiles: { text: { ...original.profiles.text, model: 'selected', parameters: { maxOutputTokens: 100 } } },
    purposes: { defaults: { chat: 'text' } },
  });
  const snapshots = snapshot(), lease = snapshots.acquire();
  const modelsRuntime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: context.hostOwnerId, context: () => context,
    inferenceFactory: () => createInferenceRuntime({ repository: { readGraph: async () => graph },
      drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition: anthropicProvider, release() {} }) },
      credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', headers: {}, revision: 'one' }) }),
      fetch: () => async (url, init) => { requests.push(new Request(url, init)); return Response.json({ id: 'local-message', type: 'message', role: 'assistant', model: 'selected',
        content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 2 } }); } }) });
  const models = await modelsRuntime.acquireForContext({ snapshots, lease, context });
  expect(models.chat.model).toMatchObject({ promptFamily: 'anthropic', nativeDeferredTools: true });
  const agent = new ZhinAgent({ config: { outputSchema: false, deferredTools: { alwaysLoadedMode: 'replace', alwaysLoadedTools: ['lookup_fact'] } } });
  try {
    await agent.processTurn({ content: 'Synthetic question', message: mockCommMessage(), configuration: { models },
      tools: ['lookup_fact', 'inspect_record'].map(name => ({ name, description: `Read ${name}`, parameters: { type: 'object', properties: {} }, execute: async () => 'fact' })) });
    expect(requests).toHaveLength(1);
    const body = await requests[0].json();
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'lookup_fact' }),
      expect.objectContaining({ name: 'inspect_record', defer_loading: true }),
    ]));
    expect(body.tools.find((tool: { name: string }) => tool.name === 'lookup_fact').defer_loading).not.toBe(true);
    expect(JSON.stringify(body.system)).toContain('SDK (Anthropic)');
    expect(JSON.stringify(body.system)).toContain('Prefer structured tool_use');
  } finally { await agent.dispose(); await models.release(); lease.release(); modelsRuntime.dispose(); }
});
