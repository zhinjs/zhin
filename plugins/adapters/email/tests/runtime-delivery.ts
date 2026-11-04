import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from 'zhin.js/adapter';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '../../../../packages/im/plugin-runtime/src/index.js';
import { ImRuntime } from '@zhin.js/core/runtime';
import type { EmailEndpoint } from '../src/endpoint.js';

/** Real unified rendering/middleware/AdapterIndex/Endpoint receipt path. */
export async function emailDeliveryRuntime(factory: () => EmailEndpoint) {
  class FixtureAdapter extends Adapter<EmailEndpoint> { protected createEndpoint(): EmailEndpoint { return factory(); } }
  const root = rootPluginId();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'email', source: '/fixture/email', definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new FixtureAdapter() }) });
  const base: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@fixture/root', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map([[endpointEventGatewayToken.id, createTestEventGateway()]])]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  };
  const adapters = await AdapterIndex.create([slot], createSnapshotView(0, base), new AbortController().signal);
  const store = new SnapshotStore({ ...base, projections: new Map([[adapterFeatureId, adapters]]) });
  const im = new ImRuntime(); im.attach(store);
  await adapters.start(); adapters.open();
  return {
    send: (content: import('@zhin.js/core/runtime').SendContent = 'fixture', target = 'actor@example.com') => im.send({ requester: root, conversation: { endpoint: { id: String(slot.id), adapter: String(root) }, kind: 'private', id: target }, content }),
    close: async () => { await adapters.stop(); await store.close(); },
  };
}
