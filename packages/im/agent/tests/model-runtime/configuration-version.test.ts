import { AiHttpTransport, createSdkProviderAdapter } from '@zhin.js/ai';
import { ModelRuntimeService, type ModelRuntimeConfig } from '../../src/model-runtime/index.js';

const hostOwnerId = 'host/config-version';
const turn = { rootId: '/config-version', ownerId: hostOwnerId };
function config(options: { model?: string; key?: string; url?: string; retries?: number } = {}): ModelRuntimeConfig {
  return { providers: { main: { sdk: 'openai-compatible', apiKey: options.key ?? 'synthetic-old-key',
    baseUrl: options.url ?? 'https://old.invalid/v1', models: ['old', 'next'], maxRetries: options.retries ?? 2 } },
    agents: { zhin: { provider: 'main', model: options.model ?? 'old' } } };
}
function fixture() {
  const transports: string[] = [];
  const network = vi.fn(async () => { throw new Error('unexpected network'); });
  const runtime = new ModelRuntimeService({ config: config(), hostOwnerId,
    hostTransportFactory: connection => { transports.push(connection.baseUrl!); return new AiHttpTransport({ fetch: network }); } });
  return { runtime, network, transports };
}

describe('immutable deployment model versions', () => {
  it('keeps admitted scopes fixed and creates the next version using its actual private factory data', async () => {
    const f = fixture();
    const oldPlan = await f.runtime.resolveForTurn(turn);
    const old = await f.runtime.acquireResolvedForTurn(oldPlan);
    const update = f.runtime.prepareConfiguration(config({ model: 'next', key: 'synthetic-next-key', url: 'https://next.invalid/v1', retries: 5 }));
    expect(update.kind).toBe('ready');
    if (update.kind !== 'ready') throw new Error('expected ready configuration');
    expect(f.transports).toEqual(['https://old.invalid/v1']);
    const nextPlan = await update.runtime.resolveForTurn(turn);
    expect(f.transports).toEqual(['https://old.invalid/v1']); // Resolution does not initialize resources.
    const next = await update.runtime.acquireResolvedForTurn(nextPlan);
    expect(old.chat.invocation.model.model).toBe('old');
    expect(next.chat.invocation.model.model).toBe('next');
    expect(next.chat.invocation.connection.revision).toBeGreaterThan(old.chat.invocation.connection.revision);
    expect(next.chat.llmRuntime.providerConfig('main')).toMatchObject({ apiKey: 'synthetic-next-key', baseUrl: 'https://next.invalid/v1', maxRetries: 5 });
    expect(old.chat.llmRuntime.providerConfig('main')).toMatchObject({ apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1', maxRetries: 2 });
    expect((await f.runtime.resolveForTurn(turn)).chat.model.model).toBe('old');
    expect(JSON.stringify(update.runtime.getCatalogConfig())).not.toContain('synthetic-');
    expect(f.network).not.toHaveBeenCalled();
    await Promise.all([old.release(), next.release()]); await f.runtime.dispose();
  });

  it('shares unchanged resources without disposing the root pool when a version view retires', async () => {
    const f = fixture();
    const old = await f.runtime.acquireForTurn(turn);
    const update = f.runtime.prepareConfiguration(config({ model: 'next' }));
    if (update.kind !== 'ready') throw new Error('expected ready configuration');
    const next = await update.runtime.acquireForTurn(turn);
    expect(next.chat.provider).toBe(old.chat.provider);
    expect(next.chat.invocation.connection.revision).toBe(old.chat.invocation.connection.revision);
    await update.runtime.dispose();
    await expect(update.runtime.acquirePreset(next.chat.invocation.preset.id, { ownerId: hostOwnerId })).rejects.toMatchObject({ code: 'disposed' });
    const another = await f.runtime.acquireForTurn(turn);
    expect(another.chat.provider).toBe(old.chat.provider);
    await Promise.all([old.release(), next.release(), another.release()]); await f.runtime.dispose();
  });

  it('rejects resolved plans from another version or a structural caller before resource initialization', async () => {
    const f = fixture();
    const update = f.runtime.prepareConfiguration(config({ model: 'next' }));
    if (update.kind !== 'ready') throw new Error('expected ready configuration');
    const plan = await update.runtime.resolveForTurn(turn);
    await expect(f.runtime.acquireResolvedForTurn(plan)).rejects.toMatchObject({ code: 'invalid-config' });
    await expect(update.runtime.acquireResolvedForTurn({ ...plan })).rejects.toMatchObject({ code: 'invalid-config' });
    const judge = update.runtime.resolveHostModel();
    const provider = update.runtime.resolveHostProvider('main');
    await expect(f.runtime.acquireResolvedHostModel(judge)).rejects.toMatchObject({ code: 'invalid-config' });
    await expect(update.runtime.acquireResolvedHostModel({ ...judge })).rejects.toMatchObject({ code: 'invalid-config' });
    await expect(f.runtime.acquireResolvedHostProvider(provider)).rejects.toMatchObject({ code: 'invalid-config' });
    await expect(update.runtime.acquireResolvedHostProvider({ ...provider })).rejects.toMatchObject({ code: 'invalid-config' });
    expect(f.transports).toEqual([]);
    await f.runtime.dispose();
  });

  it('does not let an explicit ServiceAgent from a disposed Host borrow a replacement owner through its admission callback', async () => {
    const admit = vi.fn(async () => { throw new Error('retired Host escaped through callback'); });
    const runtime = new ModelRuntimeService({ config: config(), hostOwnerId, acquireDeploymentSelection: admit });
    const acquire = runtime.createServiceAgentAcquirer({ providerAlias: 'main', model: 'old' });
    await runtime.dispose();
    expect(() => acquire()).toThrow('disposed');
    expect(admit).not.toHaveBeenCalled();
  });

  it('leaves destructive catalog changes and non-model authority changes pending restart', () => {
    const f = fixture();
    const removed = config();
    removed.providers!.main = { ...removed.providers!.main, models: ['old'] };
    expect(f.runtime.prepareConfiguration(removed)).toMatchObject({ kind: 'restart-required' });
    expect(f.runtime.prepareConfiguration({ ...config(), agents: { zhin: { provider: 'main', model: 'old', permission: { task: { '*': 'allow' } } } } })).toMatchObject({ kind: 'restart-required' });
    expect(() => f.runtime.prepareConfiguration({ ...config(), agents: { zhin: { provider: 'missing', model: 'old' } } })).toThrow();
    return f.runtime.dispose();
  });

  it('does not reborrow a startup provider after its transferred resource was retired', async () => {
    const source = config();
    const network = vi.fn(async () => { throw new Error('unexpected network'); });
    const provider = createSdkProviderAdapter('main', source.providers!.main, new AiHttpTransport({ fetch: network }));
    if (!provider) throw new Error('expected synthetic SDK provider');
    const disposeTransferred = vi.fn(async () => undefined);
    const runtime = new ModelRuntimeService({ config: source, hostOwnerId, hostProviders: new Map([['main', provider]]),
      takeHostProviderOwnership: () => disposeTransferred,
      hostTransportFactory: () => new AiHttpTransport({ fetch: network }) });
    const old = await runtime.acquireForTurn(turn);
    expect(old.chat.provider).toBe(provider);
    await old.release();
    const update = runtime.prepareConfiguration(config({ key: 'synthetic-next-key', url: 'https://next.invalid/v1' }));
    if (update.kind !== 'ready') throw new Error('expected compatible update');
    const next = await update.runtime.acquireForTurn(turn);
    await vi.waitFor(() => expect(disposeTransferred).toHaveBeenCalledOnce());
    const late = await runtime.acquireForTurn(turn);
    expect(late.chat.provider).not.toBe(provider);
    expect(late.chat.llmRuntime.providerConfig('main')).toMatchObject({ apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1' });
    await late.release(); await next.release(); await runtime.dispose();
    expect(disposeTransferred).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
  });

  it('preserves externally owned provider identity and never takes or closes its ownership', async () => {
    const source = config();
    const network = vi.fn(async () => { throw new Error('unexpected network'); });
    const provider = createSdkProviderAdapter('main', source.providers!.main, new AiHttpTransport({ fetch: network }));
    if (!provider) throw new Error('expected synthetic SDK provider');
    const dispose = vi.spyOn(provider, 'dispose');
    const runtime = new ModelRuntimeService({ config: source, hostOwnerId, hostProviders: new Map([['main', provider]]),
      hostTransportFactory: () => new AiHttpTransport({ fetch: network }) });
    const old = await runtime.acquireForTurn(turn); await old.release();
    const update = runtime.prepareConfiguration(config({ key: 'synthetic-next-key', url: 'https://next.invalid/v1' }));
    if (update.kind !== 'ready') throw new Error('expected compatible update');
    const next = await update.runtime.acquireForTurn(turn);
    const late = await runtime.acquireForTurn(turn);
    expect(late.chat.provider).toBe(provider);
    await Promise.all([late.release(), next.release()]); await runtime.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    await provider.dispose();
  });
});
