import { EventEmitter } from 'node:events';
import { RootController, createCapabilitySlot, createSnapshotView, rootPluginId,
  type SnapshotState, type FeatureId, type TokenId } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification,
  endpointEventGatewayToken, endpointSpec, type Endpoint } from '@zhin.js/adapter';
import { HandlerIndex, defineHandler, handlerFeatureId } from '@zhin.js/handler';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';

/** The real Core gateway must retain one original Client and snapshot through asynchronous native normalization. */
it.each(['published', 'candidate'] as const)('finishes a %s raw receipt in its original generation while closing new ingress after replacement', async stage => {
  const owner = rootPluginId();
  const empty: SnapshotState = { root: owner, tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const root = new RootController(empty), im = new ImRuntime(); im.attach(root.snapshots);
  const seen: Array<{ generation: number; event: string; client: unknown }> = [];
  const stopped: number[] = [], clients: NativeEndpoint[] = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start: () => { if (stage === 'candidate' && this.version === 1) receipt = receive(this); },
      open() {}, close() {}, stop: () => { stopped.push(this.version); },
    });
    constructor(readonly version: number) { super(); }
  }
  async function prepare(version: number) {
    const adapter = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'native', source: '/fixture/adapters/native/index.ts',
      definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => new class extends Adapter<NativeEndpoint> {
        protected createEndpoint() { const client = new NativeEndpoint(version); clients.push(client); return client; }
      }() }) });
    const handlers = ['platform.receive', 'message.receive'].map(event => createCapabilitySlot({ owner, feature: handlerFeatureId,
      localName: event.replace('.', '/'), source: `/fixture/handlers/${event}/index.ts`, definition: defineHandler({ event,
        handle(input) { seen.push({ generation: version, event, client: input.client }); },
      }) }));
    const state: SnapshotState = { ...empty,
      tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[owner, { id: 'same-logical-account' }]]),
      resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
      capabilities: new Map([adapter, ...handlers].map(slot => [slot.id, slot])),
    };
    const snapshot = createSnapshotView(version, state);
    const index = await AdapterIndex.create([adapter], snapshot, new AbortController().signal);
    return { snapshot: { ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index], [handlerFeatureId, new HandlerIndex(handlers, snapshot)]]) },
      dispose: () => index.stop(), handoff: { activateNext: (signal: AbortSignal) => index.activate(signal), deactivateNext: () => index.stop() } };
  }
  let finish!: () => void, entered!: () => void;
  const pause = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let receipt: Promise<unknown> | undefined;
  const receive = (original: NativeEndpoint) => original[endpointSpec].events.run(async () => {
    await original[endpointSpec].events.platform('native.message', { text: 'synthetic' });
    entered(); await pause;
    return original[endpointSpec].events.message({ conversation: { kind: 'group', id: 'room' }, content: 'synthetic', sender: { id: 'alice' } });
  });
  try {
    await root.start(() => prepare(1));
    const original = clients[0]!;
    if (stage === 'published') receipt = receive(original);
    await started;
    await root.transact(() => prepare(2));
    expect(stopped).not.toContain(1);
    await expect(original[endpointSpec].events.run(() => 'new old-client callback')).rejects.toThrow('retired');
    finish(); await receipt;
    expect(seen).toEqual([
      { generation: 1, event: 'platform.receive', client: original },
      { generation: 1, event: 'message.receive', client: original },
    ]);
    await vi.waitFor(() => expect(stopped).toContain(1));
    await clients[1]![endpointSpec].events.message({ conversation: { kind: 'group', id: 'room' }, content: 'fresh', sender: { id: 'alice' } });
    expect(seen.at(-1)).toEqual({ generation: 2, event: 'message.receive', client: clients[1] });
  } finally { finish(); await receipt?.catch(() => undefined); await root.stop(); }
});
