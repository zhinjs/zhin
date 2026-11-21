/**
 * zhinjs/zhin#1250 (ADR 0060 §5.4, M2 / N1 review): the Console Sandbox identity port reaches only
 * trusted Adapters — a local simulation (`runtime.sandbox`) shipped by `@zhin.js/adapter-sandbox` —
 * bound to their owner; a third-party plugin declaring `runtime.sandbox` gets none, and the unbound
 * Root port never reaches Adapter code.
 */
import { describe, expect, it } from 'vitest';
import {
  childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec,
  declaresLocalSimulation, isTrustedSimulationAdapter, TRUSTED_SIMULATION_ADAPTER_PACKAGES,
  type AdapterContext, type Endpoint, type EndpointEventGateway, type SimulatedConsoleSpeakerHost,
} from '../src/index.js';

class TestEndpoint implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => 'sent' });
}

describe('simulated Console speaker port (#1250 M2)', () => {
  it('only a trusted runtime.sandbox Adapter gets AdapterContext.consoleSpeaker, bound to its owner', async () => {
    const root = rootPluginId();
    const real = childPluginId(root, 'real');
    const sim = childPluginId(root, 'sim');
    const fake = childPluginId(root, 'fake');
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
    // N1 (b): a third-party plugin that declares `runtime.sandbox` stays a simulation, without the port.
    const fakeSlot = slot(fake, 'fake', { default: { delivery: { send: true }, runtime: { sandbox: true } } });
    const node = (id: typeof real, instanceKey: string, packageName = `@test/${instanceKey}`) =>
      ({ id, instanceKey, packageName, packageRoot: `/project/${instanceKey}`, parent: root, children: [] });
    const gateway: EndpointEventGateway = { run: receive => receive({ receive: async () => undefined }), receive: async () => undefined };
    const state: SnapshotState = {
      root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [real, sim, fake] }],
        [real, node(real, 'real')], [sim, node(sim, 'sim', '@zhin.js/adapter-sandbox')], [fake, node(fake, 'fake')]]) as never,
      config: new Map([[root, {}], [real, { endpoints: [{ id: 'bot' }] }], [sim, { endpoints: [{ id: 'dev' }] }], [fake, { endpoints: [{ id: 'x' }] }]]),
      resources: new Map([[root, new Map()], [real, new Map([[endpointEventGatewayToken.id, gateway]])], [sim, new Map([[endpointEventGatewayToken.id, gateway]])],
        [fake, new Map([[endpointEventGatewayToken.id, gateway]])]]),
      capabilities: new Map<CapabilityId, CapabilitySlot>([[realSlot.id, realSlot], [simSlot.id, simSlot], [fakeSlot.id, fakeSlot]]), projections: new Map(),
    };
    const calls: unknown[] = [];
    const host: SimulatedConsoleSpeakerHost = { ensure: async request => { calls.push(request); } };
    const index = await AdapterIndex.create([realSlot, simSlot, fakeSlot], createSnapshotView(0, state), new AbortController().signal, { consoleSpeaker: host });
    try {
      expect(contexts.get('real')?.consoleSpeaker).toBeUndefined();
      expect(contexts.get('fake')).toBeDefined();
      expect(contexts.get('fake')?.consoleSpeaker).toBeUndefined();
      const port = contexts.get('sim')?.consoleSpeaker;
      expect(port).toBeDefined();
      const conversation = { endpoint: { id: 'dev', adapter: 'sim' }, kind: 'private', id: 'r' } as never;
      const principal = { kind: 'user', userId: 'u1' };
      await port!.ensure(conversation, principal);
      // Bound to the Adapter's own owner: the Adapter cannot name another plugin.
      expect(calls).toEqual([{ owner: sim, conversation, principal }]);
      // The unbound Root port never reaches Adapter code.
      expect(initializations).toHaveLength(3);
      for (const input of initializations) expect(Object.values(input as object)).not.toContain(host);
    } finally { await index.stop(); }
  });

  it('one source for simulation and trust: runtime.sandbox, plus the trusted package for the port', () => {
    const simulation = { default: { delivery: { send: true }, runtime: { sandbox: true } } } as never;
    const platform = { default: { delivery: { send: true } } } as never;
    expect(TRUSTED_SIMULATION_ADAPTER_PACKAGES).toEqual(['@zhin.js/adapter-sandbox']);
    expect(declaresLocalSimulation(simulation)).toBe(true);
    expect(declaresLocalSimulation(platform)).toBe(false);
    expect(declaresLocalSimulation(undefined)).toBe(false);
    expect(isTrustedSimulationAdapter(simulation, '@zhin.js/adapter-sandbox')).toBe(true);
    expect(isTrustedSimulationAdapter(simulation, '@evil/adapter-sandbox')).toBe(false);
    expect(isTrustedSimulationAdapter(simulation, undefined)).toBe(false);
    expect(isTrustedSimulationAdapter(platform, '@zhin.js/adapter-sandbox')).toBe(false);
  });
});
