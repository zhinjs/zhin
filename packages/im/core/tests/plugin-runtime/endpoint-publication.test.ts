import { RootController, createSnapshotView, createCapabilitySlot, createGenerationAdmissionGate, createToken, generationAdmissionSource, rootPluginId, type SnapshotState, type TokenId, type CapabilityId, type CapabilitySlot, type FeatureId, type GenerationAdmissionGate } from '@zhin.js/plugin-runtime';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken, type EndpointEventSink } from '@zhin.js/adapter';
import { HandlerIndex, defineHandler, handlerFeatureId } from '@zhin.js/handler';
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';

it('dispatches system.online buffered during login only into the published snapshot, with every candidate service admitted', async () => {
  const owner = rootPluginId();
  const empty: SnapshotState = { root: owner, tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const root = new RootController(empty);
  const im = new ImRuntime(); im.attach(root.snapshots);
  const pending: Promise<unknown>[] = [];
  const sinks: EndpointEventSink[] = [];
  const seen: Array<{ generation: number; service: number | undefined }> = [];
  const serviceToken = createToken<{ read(): number | undefined }>('test.publication.service');
  const endpoints: AdapterIndex[] = [];
  async function prepare(version: number, foreign?: GenerationAdmissionGate, failActivation = false) {
    const serviceGate = createGenerationAdmissionGate();
    const service = { [generationAdmissionSource]: [serviceGate], read: () => serviceGate.enter(() => version) };
    class PublicationClient { constructor(readonly version: number) {} }
    class PublicationEndpoint extends PublicationClient implements Endpoint {
      readonly [endpointSpec] = createEndpointSpecification(this, {
        start: () => {
          const events = this[endpointSpec].events;
          sinks.push(events);
          const event = events.emit('system.receive', { type: 'system', name: 'system.online', id: `online-${version}`, timestamp: Date.now(), metadata: {} });
          pending.push(event); void event.catch(() => undefined);
        }, open() {}, close() {}, stop() {},
      });
    }
    const adapter = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'synthetic', source: '/fixture/adapters/synthetic/index.ts', definition: defineAdapter({
      capabilities: ['inbound'], createAdapter: () => new class extends Adapter<PublicationEndpoint> {
        protected createEndpoint() { return new PublicationEndpoint(version); }
      }(),
    }) });
    const handler = createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'online', source: '/fixture/handlers/online/index.ts', definition: defineHandler({
      event: 'system.receive', handle(event) { seen.push({ generation: event.payload.generation, service: this.use(serviceToken).read() }); },
    }) });
    const state: SnapshotState = { ...empty,
      tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'test', packageRoot: '/fixture', children: [] }]]),
      config: new Map([[owner, { version }]]),
      resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [serviceToken.id, foreign ? { [generationAdmissionSource]: [serviceGate, foreign], read: service.read } : service]])]]),
      capabilities: new Map<CapabilityId, CapabilitySlot>([[adapter.id, adapter], [handler.id, handler]]),
    };
    const view = createSnapshotView(version, state);
    const index = await AdapterIndex.create([adapter], view, new AbortController().signal);
    endpoints.push(index);
    return { snapshot: { ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index], [handlerFeatureId, new HandlerIndex([handler], view)]]) }, dispose: () => index.stop(),
      handoff: { async activateNext(signal: AbortSignal) { await index.activate(signal); if (failActivation) throw new Error('candidate login failed'); }, deactivateNext: () => index.stop() } };
  }
  try {
    await root.start(() => prepare(1));
    await pending[0];
    expect(seen).toEqual([{ generation: 1, service: 1 }]);
    expect(endpoints[0]!.describe()[0]!.eventDiagnostics.dispatchFailures).toBe(0);
    await root.transact(() => prepare(2));
    await pending[1];
    expect(seen).toEqual([{ generation: 1, service: 1 }, { generation: 2, service: 2 }]);
    expect(endpoints[1]!.describe()[0]!.eventDiagnostics.dispatchFailures).toBe(0);

    const committed = root.snapshot;
    await expect(root.transact(() => prepare(3, undefined, true))).rejects.toThrow('candidate login failed');
    // Best-effort system events acknowledge buffering, but rollback must drop
    // them without ever dispatching against the committed old snapshot.
    await pending[2];
    expect(endpoints[2]!.describe()[0]!.eventDiagnostics.buffered).toBe(0);
    expect(root.snapshot).toBe(committed);
    expect(seen).toHaveLength(2);

    const foreign = createGenerationAdmissionGate();
    const foreignRoot = new RootController(empty);
    await foreignRoot.start(() => ({ snapshot: { ...empty, projections: new Map([[adapterFeatureId, { [generationAdmissionSource]: [foreign] }]]) }, dispose: () => undefined }));
    try {
      await expect(root.transact(() => prepare(4, foreign))).rejects.toThrow('another SnapshotStore');
      await pending[3];
      expect(endpoints[3]!.describe()[0]!.eventDiagnostics.buffered).toBe(0);
      expect(root.snapshot).toBe(committed);
      expect(foreignRoot.generation).toBe(1);
      expect(foreign.active).toBe(true);
      expect(seen).toHaveLength(2);
      const lease = root.snapshots.acquire(); expect(lease.value).toBe(committed); lease.release();
      await sinks[1]!.emit('system.receive', { type: 'system', name: 'system.online', id: 'old-still-live', timestamp: Date.now(), metadata: {} });
      expect(seen.at(-1)).toEqual({ generation: 2, service: 2 });
      expect(seen).toHaveLength(3);
    } finally { await foreignRoot.stop(); }
  } finally { await root.stop(); }
});
