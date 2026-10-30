import { SnapshotStore, createCapabilitySlot, featureId, rootPluginId, type RuntimeSnapshot, type TokenId } from 'zhin.js';
import {
  Adapter, AdapterIndex, defineAdapter, endpointEventGatewayToken,
  type Endpoint, type EndpointEventGateway, type EndpointSendRequest,
  type AdapterOperation, type AdapterDefinition,
  type EndpointDesiredRepository,
} from 'zhin.js/adapter';

/** Exercise native Endpoints through the same owning Adapter/Index used in production. */
export async function createEndpointHarness<E extends Endpoint>(
  factory: () => E,
  options: { readonly id?: string; readonly name?: string; readonly gateway?: EndpointEventGateway;
    readonly capabilities?: readonly ('inbound' | 'outbound')[]; readonly operations?: readonly AdapterOperation[] } = {},
) {
  class TestAdapter extends Adapter<E> { protected createEndpoint(): E { return factory(); } }
  const adapter: Adapter<E> = new TestAdapter();
  const harness = await createAdapterHarness(defineAdapter({
    capabilities: options.capabilities ?? ['inbound'], operations: options.operations, createAdapter: () => adapter,
  }), { id: options.id ?? options.name ?? 'test-endpoint' }, options);
  const endpoint = adapter.getEndpoint(adapter.list()[0]!.instanceId)!;
  return { ...harness, adapter, endpoint };
}

/** Load an actual platform convention definition through the production directory and admission gate. */
export async function createAdapterHarness<Config>(
  definition: AdapterDefinition<Config>, config: Config,
  options: Readonly<{ name?: string; gateway?: EndpointEventGateway; resources?: ReadonlyMap<TokenId, unknown>;
    repository?: EndpointDesiredRepository }> = {},
) {
  const root = rootPluginId();
  const name = options.name ?? 'test-endpoint';
  const slot = createCapabilitySlot({ owner: root, feature: featureId('zhin.adapter'), localName: name,
    source: '/fixture/adapter/index.ts', definition });
  const snapshot: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'endpoint-test', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, config]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map<TokenId, unknown>([...(options.resources ?? []), [endpointEventGatewayToken.id,
      options.gateway ?? { receive: async () => undefined }]])]]),
  };
  const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal,
    { repository: options.repository });
  const adapter = index.adapter(slot.id);
  if (!adapter) throw new Error('The platform definition did not install its Adapter');
  const canonicalId = () => {
    const first = adapter.list()[0];
    if (!first) throw new Error('The test Adapter has no desired Endpoint');
    return first.canonicalId;
  };
  let store: SnapshotStore | undefined;
  return {
    get endpoint() { const first = adapter.list()[0]; return first && adapter.getEndpoint(first.instanceId); },
    adapter, index, get canonicalId() { return canonicalId(); },
    start: (signal: AbortSignal = new AbortController().signal) => index.start(signal),
    open: () => {
      const { generation: _generation, ...state } = snapshot;
      store ??= new SnapshotStore({ ...state, projections: new Map([[featureId('zhin.adapter'), index]]) });
      index.open();
    },
    close: () => index.close(),
    stop: async () => { await store?.close(); await index.stop(); },
    send: (request: EndpointSendRequest) => index.send(canonicalId(), request),
  };
}

/** Connect protocol message/side-event assertions to the real unified Index ingress. */
export function createTestEventGateway(
  messages?: { receive?(payload: unknown): unknown },
  sideEvents?: { receiveNotice?(payload: unknown): unknown; receiveRequest?(payload: unknown): unknown; receiveSystem?(payload: unknown): unknown },
): EndpointEventGateway {
  return { async receive(event) {
    switch (event.name) {
      case 'message.receive': return messages?.receive?.(event.payload);
      case 'notice.receive': return sideEvents?.receiveNotice?.(event.payload);
      case 'request.receive': return sideEvents?.receiveRequest?.(event.payload);
      case 'system.receive': return sideEvents?.receiveSystem?.(event.payload);
      default: return undefined;
    }
  } };
}
