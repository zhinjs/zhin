/**
 * zhinjs/zhin#1250 (ADR 0060 §5.4, M2 review): the Console Sandbox identity port reaches only Adapters
 * whose profile declares a local simulation (`runtime.sandbox`), bound to their owner; the unbound
 * Root port never reaches Adapter code.
 */
import { describe, expect, it } from 'vitest';
import {
  childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec,
  type AdapterContext, type Endpoint, type EndpointEventGateway, type SimulatedConsoleSpeakerHost,
} from '../src/index.js';

class TestEndpoint implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => 'sent' });
}

describe('simulated Console speaker port (#1250 M2)', () => {
  it('only a runtime.sandbox Adapter gets AdapterContext.consoleSpeaker, bound to its owner', async () => {
    const root = rootPluginId();
    const real = childPluginId(root, 'real');
    const sim = childPluginId(root, 'sim');
    const contexts = new Map<string, AdapterContext>();
    const initializations: unknown[] = [];
    class TestAdapter extends Adapter<TestEndpoint> {
      constructor(name: string, context: AdapterContext) { super(); contexts.set(name, context); }
      override async initialize(...args: Parameters<Adapter<TestEndpoint>['initialize']>) { initializations.push(args[0]); return super.initialize(...args); }
      protected createEndpoint() { return new TestEndpoint(); }
    }
    const slot = (owner: typeof real, name: string, profile: object) => createCapabilitySlot({ owner, feature: adapterFeatureId, localName: name,
      source: `/project/${name}/index.ts`, definition: defineAdapter({ capabilities: ['inbound', 'outbound'], profile, createAdapter: context => new TestAdapter(name, context) }) });
    const realSlot = slot(real, 'real', { default: { delivery: { send: true } } });
    const simSlot = slot(sim, 'sim', { default: { delivery: { send: true }, runtime: { sandbox: true } } });
    const node = (id: typeof real, instanceKey: string) => ({ id, instanceKey, packageName: `@test/${instanceKey}`, packageRoot: `/project/${instanceKey}`, parent: root, children: [] });
    const gateway: EndpointEventGateway = { run: receive => receive({ receive: async () => undefined }), receive: async () => undefined };
    const state: SnapshotState = {
      root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [real, sim] }],
        [real, node(real, 'real')], [sim, node(sim, 'sim')]]) as never,
      config: new Map([[root, {}], [real, { endpoints: [{ id: 'bot' }] }], [sim, { endpoints: [{ id: 'dev' }] }]]),
      resources: new Map([[root, new Map()], [real, new Map([[endpointEventGatewayToken.id, gateway]])], [sim, new Map([[endpointEventGatewayToken.id, gateway]])]]),
      capabilities: new Map<CapabilityId, CapabilitySlot>([[realSlot.id, realSlot], [simSlot.id, simSlot]]), projections: new Map(),
    };
    const calls: unknown[] = [];
    const host: SimulatedConsoleSpeakerHost = { ensure: async request => { calls.push(request); } };
    const index = await AdapterIndex.create([realSlot, simSlot], createSnapshotView(0, state), new AbortController().signal, { consoleSpeaker: host });
    try {
      expect(contexts.get('real')?.consoleSpeaker).toBeUndefined();
      const port = contexts.get('sim')?.consoleSpeaker;
      expect(port).toBeDefined();
      const conversation = { endpoint: { id: 'dev', adapter: 'sim' }, kind: 'private', id: 'r' } as never;
      const principal = { kind: 'user', userId: 'u1' };
      await port!.ensure(conversation, principal);
      // Bound to the Adapter's own owner: the Adapter cannot name another plugin.
      expect(calls).toEqual([{ owner: sim, conversation, principal }]);
      // The unbound Root port never reaches Adapter code.
      expect(initializations).toHaveLength(2);
      for (const input of initializations) expect(Object.values(input as object)).not.toContain(host);
    } finally { await index.stop(); }
  });
});
