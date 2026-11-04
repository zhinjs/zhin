import { childPluginId, rootPluginId, createCapabilitySlot, createSnapshotView, SnapshotStore,
  type SnapshotState } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointSpec, endpointEventGatewayToken, type Endpoint } from '@zhin.js/adapter';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';

class NativeClient { nativeMethod() { return 'native'; } }
class TestEndpoint extends NativeClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {}, send: () => 'sent', name: 'terminal-live',
  });
}
class TestAdapter extends Adapter<TestEndpoint> {
  protected createEndpoint() { return new TestEndpoint(); }
}

/** Actual directory ownership, rather than a fake list/resolve implementation. */
async function fixture(packageName: string, generation = 1, twoOwners = true) {
  const root = rootPluginId(), child = childPluginId(root, 'same');
  const owners = twoOwners ? [root, child] : [root];
  const slots = owners.map(owner => createCapabilitySlot({ owner, feature: adapterFeatureId,
    localName: 'terminal', source: '/fixture/adapters/terminal/index.ts',
    definition: defineAdapter({ capabilities: ['outbound'], createAdapter: () => new TestAdapter() }) }));
  const state: SnapshotState = { root,
    tree: new Map(owners.map(id => [id, { id, instanceKey: String(id), packageName,
      packageRoot: '/fixture', children: id === root && twoOwners ? [child] : [], ...(id === child ? { parent: root } : {}) }])),
    config: new Map(), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
    resources: new Map(owners.map(id => [id, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive: async () => undefined }]])])),
  };
  const index = await AdapterIndex.create(slots, createSnapshotView(generation, state), new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  const im = new ImRuntime(); im.attach(store);
  return { root, child, slots, state, index, im, close: async () => { await index.stop(); await store.close(); } };
}

it('one directory refuses ambiguous platform, package and live-name selectors across real owners', async () => {
  const f = await fixture('minimal-bot');
  try {
    expect(f.index.resolve('minimal-bot', 'terminal')).toBeUndefined();
    expect(f.index.resolve('terminal', 'terminal')).toBeUndefined();
    expect(f.index.resolve('terminal', 'terminal-live')).toBeUndefined();
    expect(f.index.resolve(String(f.root), 'terminal')).toBe(f.slots[0].id);
    expect(f.index.resolve(String(f.child), 'terminal')).toBe(f.slots[1].id);
    expect(f.index.resolve('minimal-bot', String(f.slots[1].id))).toBe(f.slots[1].id);
    expect(f.index.resolve(String(f.root), String(f.slots[1].id))).toBeUndefined();
    expect(f.im.endpoints.get('minimal-bot', 'terminal')).toBeNull();
    expect(f.im.endpoints.get('terminal', String(f.slots[1].id))?.endpoint.id).toBe(f.slots[1].id);
  } finally { await f.close(); }
});

it('owner package aliases remain fixed to each actual directory construction snapshot', async () => {
  const old = await fixture('@test/adapter-old-bot', 1, false);
  const current = await fixture('@test/adapter-new-bot', 2, false);
  try {
    expect(current.index.resolve('new-bot', 'terminal')).toBe(current.slots[0].id);
    expect(current.index.resolve('old-bot', 'terminal')).toBeUndefined();
    expect(old.index.resolve('old-bot', 'terminal')).toBe(old.slots[0].id);
    expect(old.index.resolve('new-bot', 'terminal')).toBeUndefined();
    expect(current.im.endpoints.get('new-bot', 'terminal')?.endpoint.id).toBe(current.slots[0].id);
    expect(old.im.endpoints.get('old-bot', 'terminal')?.endpoint.id).toBe(old.slots[0].id);
  } finally { await old.close(); await current.close(); }
});
