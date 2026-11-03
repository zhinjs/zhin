import { AiHttpTransport } from '@zhin.js/ai';
import { ModelRuntimeService, modelRuntimeBaselineToken, legacyModelPresetId, type ModelRuntimeConfig } from '@zhin.js/agent/model-runtime';
import { SnapshotStore, rootPluginId, type SnapshotState, type Token } from '@zhin.js/plugin-runtime';
import type { RuntimeControlContext } from '@zhin.js/runtime';
import { createModelConfigurationAccess, type ModelConfigurationControl } from '../../../src/plugin-runtime/personal-models/configuration.js';
import { RuntimePolicyManagementService } from '../../../src/plugin-runtime/runtime-model-policy/service.js';
import { normalizeRuntimePolicyRefsOverride, type RuntimePolicySnapshot } from '@zhin.js/agent/model-policy';

const hostOwnerId = 'host/configuration-admission';
const rootId = '/configuration-admission';
const input = { rootId, ownerId: hostOwnerId };
function config(model = 'old', includeNext = false): ModelRuntimeConfig {
  return { providers: { main: { sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-key', models: includeNext ? ['old', 'next'] : ['old'] } },
    agents: { zhin: { provider: 'main', model } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function controller(runtime: ModelRuntimeService) {
  const snapshot: SnapshotState = { root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const store = new SnapshotStore<Map<Token<unknown>, unknown>>(snapshot, undefined, new Map([[modelRuntimeBaselineToken, runtime]]),
    (state, _root, token) => state.get(token));
  let tail: Promise<unknown> = Promise.resolve();
  const retained: Array<ReturnType<typeof store.acquire>> = [];
  const control: ModelConfigurationControl = <T>(operation: (context: RuntimeControlContext) => Promise<T>) => {
    const work = tail.then(async () => {
      const lease = store.acquire();
      try { return await operation({ lease, readRootResource: token => store.rootResource(lease, token),
        retain: () => { const held = store.retain(lease); retained.push(held); return held; } }); }
      finally { lease.release(); }
    });
    tail = work.catch(() => undefined);
    return work;
  };
  return { control, retained, close: () => store.close(), publish: (next: ModelRuntimeService) => control(async context => {
    const { generation, ...snapshot } = context.lease.value;
    store.commit(generation, { snapshot, state: new Map([[modelRuntimeBaselineToken, next]]), dispose: () => undefined });
  }) };
}

describe('trusted model configuration admission', () => {
  it.each(['judge', 'image'] as const)('captures %s configuration without holding control across its secret resolver and releases its configuration lease', async purpose => {
    const key = deferred<string>();
    const entered = deferred<void>();
    const explicit: ModelRuntimeConfig = { modelCatalog: {
      connections: { main: { revision: 1, sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', secretRef: 'ref' } },
      models: { old: { connectionId: 'main', model: 'old', capabilities: {} } }, presets: { old: { modelId: 'old' } },
    }, modelPolicy: { defaults: { chat: 'old' } } };
    const runtime = new ModelRuntimeService({ config: explicit, hostOwnerId,
      secretResolver: async () => { entered.resolve(); return key.promise; },
      hostTransportFactory: () => new AiHttpTransport({ fetch: async () => { throw new Error('unexpected network'); } }) });
    const c = controller(runtime);
    const access = createModelConfigurationAccess({ control: c.control, runtime: () => runtime });
    try {
      const pending = purpose === 'judge' ? access.acquireHostModel() : access.acquireHostProvider('main');
      await entered.promise;
      await expect(c.control(async () => 'queue-free')).resolves.toBe('queue-free');
      expect(c.retained[0].active).toBe(true);
      key.resolve('synthetic-resolved-key');
      const resource = await pending;
      await resource.release(); await resource.release();
      expect(c.retained[0].active).toBe(false);
      const aborted = new AbortController(); aborted.abort();
      await expect(purpose === 'judge' ? access.acquireHostModel(undefined, aborted.signal)
        : access.acquireHostProvider('main', aborted.signal)).rejects.toThrow();
      expect(c.retained).toHaveLength(1);
    } finally { await runtime.dispose(); await c.close(); }
  });
  it('captures a version under control, then initializes factories after releasing the control queue', async () => {
    const key = deferred<string>();
    const began = deferred<void>();
    const secrets = vi.fn(async () => { began.resolve(); return key.promise; });
    const network = vi.fn(async () => { throw new Error('unexpected network'); });
    const explicit: ModelRuntimeConfig = { modelCatalog: {
      connections: { main: { revision: 1, sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', secretRef: 'synthetic-ref' } },
      models: { old: { connectionId: 'main', model: 'old', capabilities: {} } }, presets: { old: { modelId: 'old' } },
    }, modelPolicy: { defaults: { chat: 'old' } } };
    const runtime = new ModelRuntimeService({ config: explicit, hostOwnerId, secretResolver: secrets,
      hostTransportFactory: () => new AiHttpTransport({ fetch: network }) });
    const c = controller(runtime);
    const access = createModelConfigurationAccess({ control: c.control, runtime: () => runtime });
    const pending = access.acquire(async () => input);
    await began.promise;
    await expect(c.control(async () => 'queue-free')).resolves.toBe('queue-free');
    expect(c.retained[0].active).toBe(true);
    key.resolve('synthetic-resolved-key');
    const scope = await pending;
    expect(scope.chat.llmRuntime.providerConfig('main')).toMatchObject({ apiKey: 'synthetic-resolved-key' });
    expect(network).not.toHaveBeenCalled();
    await scope.release(); await scope.release(); expect(c.retained[0].active).toBe(false);
    await runtime.dispose(); await c.close();
  });

  it('selects newly published definitions and serializes policy validation with its CAS', async () => {
    let policy: RuntimePolicySnapshot = { revision: 0, refsOverride: normalizeRuntimePolicyRefsOverride({}) };
    const runtime = new ModelRuntimeService({ config: config(), hostOwnerId, rootId, runtimePolicySnapshot: async () => policy });
    const c = controller(runtime);
    const access = createModelConfigurationAccess({ control: c.control, runtime: () => runtime });
    const prepared = runtime.prepareConfiguration(config('old', true));
    if (prepared.kind !== 'ready') throw new Error('expected compatible addition');
    const entered = deferred<void>(); const finish = deferred<void>();
    const service = new RuntimePolicyManagementService({ rootId, runtime: () => runtime, configuration: access,
      repository: { read: async () => policy, compareExchange: async (expected, refsOverride) => {
        if (expected !== policy.revision) return { kind: 'conflict', actualRevision: policy.revision };
        if (expected === 0) { entered.resolve(); await finish.promise; }
        policy = { revision: policy.revision + 1, refsOverride };
        return { kind: 'updated', snapshot: policy };
      } } });
    const write = service.replace({ expectedRevision: 0, refsOverride: {} });
    await entered.promise;
    let published = false;
    const publication = c.publish(prepared.runtime).then(() => { published = true; });
    await Promise.resolve(); expect(published).toBe(false);
    finish.resolve(); await write; await publication;
    await service.replace({ expectedRevision: 1, refsOverride: { defaults: { chat: legacyModelPresetId('main', 'next') } } });
    const scope = await access.acquire(async () => input);
    expect(scope.chat.invocation.model.model).toBe('next');
    expect(runtime.getCatalogConfig().presets[legacyModelPresetId('main', 'next')]).toBeUndefined();
    await scope.release(); await runtime.dispose(); await c.close();
  });

  it('releases a captured configuration lease when acquisition is cancelled or fails', async () => {
    const entered = deferred<void>();
    const runtime = new ModelRuntimeService({ config: { ...config(), providers: { main: { sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', models: ['old'] } } },
      hostOwnerId, hostTransportFactory: () => { entered.resolve(); throw new Error('synthetic factory failure'); } });
    const c = controller(runtime); const access = createModelConfigurationAccess({ control: c.control, runtime: () => runtime });
    await expect(access.acquire(async () => input)).rejects.toThrow('resource-create-failed');
    await entered.promise; expect(c.retained[0].active).toBe(false);
    const abort = new AbortController(); abort.abort();
    await expect(access.acquire(async () => input, abort.signal)).rejects.toThrow();
    expect(c.retained).toHaveLength(1);
    await runtime.dispose(); await c.close();
  });
});
