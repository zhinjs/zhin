import { z } from 'zod';
import { createScopedMediaPerceptionPort } from '../../src/media/scoped-perception.js';
import { AiHttpTransport, createSdkProviderAdapter, createUserMessage, createLlmApiRuntime, sdkEntryFromProvider } from '@zhin.js/ai';
import { createModelCatalog, type ModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import { ModelRuntimeService, legacyAgentPresetId, type ModelRuntimeConfig } from '../../src/model-runtime/index.js';

const origin = { platform: 'sandbox', endpoint: 'bot', conversation: { endpoint: { adapter: 'sandbox', id: 'adapter' }, kind: 'group' as const, id: 'group' } };
const turn = { origin, rootId: 'root', ownerId: 'alice' };
const host = 'host/root';
function legacy(): ModelRuntimeConfig {
  return { providers: { main: { sdk: 'openai-compatible', apiKey: 'host-secret', baseUrl: 'https://host.test/v1', models: ['main-model', 'review-model'], headers: { 'X-Private': 'private-value' }, maxRetries: 7, maxOutputTokens: 321, capabilities: { toolCalling: true } } },
    agents: { zhin: { provider: 'main', model: 'main-model', mcpServers: ['host-mcp'], permission: { task: { '*': 'deny' } } }, reviewer: { provider: 'main', model: 'review-model' } }, mcpServers: [{ name: 'host-mcp', command: 'mock' }] };
}
function personal(revision = 1, ownerId = 'alice'): ModelCatalogConfig {
  return { connections: { 'personal-connection': { id: 'personal-connection', ownerId, revision, sdk: 'openai-compatible', baseUrl: `https://personal-${revision}.test/v1`, secretRef: 'personal-key' } },
    models: { 'personal-model': { id: 'personal-model', connectionId: 'personal-connection', model: `model-${revision}`, capabilities: { input: ['text', 'image'] }, contextWindow: 12345, maxOutputTokens: 456 } },
    presets: { personal: { id: 'personal', modelId: 'personal-model' } } };
}
const noNetwork = vi.fn(async () => { throw new Error('unexpected network'); });
function service(config: ModelRuntimeConfig = legacy(), snapshot?: () => ModelCatalogConfig | Promise<ModelCatalogConfig | undefined>) {
  return new ModelRuntimeService({ config, hostOwnerId: host,
    personalCatalogSnapshot: snapshot, secretResolver: async () => 'personal-secret',
    personalFetchFactory: () => noNetwork,
    hostTransportFactory: () => new AiHttpTransport({ fetch: noNetwork }),
  });
}
afterEach(() => vi.clearAllMocks());

describe('ModelRuntimeService', () => {
  it('compiles legacy aliases once and keeps credentials, headers, MCP and permissions out of catalog', async () => {
    const runtime = service();
    const resolved = await runtime.resolveForTurn(turn);
    expect(resolved.chat.preset.id).toBe(legacyAgentPresetId('zhin'));
    expect(resolved.summary?.preset.id).toBe(resolved.chat.preset.id);
    expect(JSON.stringify(runtime.getCatalogConfig())).not.toMatch(/host-secret|private-value|host-mcp|permission/);
    const scope = await runtime.acquireForTurn(turn);
    expect(scope.chat.provider.name).toBe('main');
    expect(scope.chat.llmRuntime.providerConfig('main')).toMatchObject({ apiKey: 'host-secret', headers: { 'X-Private': 'private-value' }, maxRetries: 7, maxOutputTokens: 321 });
    expect(noNetwork).not.toHaveBeenCalled();
    await scope.release(); await runtime.dispose();
  });

  it('does not consult the personal repository for Host or non-IM defaults', async () => {
    const snapshot = vi.fn(async () => { throw new Error('personal repository unavailable'); });
    const runtime = service(legacy(), snapshot);
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host, sessionSelection: { kind: 'preset', presetId: 'missing' } });
    expect(scope.chat.invocation.model.model).toBe('main-model');
    expect(snapshot).not.toHaveBeenCalled();
    await scope.release(); await runtime.dispose();
  });

  it('requires an explicit personal transport and never falls back to global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const secrets = vi.fn(async () => 'secret');
    const runtime = new ModelRuntimeService({ config: legacy(), hostOwnerId: host, personalCatalogSnapshot: async () => personal(), secretResolver: secrets });
    await expect(runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'personal' } })).rejects.toThrow('personal-transport-unavailable');
    expect(secrets).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    await runtime.dispose(); globalFetch.mockRestore();
  });

  it('preserves only the configured legacy perception fallback chain', async () => {
    const config = legacy();
    const vision = { sdk: 'openai-compatible' as const, baseUrl: 'https://vision.test/v1', apiKey: 'vision-secret', models: ['vision-main', 'vision-backup'], input: ['text', 'image'] as const };
    const runtime = service({ ...config, providers: { ...config.providers, vision }, multimodal: { perception: { provider: 'vision', model: 'vision-main', fallbacks: [{ provider: 'vision', model: 'vision-backup' }] } } });
    const scope = await runtime.acquireForTurn(turn);
    expect(scope.perception?.invocation.model.model).toBe('vision-main');
    expect(scope.perceptionFallbacks?.map(bundle => bundle.invocation.model.model)).toEqual(['vision-backup']);
    expect(Object.isFrozen(scope.perceptionFallbacks)).toBe(true);
    await scope.release(); await runtime.dispose();
    const explicit = service({ ...config, providers: { ...config.providers, vision }, multimodal: { perception: { provider: 'vision', model: 'vision-main', fallbacks: [{ provider: 'vision', model: 'vision-backup' }] } }, modelPolicy: { defaults: { chat: legacyAgentPresetId('zhin'), perception: legacyAgentPresetId('reviewer') } } });
    const other = await explicit.acquireForTurn(turn);
    expect(other.perceptionFallbacks).toBeUndefined();
    await other.release(); await explicit.dispose();
  });

  it('compiles a mixed explicit catalog plus the complete legacy perception chain before execution', async () => {
    const requests: string[] = [];
    const fetch = vi.fn(async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model;
      requests.push(model);
      if (model === 'vision-main') return new Response('synthetic failure', { status: 500 });
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"vision-backup","choices":[{"index":0,"delta":{"role":"assistant","content":"seen"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"vision-backup","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const config: ModelRuntimeConfig = {
      modelCatalog: personal(1, host), modelPolicy: { defaults: { chat: 'personal' } },
      providers: {
        vision: { sdk: 'openai-compatible', baseUrl: 'https://vision.test/v1', apiKey: 'vision-key', input: ['text', 'image'] },
        backup: { sdk: 'openai-compatible', baseUrl: 'https://backup.test/v1', apiKey: 'backup-key', input: ['text', 'image'] },
      },
      multimodal: { perception: { provider: 'vision', model: 'vision-main', fallbacks: [{ provider: 'backup', model: 'vision-backup' }] } },
    };
    const runtime = new ModelRuntimeService({ config, hostOwnerId: host, secretResolver: async () => 'chat-key', hostTransportFactory: () => new AiHttpTransport({ fetch }) });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(scope.perception?.invocation.model.model).toBe('vision-main');
    expect(scope.perceptionFallbacks?.map(bundle => bundle.invocation.model.model)).toEqual(['vision-backup']);
    expect(requests).toEqual([]);
    const port = createScopedMediaPerceptionPort({ scope, resilience: { maxRetries: 0 } });
    const result = await port!.describe({ kind: 'image', base64: 'AA==', mimeType: 'image/png' });
    expect(result?.text).toBe('seen');
    expect(requests).toEqual(['vision-main', 'vision-backup']);
    await scope.release(); await runtime.dispose();
    const override = service({ ...config, modelPolicy: { defaults: { chat: 'personal', perception: 'personal' } } });
    const changed = await override.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(changed.perception?.invocation.preset.id).toBe('personal');
    expect(changed.perceptionFallbacks).toBeUndefined();
    await changed.release(); await override.dispose();
    expect(() => service({ ...config, providers: {} })).toThrow('not defined in ai.providers');
    expect(() => service({ ...config, modelCatalog: { ...config.modelCatalog!, presets: { ...config.modelCatalog!.presets, 'legacy:perception': { id: 'legacy:perception', modelId: 'personal-model' } } } })).toThrow('catalog-conflict');
  });

  it.each([
    { streaming: false },
    { streaming: true, toolCalling: false },
  ])('rejects explicitly unsupported streaming/tools at actual completion before any HTTP', async capabilities => {
    const catalog = personal(1, host);
    const modelCatalog = { ...catalog, models: { 'personal-model': { ...catalog.models['personal-model'], capabilities } } };
    const runtime = service({ modelCatalog, modelPolicy: { defaults: { chat: 'personal' } } });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    const model = scope.chat.llmRuntime.model(scope.chat.provider.name, 'model-1');
    const context = { systemPrompt: 'test', messages: [createUserMessage('hi')], tools: [{ name: 'tool', description: 'test', parameters: z.object({}) }] };
    await expect(scope.chat.llmRuntime.complete(model, context)).rejects.toThrow('unsupported-capability');
    await expect(scope.chat.llmRuntime.completeSimple(model, context)).rejects.toThrow('unsupported-capability');
    expect(noNetwork).not.toHaveBeenCalled();
    await scope.release(); await runtime.dispose();
  });

  it('reuses the scoped runtime and SDK LanguageModel for the same fixed snapshot across turns', async () => {
    const runtime = service();
    const first = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    const sdkModel = first.chat.llmRuntime.resolveLanguageModel('main', 'main-model');
    await first.release();
    const second = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(second.chat.llmRuntime).toBe(first.chat.llmRuntime);
    expect(second.chat.llmRuntime.resolveLanguageModel('main', 'main-model')).toBe(sdkModel);
    await second.release(); await runtime.dispose();
  });

  it('isolates scoped caches when capabilities/window snapshots or owners differ', async () => {
    let alice = personal();
    const runtime = new ModelRuntimeService({ config: legacy(), hostOwnerId: host,
      personalCatalogSnapshot: async owner => owner === 'alice' ? alice : personal(1, owner), secretResolver: async () => 'secret', personalFetchFactory: () => noNetwork });
    const select = { kind: 'preset' as const, presetId: 'personal' };
    const first = await runtime.acquireForTurn({ ...turn, sessionSelection: select });
    const firstModel = first.chat.llmRuntime.resolveLanguageModel(first.chat.provider.name, 'model-1');
    alice = { ...alice, models: { 'personal-model': { ...alice.models['personal-model'], contextWindow: 54321, capabilities: { input: ['text'], toolCalling: true } } } };
    const changed = await runtime.acquireForTurn({ ...turn, sessionSelection: select });
    expect(changed.chat.provider).toBe(first.chat.provider);
    expect(changed.chat.llmRuntime).not.toBe(first.chat.llmRuntime);
    expect(changed.chat.llmRuntime.resolveLanguageModel(changed.chat.provider.name, 'model-1')).not.toBe(firstModel);
    expect(changed.chat.llmRuntime.model(changed.chat.provider.name, 'model-1').contextWindow).toBe(54321);
    expect(first.chat.llmRuntime.model(first.chat.provider.name, 'model-1').contextWindow).toBe(12345);
    const bob = await runtime.acquireForTurn({ ...turn, ownerId: 'bob', sessionSelection: select });
    expect(bob.chat.provider).not.toBe(first.chat.provider);
    expect(bob.chat.llmRuntime).not.toBe(first.chat.llmRuntime);
    await first.release(); await changed.release(); await bob.release(); await runtime.dispose();
  });

  it('rejects a forged completion descriptor before HTTP even when callers bypass model()', async () => {
    const runtime = service();
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    const allowed = scope.chat.llmRuntime.model('main', 'main-model');
    const context = { systemPrompt: 'test', messages: [createUserMessage('hi')] };
    for (const patch of [{ id: 'other-model' }, { provider: 'other-provider' }, { sdk: 'anthropic' as const }]) {
      await expect(scope.chat.llmRuntime.complete({ ...allowed, ...patch }, context)).rejects.toThrow('invalid-config');
    }
    expect(noNetwork).not.toHaveBeenCalled();
    await scope.release(); await runtime.dispose();
  });

  it('preserves Cloudflare accountId admission on the actual legacy-origin connection inside a mixed catalog', async () => {
    const runtime = service({ modelCatalog: personal(1, host), modelPolicy: { defaults: { chat: 'personal' } },
      providers: { vision: { sdk: 'openai-compatible', accountId: 'synthetic-account', models: ['vision'], input: ['text', 'image'] } } as ModelRuntimeConfig['providers'],
      multimodal: { perception: { provider: 'vision', model: 'vision' } } });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(scope.perception?.provider.name).toBe('vision');
    expect(scope.perception?.invocation.connection.baseUrl).toBe('https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1');
    expect(scope.perception?.llmRuntime.providerConfig('vision')?.accountId).toBe('synthetic-account');
    await scope.release(); await runtime.dispose();
  });

  it.each([undefined, 'explicit-target'])('preserves actual SDK vendor namespaces independently of execution aliases (camel target=%s)', async target => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const modelCatalog: ModelCatalogConfig = {
      connections: { main: { id: 'main', ownerId: host, revision: 1, sdk: 'openai-compatible', baseUrl: 'https://model.test/v1', secretRef: 'vault:key' } },
      models: { model: { id: 'model', connectionId: 'main', model: 'model', capabilities: {} } },
      presets: { model: { id: 'model', modelId: 'model' } },
    };
    const runtime = new ModelRuntimeService({ hostOwnerId: host, secretResolver: async () => 'key', hostTransportFactory: () => new AiHttpTransport({ fetch }), config: {
      modelCatalog, modelPolicy: { defaults: { chat: 'model' } }, providers: { main: { sdk: 'openai-compatible', baseUrl: 'https://model.test/v1', apiKey: 'key', providerOptions: {
        'openai-compatible': { synthetic_vendor: 'source' }, ...(target ? { openaiCompatible: { synthetic_vendor: target } } : {}),
      } } },
    } });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(scope.chat.provider.name).toBe('catalog:main');
    await scope.chat.llmRuntime.complete(scope.chat.llmRuntime.model('catalog:main', 'model'), { systemPrompt: 'test', messages: [createUserMessage('hi')] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].synthetic_vendor).toBe(target ?? 'source');
    await scope.release(); await runtime.dispose();
  });

  it('rejects personal-owned connections in deployment catalog before any purpose can use a personal key', () => {
    const owned = personal(1, host);
    const foreign: ModelCatalogConfig = {
      connections: { foreign: { ...owned.connections['personal-connection'], id: 'foreign', ownerId: 'alice' } },
      models: { foreign: { ...owned.models['personal-model'], id: 'foreign', connectionId: 'foreign' } },
      presets: { foreign: { id: 'foreign', modelId: 'foreign' } },
    };
    const catalog: ModelCatalogConfig = { connections: { ...owned.connections, ...foreign.connections }, models: { ...owned.models, ...foreign.models }, presets: { ...owned.presets, ...foreign.presets } };
    const secretResolver = vi.fn(async () => 'personal-secret');
    expect(() => new ModelRuntimeService({ hostOwnerId: host, secretResolver, config: { modelCatalog: catalog, modelPolicy: { defaults: { chat: 'personal', summary: 'foreign' } } } })).toThrow('deployment-owner-mismatch');
    expect(secretResolver).not.toHaveBeenCalled();
    expect(noNetwork).not.toHaveBeenCalled();
    expect(createModelCatalog(catalog).resolve('foreign', { ownerId: 'alice', hostOwnerId: host }).connection.ownerId).toBe('alice');
  });

  it.each([
    { maxOutputTokens: 0 }, { maxOutputTokens: -1 }, { contextWindow: 0 }, { contextWindow: -1 },
  ])('preserves legacy SDK defaults for non-positive provider metadata: %j', async values => {
    const config = legacy();
    const providerConfig = { ...config.providers!.main, ...values };
    const baseline = createSdkProviderAdapter('main', providerConfig, new AiHttpTransport({ fetch: noNetwork }))!;
    const originalModel = createLlmApiRuntime([sdkEntryFromProvider(baseline)], () => baseline.models).model('main', 'main-model');
    const runtime = service({ ...config, providers: { main: providerConfig } });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    const actual = scope.chat.llmRuntime.model('main', 'main-model');
    expect(actual.maxTokens).toBe(originalModel.maxTokens);
    expect(actual.contextWindow).toBe(originalModel.contextWindow);
    for (const key of Object.keys(values)) expect(scope.chat.invocation.model).not.toHaveProperty(key);
    await scope.release(); await runtime.dispose(); await baseline.dispose();
    const explicit = personal(1, host);
    expect(() => service({ modelCatalog: { ...explicit, models: { 'personal-model': { ...explicit.models['personal-model'], ...values } } }, modelPolicy: { defaults: { chat: 'personal' } } })).toThrow('invalid-config');
  });

  it('uses configured defaultModel/models[0], never guesses a model', async () => {
    const config = legacy();
    const runtime = service({ ...config, agents: { zhin: { provider: 'main' } } });
    expect((await runtime.resolveForTurn(turn)).chat.model.model).toBe('main-model');
    await runtime.dispose();
    expect(() => service({ providers: { main: { sdk: 'ollama', host: 'http://localhost:11434' } }, agents: { zhin: { provider: 'main' } } })).toThrow('migration-model-missing');
  });

  it('uses one personal snapshot and freezes its model for the full acquired turn', async () => {
    let current = personal();
    const snapshot = vi.fn(async () => current);
    const runtime = service(legacy(), snapshot);
    const scope = await runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'personal' } });
    current = personal(2);
    const next = await runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'personal' } });
    expect(scope.chat.invocation.connection.revision).toBe(1);
    expect(scope.chat.invocation.model.model).toBe('model-1');
    expect(next.chat.invocation.connection.revision).toBe(2);
    expect(snapshot).toHaveBeenCalledTimes(2);
    const model = scope.chat.llmRuntime.model(scope.chat.provider.name, 'model-1');
    expect(model).toMatchObject({ input: ['text', 'image'], contextWindow: 12345, maxTokens: 456 });
    expect(() => scope.chat.llmRuntime.model(scope.chat.provider.name, 'model-2')).toThrow();
    expect(scope.summary?.provider.name).toBe('main');
    await scope.release(); await next.release(); await runtime.dispose();
  });

  it('rejects missing, foreign-owned and conflicting selections without trying Host chat', async () => {
    const runtime = service(legacy(), () => personal());
    await expect(runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'missing' } })).rejects.toThrow('unknown-preset');
    await expect(runtime.acquireForTurn({ ...turn, ownerId: 'bob', sessionSelection: { kind: 'preset', presetId: 'personal' } })).rejects.toThrow('connection-forbidden');
    const hostCatalog = runtime.getCatalogConfig();
    const conflict = service(legacy(), () => ({ ...hostCatalog, connections: Object.fromEntries(Object.entries(hostCatalog.connections).map(([id, connection]) => [id, { ...connection, baseUrl: 'https://different.test' }])) }));
    await expect(conflict.resolveForTurn(turn)).rejects.toThrow('catalog-conflict');
    expect(noNetwork).not.toHaveBeenCalled();
    await runtime.dispose(); await conflict.dispose();
  });

  it('uses explicit catalog and policy without legacy provider or agent configuration', async () => {
    const catalog = personal(1, host);
    const runtime = service({ modelCatalog: catalog, modelPolicy: { defaults: { chat: 'personal' } } });
    const scope = await runtime.acquireForTurn(turn);
    expect(scope.chat.invocation.model.model).toBe('model-1');
    expect(scope.summary?.invocation.preset.id).toBe('personal');
    expect(scope.perception).toBeUndefined();
    await scope.release(); await runtime.dispose();
    expect(() => service({ modelCatalog: catalog })).toThrow('migration-default-missing');
  });

  it('normalizes omitted summary to deployment chat before personal chat selection', async () => {
    const original = service();
    const hostCatalog = original.getCatalogConfig();
    const runtime = service({ modelCatalog: hostCatalog, modelPolicy: { defaults: { chat: legacyAgentPresetId('zhin') } } }, () => personal());
    expect(runtime.getPolicyConfig().defaults.summary).toBe(legacyAgentPresetId('zhin'));
    const scope = await runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'personal' } });
    expect(scope.chat.invocation.connection.ownerId).toBe('alice');
    expect(scope.summary?.invocation.connection.ownerId).toBe(host);
    expect(scope.summary?.invocation.preset.id).toBe(legacyAgentPresetId('zhin'));
    await scope.release(); await runtime.dispose(); await original.dispose();
  });

  it('keeps explicit role presets independent of personal IM chat selection', async () => {
    const runtime = service(legacy(), () => personal());
    const scope = await runtime.acquireForTurn({ ...turn, bindingName: 'reviewer', sessionSelection: { kind: 'preset', presetId: 'personal' } });
    expect(scope.chat.invocation.model.model).toBe('review-model');
    expect(scope.chat.invocation.connection.ownerId).toBe(host);
    await scope.release(); await runtime.dispose();
  });

  it('borrows an existing Host provider without losing its fetch or disposing its owner', async () => {
    const provider = createSdkProviderAdapter('main', legacy().providers!.main, new AiHttpTransport({ fetch: noNetwork }))!;
    const disposed = vi.spyOn(provider, 'dispose');
    const runtime = new ModelRuntimeService({ config: legacy(), hostOwnerId: host, hostProviders: new Map([['main', provider]]) });
    const scope = await runtime.acquireForTurn(turn);
    expect(scope.chat.provider).toBe(provider);
    expect(scope.chat.llmRuntime.providerConfig('main')?.apiKey).toBe('host-secret');
    await scope.release(); await runtime.dispose();
    expect(disposed).not.toHaveBeenCalled();
    await provider.dispose();
  });

  it('does not borrow a stale Host endpoint or secret for an explicit connection sharing its old alias', async () => {
    const old = legacy().providers!.main;
    const provider = createSdkProviderAdapter('main', old, new AiHttpTransport({ fetch: noNetwork }))!;
    const catalog = personal(1, host);
    const modelCatalog: ModelCatalogConfig = {
      ...catalog,
      connections: { main: { ...catalog.connections['personal-connection'], id: 'main', baseUrl: 'https://new-host.test/v1', secretRef: 'vault:new' } },
      models: { ...catalog.models, 'personal-model': { ...catalog.models['personal-model'], connectionId: 'main' } },
    };
    const secrets = vi.fn(async () => 'new-host-secret');
    const runtime = new ModelRuntimeService({ config: { providers: { main: old }, modelCatalog, modelPolicy: { defaults: { chat: 'personal' } } }, hostOwnerId: host,
      hostProviders: new Map([['main', provider]]), secretResolver: secrets, hostTransportFactory: () => new AiHttpTransport({ fetch: noNetwork }) });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    expect(scope.chat.provider).not.toBe(provider);
    expect(scope.chat.provider.name).toBe('catalog:main');
    expect(scope.chat.llmRuntime.providerConfig('catalog:main')).toMatchObject({ baseUrl: 'https://new-host.test/v1', apiKey: 'new-host-secret' });
    expect(secrets).toHaveBeenCalledTimes(1);
    await scope.release(); await runtime.dispose(); await provider.dispose();
  });

  it('uses the SDK default when an explicit connection omits baseUrl instead of inheriting a legacy destination', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer new-key');
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"new-model","choices":[{"index":0,"delta":{"role":"assistant","content":"default"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"new-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const old = { ...legacy().providers!.main, sdk: 'openai' as const, host: 'https://old-host.test' };
    const modelCatalog: ModelCatalogConfig = {
      connections: { main: { id: 'main', ownerId: host, revision: 1, sdk: 'openai', secretRef: 'vault:new' } },
      models: { selected: { id: 'selected', connectionId: 'main', model: 'new-model', capabilities: {} } },
      presets: { selected: { id: 'selected', modelId: 'selected' } },
    };
    const runtime = new ModelRuntimeService({ config: { providers: { main: old }, modelCatalog, modelPolicy: { defaults: { chat: 'selected' } } }, hostOwnerId: host, secretResolver: async () => 'new-key', hostTransportFactory: () => new AiHttpTransport({ fetch }) });
    const scope = await runtime.acquireForTurn({ rootId: 'root', ownerId: host });
    const config = scope.chat.llmRuntime.providerConfig('catalog:main');
    expect(config).not.toHaveProperty('baseUrl');
    expect(config).not.toHaveProperty('host');
    expect(config).not.toHaveProperty('accountId');
    expect(config?.apiKey).toBe('new-key');
    expect(scope.chat.llmRuntime.model('catalog:main', 'new-model').baseUrl).toBeUndefined();
    await scope.chat.llmRuntime.complete(scope.chat.llmRuntime.model('catalog:main', 'new-model'), { systemPrompt: 'test', messages: [createUserMessage('hi')] });
    expect(urls).toEqual(['https://api.openai.com/v1/chat/completions']);
    await scope.release(); await runtime.dispose();
  });

  it('executes only the fixed personal model with its own endpoint and secret using fake HTTP', async () => {
    const requests: { url: string; model: string; authorization: string | null }[] = [];
    const fetch = vi.fn(async (url, init) => {
      requests.push({ url: String(url), model: JSON.parse(String(init?.body)).model, authorization: new Headers(init?.headers).get('Authorization') });
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model-1","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const runtime = new ModelRuntimeService({ config: legacy(), hostOwnerId: host, personalCatalogSnapshot: async () => personal(), secretResolver: async () => 'personal-secret', personalFetchFactory: () => fetch });
    const scope = await runtime.acquireForTurn({ ...turn, sessionSelection: { kind: 'preset', presetId: 'personal' } });
    const result = await scope.chat.llmRuntime.completeSimple(scope.chat.llmRuntime.model(scope.chat.provider.name, scope.chat.invocation.model.model), { systemPrompt: 'test', messages: [createUserMessage('hi')] });
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'hello' })]));
    expect(requests).toEqual([{ url: 'https://personal-1.test/v1/chat/completions', model: 'model-1', authorization: 'Bearer personal-secret' }]);
    expect(JSON.stringify(scope.chat.invocation)).not.toContain('personal-secret');
    await scope.release(); await runtime.dispose();
  });
});
