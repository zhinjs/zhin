import { EventEmitter } from 'node:events';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointEventGatewayToken, endpointSpec, type Endpoint, type EndpointSendRequest } from '@zhin.js/adapter';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId,
  type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import type { MessageRef } from '@zhin.js/im-contract';
import { MemoryDesiredRepository } from '../../../../../plugins/adapters/test-utils/desired-repository.js';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';

async function fixture(send: (request: EndpointSendRequest) => Promise<string> = async () => 'sent') {
  const root = rootPluginId(), im = new ImRuntime(), repository = new MemoryDesiredRepository();
  repository.snapshot = undefined;
  const calls: Array<{ account: string; message: string }> = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec];
    constructor(readonly account: string) {
      super();
      this[endpointSpec] = createEndpointSpecification(this, {
        start() {}, open() {}, close() {}, stop() {}, send,
        control: { recall: async ({ message }) => { calls.push({ account: this.account, message: message.id }); } },
      });
    }
  }
  class NativeAdapter extends Adapter<NativeEndpoint> {
    protected createEndpoint(config: Readonly<Record<string, unknown>>) { return new NativeEndpoint(String(config.id)); }
  }
  const adapter = new NativeAdapter();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'test', source: '/fixture/adapters/test/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'], createAdapter: () => adapter }) });
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { endpoints: [{ id: 'one' }, { id: 'two' }] }]]), capabilities: new Map([[slot.id, slot]]),
    projections: new Map(), resources: new Map([[root, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
  };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, { repository });
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  im.attach(store); await index.activate(new AbortController().signal);
  const one = adapter.list().find(row => row.endpointId === 'one')!, two = adapter.list().find(row => row.endpointId === 'two')!;
  const target = { endpoint: { id: one.canonicalId, adapter: 'test' }, kind: 'group' as const, id: 'room',
    parent: { kind: 'channel' as const, id: 'container' }, threadId: 'topic' };
  return { im, adapter, index, store, state, one, two, calls, target, async close() { await index.stop(); await store.close(); } };
}

it('routes existing-message control solely by its canonical reference, not contradictory selectors', async () => {
  const f = await fixture();
  try {
    const input = { adapter: 'test', endpointKey: 'two', message: { conversation: f.target, id: 'one-message' } };
    await f.im.endpoints.recall(input);
    expect(f.calls).toEqual([{ account: 'one', message: 'one-message' }]);
    await expect(f.im.endpoints.recall({ message: { ...input.message,
      conversation: { ...f.target, endpoint: { ...f.target.endpoint, adapter: 'foreign' } } } })).rejects.toMatchObject({ code: 'endpoint_identity_mismatch' });
    expect(f.calls).toHaveLength(1);
  } finally { await f.close(); }
});

it('retains full scene and actual source Client, and releases on account cancellation without rebinding', async () => {
  const f = await fixture();
  const source = f.index.clientById(f.one.canonicalId);
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: source });
  try {
    expect(operation.target).toEqual(f.target);
    await operation.control!.recall!({ message: { conversation: f.target, id: 'early' } });
    const stopping = f.adapter.stop(f.one.instanceId, f.adapter.revision);
    await vi.waitFor(() => expect(operation.signal.aborted).toBe(true));
    operation.release(); operation.release();
    await stopping;
    await f.adapter.start(f.one.instanceId, f.adapter.revision);
    await expect(operation.control!.recall!({ message: { conversation: f.target, id: 'late' } })).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(operation.send('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(f.calls).toEqual([{ account: 'one', message: 'early' }]);
  } finally { operation.release(); await f.close(); }
});

it('rejects a foreign source Client and preserves usability of the correct account', async () => {
  const f = await fixture();
  try {
    expect(() => f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.two.canonicalId) }))
      .toThrow();
    const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    try {
      const other: MessageRef = { conversation: { ...f.target, endpoint: { id: f.two.canonicalId, adapter: 'test' } }, id: 'other' };
      await expect(operation.control!.recall!({ message: other })).rejects.toMatchObject({ code: 'endpoint_identity_mismatch' });
      await operation.control!.recall!({ message: { conversation: f.target, id: 'correct' } });
    } finally { operation.release(); }
    expect(f.calls).toEqual([{ account: 'one', message: 'correct' }]);
  } finally { await f.close(); }
});

it('cancels one captured send without cancelling its retained source or a sibling send', async () => {
  const submissions: AbortSignal[] = [];
  const f = await fixture(async ({ signal }) => {
    submissions.push(signal!);
    if (submissions.length > 1) return 'sibling';
    return new Promise<string>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const caller = new AbortController();
    const pending = operation.send('pending', { signal: caller.signal });
    const failed = expect(pending).resolves.toMatchObject({ status: 'failed', failure: { deliveryUnknown: true } });
    await vi.waitFor(() => expect(submissions).toHaveLength(1));
    caller.abort(new Error('caller stopped'));
    expect(submissions[0]!.aborted).toBe(true);
    await failed;
    expect(operation.signal.aborted).toBe(false);
    await expect(operation.send('sibling')).resolves.toMatchObject({ status: 'sent' });
    expect(submissions[1]!.aborted).toBe(false);
  } finally { operation.release(); await f.close(); }
});


it('keeps a captured operation alive across replacement, but cancels it on explicit Root stop', async () => {
  const f = await fixture();
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    f.store.commit(0, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose() {} });
    expect(operation.signal.aborted).toBe(false);
    await operation.control!.recall!({ message: { conversation: f.target, id: 'after-replacement' } });
    expect(f.calls).toEqual([{ account: 'one', message: 'after-replacement' }]);
    const closing = f.store.close();
    expect(operation.signal.aborted).toBe(true);
    operation.release();
    await closing;
  } finally { operation.release(); await f.close(); }
});


it('owns an independent snapshot lease when capture outlives its parent snapshot view', async () => {
  const f = await fixture();
  let operation!: ReturnType<typeof f.im.endpoints.captureOperation>;
  let disposed = false;
  f.store.commit(0, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose: () => { disposed = true; } });
  try {
    await f.im.runWithSnapshotView(async () => {
      operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    });
    f.store.commit(1, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose() {} });
    expect(disposed).toBe(false);
    await expect(operation.send('after-parent-finished')).resolves.toMatchObject({ status: 'sent' });
    operation.release();
    await vi.waitFor(() => expect(disposed).toBe(true));
  } finally { operation?.release(); await f.close(); }
});
