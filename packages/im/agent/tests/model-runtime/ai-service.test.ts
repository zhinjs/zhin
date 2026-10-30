import { getLogger } from '@zhin.js/logger';
import * as standalone from '../../src/core/agent-loop-standalone.js';
import { AIService } from '../../src/service.js';
import { AiHttpTransport, createSdkProviderAdapter, createUserMessage } from '@zhin.js/ai';
import { legacyModelPresetId } from '../../src/model-runtime/compiler.js';
import type { ModelCatalogConfig } from '@zhin.js/ai/model-catalog';

const hostOwnerId = 'host/root';
const catalog: ModelCatalogConfig = {
  connections: { local: { id: 'local', ownerId: hostOwnerId, revision: 1, sdk: 'openai-compatible', baseUrl: 'https://host.test/v1', secretRef: 'vault:host-key' } },
  models: { model: { id: 'model', connectionId: 'local', model: 'chosen-model', capabilities: { input: ['text'] }, contextWindow: 16000, maxOutputTokens: 400 } },
  presets: { chat: { id: 'chat', modelId: 'model' } },
};
const explicit = { modelCatalog: catalog, modelPolicy: { defaults: { chat: 'chat', summary: 'chat' } } };

afterEach(() => vi.restoreAllMocks());

describe('AIService canonical model runtime preparation', () => {
  it('prepares an explicit catalog with no legacy providers/agents before Host runtime construction', async () => {
    const service = new AIService(explicit);
    expect(service.isReady()).toBe(false);
    expect(() => service.getModelRuntime()).toThrow('not prepared');
    const personalSnapshot = vi.fn(async () => { throw new Error('Host must not consult personal catalog'); });
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'host-secret', personalCatalogSnapshot: personalSnapshot });
    expect(service.isReady()).toBe(true);
    expect(service.getProvider().name).toBe('local');
    expect(service.getLlmRuntime().model('local', 'chosen-model').id).toBe('chosen-model');
    expect(service.getBindingRegistry().requireZhinBinding()).toMatchObject({ providerAlias: 'local', model: 'chosen-model' });
    expect(service.getModelRuntime()).toBeDefined();
    expect(personalSnapshot).not.toHaveBeenCalled();
    expect(JSON.stringify(service.getRoutingConfig())).not.toContain('host-secret');
    await service.dispose();
  });

  it('validates mixed legacy perception aliases before compatibility routing exists and keeps the complete chain', async () => {
    const service = new AIService({ ...explicit, providers: { vision: { sdk: 'openai-compatible', apiKey: 'key', baseUrl: 'https://vision.test/v1', input: ['text', 'image'] } },
      multimodal: { perception: { provider: 'vision', model: 'vision-main', fallbacks: [{ provider: 'vision', model: 'vision-backup' }] } } });
    expect(service.getPerceptionConfig()?.fallbacks).toEqual([{ provider: 'vision', model: 'vision-backup' }]);
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'chat-key' });
    const scope = await service.getModelRuntime().acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    expect(scope.perception?.invocation.model.model).toBe('vision-main');
    expect(scope.perceptionFallbacks?.map(bundle => bundle.invocation.model.model)).toEqual(['vision-backup']);
    await scope.release(); await service.dispose();
  });

  it('selects the one effective default for IM, standalone and system requests across two SDK providers', async () => {
    const requests: { url: string; model: string; authorization: string | null }[] = [];
    const fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(url), model: body.model, authorization: new Headers(init?.headers).get('Authorization') });
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"next-model","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"next-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const old = { sdk: 'openai-compatible' as const, apiKey: 'old-key', baseUrl: 'https://old.test/v1', models: ['old-model'] };
    const next = { sdk: 'openai' as const, apiKey: 'next-key', baseUrl: 'https://next.test/v1', models: ['next-model'] };
    const authority = { nickname: 'Primary', mcpServers: ['readonly'], permission: { task: { '*': 'deny' } } };
    const service = new AIService({ providers: { old, next },
      agents: { zhin: { provider: 'old', model: 'old-model', ...authority } },
      modelPolicy: { defaults: { chat: legacyModelPresetId('next', 'next-model') } },
      mcpServers: [{ name: 'readonly', command: 'mock' }],
    });
    for (const [name, config] of Object.entries({ old, next })) {
      await service.registerProvider(createSdkProviderAdapter(name, config, new AiHttpTransport({ fetch }))!);
    }
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getProvider().name).toBe('next');
    expect(service.getBindingRegistry().requireZhinBinding()).toMatchObject({ providerAlias: 'next', model: 'next-model', ...authority });
    const runtime = service.getModelRuntime();
    const im = await runtime.acquireForTurn({ rootId: 'root', ownerId: hostOwnerId,
      origin: { platform: 'sandbox', endpoint: 'bot', conversation: { endpoint: { adapter: 'sandbox', id: 'entry' }, kind: 'group', id: 'group' } } });
    const context = { systemPrompt: 'test', messages: [createUserMessage('hi')] };
    await im.chat.llmRuntime.complete(im.chat.llmRuntime.model(im.chat.provider.name, im.chat.invocation.model.model), context);
    const standalone = await service.runAgent('standalone');
    expect(standalone.content).toBe('done');
    const system = await runtime.acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    await system.chat.llmRuntime.complete(system.chat.llmRuntime.model(system.chat.provider.name, system.chat.invocation.model.model), context);
    expect([im.chat.invocation.connection.sdk, system.chat.invocation.connection.sdk]).toEqual(['openai', 'openai']);
    expect(requests).toEqual(Array.from({ length: 3 }, () => ({ url: 'https://next.test/v1/chat/completions', model: 'next-model', authorization: 'Bearer next-key' })));
    await im.release(); await system.release(); await service.dispose();
  });

  it('allows authority-only explicit zhin metadata to use deployment chat without duplicating its preset', async () => {
    const authority = { nickname: '', mcpServers: ['readonly'], permission: { task: { '*': 'deny' } } };
    const service = new AIService({ ...explicit, agents: { zhin: authority }, mcpServers: [{ name: 'readonly', command: 'mock' }] });
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'key' });
    expect(service.getBindingRegistry().requireZhinBinding()).toMatchObject({ providerAlias: 'local', model: 'chosen-model', ...authority });
    expect(service.getModelRuntime().presetForBinding('zhin')).toBe('chat');
    await service.dispose();
    const badReference = new AIService({ ...explicit, agents: { zhin: { preset: 'missing', ...authority } }, mcpServers: [{ name: 'readonly', command: 'mock' }] });
    await expect(badReference.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'key' })).rejects.toThrow('invalid-config');
    await badReference.dispose();
    const missingRole = new AIService({ ...explicit, agents: { reviewer: { nickname: 'Missing preset' } } });
    await expect(missingRole.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'key' })).rejects.toThrow('invalid-config');
    await missingRole.dispose();
  });

  it('preserves legacy authority fields and borrows the synchronously constructed Provider', async () => {
    const service = new AIService({ providers: { main: { sdk: 'openai', apiKey: 'host-secret', models: ['selected-model'] } },
      agents: { zhin: { provider: 'main', model: 'selected-model', nickname: 'Z', mcpServers: ['readonly'], permission: { task: { '*': 'deny' } } } }, mcpServers: [{ name: 'readonly', command: 'mock' }] });
    const original = service.getProvider();
    const dispose = vi.spyOn(original as { dispose(): Promise<void> }, 'dispose');
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getProvider()).toBe(original);
    expect(service.getBindingRegistry().requireZhinBinding()).toMatchObject({ nickname: 'Z', mcpServers: ['readonly'], permission: { task: { '*': 'deny' } } });
    await service.dispose(); await service.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not dispose a replaced legacy Provider twice on final shutdown', async () => {
    const service = new AIService({ providers: { main: { sdk: 'openai', apiKey: 'old-key' } }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const old = service.getProvider();
    const oldDispose = vi.spyOn(old as { dispose(): Promise<void> }, 'dispose');
    const next = createSdkProviderAdapter('main', { sdk: 'openai', apiKey: 'new-key' })!;
    const nextDispose = vi.spyOn(next, 'dispose');
    await service.registerProvider(next);
    await service.dispose();
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(nextDispose).toHaveBeenCalledTimes(1);
  });

  it('rejects registration after shutdown without accepting ownership of the incoming Provider', async () => {
    const service = new AIService({ providers: { main: { sdk: 'openai', apiKey: 'key' } }, agents: { zhin: { provider: 'main', model: 'model' } } });
    await service.dispose();
    const incoming = createSdkProviderAdapter('next', { sdk: 'openai', apiKey: 'synthetic' }, new AiHttpTransport())!;
    const incomingDispose = vi.spyOn(incoming, 'dispose');
    await expect(service.registerProvider(incoming)).rejects.toThrow('disposed');
    expect(incomingDispose).not.toHaveBeenCalled();
    expect(service.isReady()).toBe(false);
    await incoming.dispose();
  });

  it('drains a registration started before shutdown without committing or owning its incoming Provider', async () => {
    const service = new AIService({ providers: { main: { sdk: 'openai', apiKey: 'key' } }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const previous = service.getProvider('main') as ReturnType<typeof createSdkProviderAdapter> & {};
    let finishPrevious!: () => void;
    const pending = new Promise<void>(resolve => { finishPrevious = resolve; });
    const closePrevious = previous!.dispose.bind(previous);
    const previousDispose = vi.spyOn(previous!, 'dispose').mockImplementation(async () => { await pending; await closePrevious(); });
    const incoming = createSdkProviderAdapter('main', { sdk: 'openai', apiKey: 'synthetic' }, new AiHttpTransport())!;
    const incomingDispose = vi.spyOn(incoming, 'dispose');
    const registration = service.registerProvider(incoming);
    const observed = registration.then(() => 'accepted', error => error.message as string);
    const shutdown = service.dispose();
    finishPrevious();
    await shutdown;
    expect(await observed).toContain('disposed');
    expect(previousDispose).toHaveBeenCalledTimes(1);
    expect(incomingDispose).not.toHaveBeenCalled();
    expect(service.isReady()).toBe(false);
    await incoming.dispose();
  });

  it('rejects new registration while model preparation owns the cutover boundary', async () => {
    let finishSecret!: (key: string) => void;
    const secret = new Promise<string>(resolve => { finishSecret = resolve; });
    const service = new AIService(explicit);
    const preparation = service.prepareModelRuntime({ hostOwnerId, secretResolver: () => secret });
    const incoming = createSdkProviderAdapter('incoming', { sdk: 'openai', apiKey: 'key' }, new AiHttpTransport())!;
    const incomingDispose = vi.spyOn(incoming, 'dispose');
    const registration = service.registerProvider(incoming).then(() => 'accepted', error => error.message as string);
    finishSecret('key');
    await preparation;
    expect(await registration).toContain('configuration snapshot');
    await service.dispose();
    expect(incomingDispose).not.toHaveBeenCalled();
    await incoming.dispose();
  });

  it('waits for an admitted replacement before taking its immutable model resource snapshot', async () => {
    const providerConfig = { sdk: 'openai' as const, apiKey: 'key', models: ['model'] };
    const service = new AIService({ providers: { main: providerConfig }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const previous = service.getProvider('main') as ReturnType<typeof createSdkProviderAdapter> & {};
    let finishPrevious!: () => void;
    const pending = new Promise<void>(resolve => { finishPrevious = resolve; });
    const originalDispose = previous!.dispose.bind(previous);
    vi.spyOn(previous!, 'dispose').mockImplementation(async () => { await pending; await originalDispose(); });
    const incoming = createSdkProviderAdapter('main', providerConfig, new AiHttpTransport())!;
    const registration = service.registerProvider(incoming);
    const preparation = service.prepareModelRuntime({ hostOwnerId });
    finishPrevious();
    await registration; await preparation;
    const scope = await service.getModelRuntime().acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    expect(scope.chat.provider).toBe(incoming);
    await scope.release(); await service.dispose();
  });

  it('preserves a legitimately registered SDK/endpoint/key/headers through model preparation', async () => {
    const requests: { url: string; authorization: string | null; custom: string | null }[] = [];
    const fetch = vi.fn(async (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(url), authorization: headers.get('Authorization'), custom: headers.get('X-Custom') });
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const service = new AIService({ providers: { main: { sdk: 'openai-compatible', apiKey: 'old-key', baseUrl: 'https://old.test/v1', models: ['model'] } }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const incoming = createSdkProviderAdapter('main', { sdk: 'openai', apiKey: 'new-key', baseUrl: 'https://new.test/v1', models: ['model'], headers: { 'X-Custom': 'registered' } }, new AiHttpTransport({ fetch }))!;
    await service.registerProvider(incoming);
    await service.prepareModelRuntime({ hostOwnerId, hostTransportFactory: () => new AiHttpTransport({ fetch }) });
    const scope = await service.getModelRuntime().acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    expect(scope.chat.invocation.connection.sdk).toBe('openai');
    await scope.chat.llmRuntime.complete(scope.chat.llmRuntime.model('main', 'model'), { systemPrompt: 'test', messages: [createUserMessage('hi')] });
    expect(requests).toEqual([{ url: 'https://new.test/v1/chat/completions', authorization: 'Bearer new-key', custom: 'registered' }]);
    await scope.release(); await service.dispose();
  });

  it('keeps unbound image-only legacy aliases available and disposes each Provider once', async () => {
    const service = new AIService({ providers: {
      main: { sdk: 'openai', apiKey: 'main-key', models: ['chat-model'] },
      images: { sdk: 'openai-compatible', apiKey: 'image-key', baseUrl: 'https://images.test/v1' },
    }, agents: { zhin: { provider: 'main', model: 'chat-model' } } });
    const images = service.getProvider('images');
    const dispose = vi.spyOn(images as { dispose(): Promise<void> }, 'dispose');
    expect(service.listProviders()).toContain('images');
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getProvider('images')).toBe(images);
    expect(service.listProviders()).toContain('images');
    await service.dispose(); await service.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a transferred legacy Provider open across service shutdown until its final active lease releases', async () => {
    const service = new AIService({ providers: { main: { sdk: 'openai', apiKey: 'key', models: ['model'] } }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const provider = service.getProvider();
    const dispose = vi.spyOn(provider as { dispose(): Promise<void> }, 'dispose');
    await service.prepareModelRuntime({ hostOwnerId });
    const scope = await service.getModelRuntime().acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    await service.dispose();
    expect(dispose).not.toHaveBeenCalled();
    await scope.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    await scope.release(); await service.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('attempts independent image-only cleanup even when a leased Provider disposer fails', async () => {
    const service = new AIService({ providers: {
      main: { sdk: 'openai', apiKey: 'main-key', models: ['model'] },
      image: { sdk: 'openai', apiKey: 'image-key' },
    }, agents: { zhin: { provider: 'main', model: 'model' } } });
    const main = service.getProvider('main');
    const image = service.getProvider('image');
    vi.spyOn(main as { dispose(): Promise<void> }, 'dispose').mockRejectedValueOnce(new Error('cleanup-secret'));
    const imageDispose = vi.spyOn(image as { dispose(): Promise<void> }, 'dispose');
    await service.prepareModelRuntime({ hostOwnerId });
    await expect(service.dispose()).rejects.toThrow('resource-dispose-failed');
    expect(imageDispose).toHaveBeenCalledTimes(1);
    expect(service.isReady()).toBe(false);
  });

  it('separates canonical and legacy resources and allocates aliases beyond existing catalog-prefixed legacy names', async () => {
    const modelCatalog: ModelCatalogConfig = {
      connections: { main: { id: 'main', ownerId: hostOwnerId, revision: 1, sdk: 'openai-compatible', baseUrl: 'https://shared.test/v1', secretRef: 'vault:key' } },
      models: { model: { id: 'model', connectionId: 'main', model: 'model', capabilities: { input: ['text'] } } },
      presets: { model: { id: 'model', modelId: 'model' } },
    };
    const service = new AIService({ modelCatalog, modelPolicy: { defaults: { chat: 'model' } },
      providers: {
        main: { sdk: 'openai-compatible', baseUrl: 'https://shared.test/v1', apiKey: 'key', models: ['model'], input: ['text'] },
        'catalog:main': { sdk: 'openai', apiKey: 'image-key' },
      }, multimodal: { perception: { provider: 'main', model: 'model' } } });
    const legacy = service.getProvider('main');
    const reserved = service.getProvider('catalog:main');
    const legacyDispose = vi.spyOn(legacy as { dispose(): Promise<void> }, 'dispose');
    const reservedDispose = vi.spyOn(reserved as { dispose(): Promise<void> }, 'dispose');
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'key' });
    const scope = await service.getModelRuntime().acquireForTurn({ rootId: 'root', ownerId: hostOwnerId });
    expect(scope.chat.provider.name).toBe('catalog:catalog%3Amain');
    expect(scope.chat.provider).not.toBe(legacy);
    expect(scope.perception?.provider).toBe(legacy);
    expect(service.getProvider('main')).toBe(legacy);
    expect(service.getProvider('catalog:main')).toBe(reserved);
    expect(service.getBindingRegistry().requireZhinBinding().providerAlias).toBe(scope.chat.provider.name);
    const canonicalDispose = vi.spyOn(scope.chat.provider as { dispose(): Promise<void> }, 'dispose');
    await service.dispose();
    expect(legacyDispose).not.toHaveBeenCalled();
    expect(canonicalDispose).not.toHaveBeenCalled();
    expect(reservedDispose).toHaveBeenCalledTimes(1);
    await scope.release();
    expect(legacyDispose).toHaveBeenCalledTimes(1);
    expect(canonicalDispose).toHaveBeenCalledTimes(1);
  });

  it('executes standalone explicit presets through the prepared model runtime and fake transport', async () => {
    const requests: { url: string; model: string }[] = [];
    const fetch = vi.fn(async (url, init) => {
      requests.push({ url: String(url), model: JSON.parse(String(init?.body)).model });
      return new Response('data: {"id":"id","object":"chat.completion.chunk","created":1,"model":"chosen-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\ndata: {"id":"id","object":"chat.completion.chunk","created":1,"model":"chosen-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const service = new AIService(explicit);
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'host-secret', hostTransportFactory: () => new AiHttpTransport({ fetch }) });
    const result = await service.runAgent('hi', { preset: 'chat' });
    expect(result.content).toBe('hello');
    expect(result.model).toBe('chosen-model');
    expect(requests).toEqual([{ url: 'https://host.test/v1/chat/completions', model: 'chosen-model' }]);
    await service.dispose();
  });

  it.each([false, true])('preserves the primary operation outcome when lease cleanup fails (primary fails=%s)', async primaryFails => {
    const service = new AIService(explicit);
    await service.prepareModelRuntime({ hostOwnerId, secretResolver: async () => 'key' });
    const runtime = service.getModelRuntime();
    const lease = await runtime.acquirePreset('chat', { ownerId: hostOwnerId });
    vi.spyOn(runtime, 'acquirePreset').mockResolvedValueOnce({ ...lease, release: async () => { await lease.release(); throw new Error('cleanup-secret'); } });
    const primaryError = new Error('primary-operation-error');
    const operation = vi.spyOn(standalone, 'runAgentLoopStandaloneTurn');
    if (primaryFails) operation.mockRejectedValueOnce(primaryError);
    else operation.mockResolvedValueOnce({ content: 'operation-completed', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, iterations: 1, model: 'chosen-model', toolCalls: [] });
    const warning = vi.spyOn(getLogger('AIService'), 'warn').mockImplementation(() => undefined);
    if (primaryFails) await expect(service.runAgent('perform once', { preset: 'chat' })).rejects.toBe(primaryError);
    else await expect(service.runAgent('perform once', { preset: 'chat' })).resolves.toMatchObject({ content: 'operation-completed' });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('AI model lease cleanup failed');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('cleanup-secret');
    await service.dispose();
  });

  it('disposes resources created by a preparation that races shutdown', async () => {
    let resolveSecret!: (value: string) => void;
    const secret = new Promise<string>(resolve => { resolveSecret = resolve; });
    const service = new AIService(explicit);
    const preparation = service.prepareModelRuntime({ hostOwnerId, secretResolver: () => secret });
    const disposed = service.dispose();
    resolveSecret('secret');
    await expect(preparation).rejects.toThrow('disposed');
    await disposed;
    expect(service.isReady()).toBe(false);
    await expect(service.prepareModelRuntime({ hostOwnerId })).rejects.toThrow('disposed');
  });
});
