import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, projectLocaleToken,
  userLocalePreferencesToken, type SnapshotState, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import { AdapterIndex, Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';

async function fixture(preferences: UserLocalePreferences) {
  const root = rootPluginId();
  const im = new ImRuntime();
  class TestEndpoint extends Endpoint<object> {
    readonly client = {};
    start() {} open() {} close() {} stop() {}
    async send() { return 'unused'; }
  }
  const endpoints: TestEndpoint[] = [];
  const slots = ['first', 'second'].map(localName => createCapabilitySlot({
    owner: root, feature: adapterFeatureId, localName, source: `/adapters/${localName}/index.ts`,
    definition: defineAdapter({ capabilities: ['inbound'], create: () => {
      const endpoint = new TestEndpoint(); endpoints.push(endpoint); return endpoint;
    } }),
  }));
  const state: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/locale', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { locale: 'en' }]]),
    resources: new Map([[root, new Map<string, unknown>([
      [projectLocaleToken.id, 'en'], [endpointEventGatewayToken.id, im.endpointEvents],
      [userLocalePreferencesToken.id, preferences],
    ])]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  const adapters = await AdapterIndex.create(slots, createSnapshotView(0, state), new AbortController().signal);
  // Candidate adapters cannot query a user's preferences before commit.
  expect(await endpoints[0]!.resolveLocale('alice')).toBeUndefined();
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, adapters]]) });
  im.attach(store);
  await adapters.start(); adapters.open();
  return { endpoints, slots, im, store, retire() {
    store.commit(store.current.generation, { snapshot: state, dispose: () => undefined });
  }, async stop() { await store.close(); await adapters.stop(); } };
}

it('resolves protocol reply language with canonical endpoint and sender identity', async () => {
  const get = vi.fn(async (endpoint: { id: string }, sender: string) =>
    endpoint.id.endsWith('first') && sender === 'alice' ? 'zh-CN' as const : undefined);
  const f = await fixture({ get, set: async () => undefined });
  try {
    expect(get).not.toHaveBeenCalled();
    expect(await f.endpoints[0]!.resolveLocale('alice')).toBe('zh-CN');
    expect(await f.endpoints[0]!.resolveLocale('bob')).toBe('en');
    expect(await f.endpoints[1]!.resolveLocale('alice')).toBe('en');
    expect(await f.endpoints[0]!.resolveLocale()).toBe('en');
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[0]?.[0]).toEqual({ id: f.slots[0]!.id, adapter: 'first' });
    await expect(f.im.endpointEvents.resolveLocale!({ id: 'missing' as never, adapter: 'spoofed' }, 'alice')).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(3);
  } finally { await f.stop(); }
});

it('pins an admitted lookup to its original snapshot and rejects later retired calls', async () => {
  let finish!: (value: undefined) => void;
  const get = vi.fn(() => new Promise<undefined>(resolve => { finish = resolve; }));
  const f = await fixture({ get, set: async () => undefined });
  try {
    const pending = f.endpoints[0]!.resolveLocale('alice');
    expect(get).toHaveBeenCalledOnce();
    f.retire();
    finish(undefined);
    expect(await pending).toBe('en');
    expect(await f.endpoints[0]!.resolveLocale('alice')).toBeUndefined();
    expect(get).toHaveBeenCalledOnce();
  } finally { await f.stop(); }
});

it('releases the snapshot after a preference lookup fails', async () => {
  const f = await fixture({ get: async () => { throw new Error('synthetic store failure'); }, set: async () => undefined });
  await expect(f.endpoints[0]!.resolveLocale('alice')).rejects.toThrow('synthetic store failure');
  await f.stop();
});
