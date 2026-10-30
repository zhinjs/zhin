import { describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec,
  type EndpointDesiredRepository, type EndpointDesiredSnapshot, type PlatformEndpoint } from '@zhin.js/adapter';
import { ImRuntime, ingressRouteToken } from '@zhin.js/core/runtime';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { TurnRequest } from '@zhin.js/agent';
import { AgentTurnIngressRoute } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';

class LocalEndpoint implements PlatformEndpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {}, send: async () => 'sent',
  });
}
class LocalAdapter extends Adapter<LocalEndpoint> {
  protected createEndpoint() { return new LocalEndpoint(); }
}
async function fixture() {
  const requests: TurnRequest[] = [], childCancelled: string[] = [], finish: Array<() => void> = [];
  const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) => {
    requests.push(request);
    // A cooperative child operation sees the exact signal supplied to the real Agent request.
    await new Promise<void>(resolve => {
      const cancelled = () => { childCancelled.push(request.session.personal!.subjectId); resolve(); };
      request.signal.addEventListener('abort', cancelled, { once: true });
      finish.push(() => { request.signal.removeEventListener('abort', cancelled); resolve(); });
      if (request.signal.aborted) cancelled();
    });
    return { status: 'completed', output: [] };
  });
  const im = new ImRuntime(), adapter = new LocalAdapter(), root = rootPluginId();
  const route = new AgentTurnIngressRoute({ projectRoot: '/host-a', runtime: { executeLeased } as never, im,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: {
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'fixture', model: 'fixture' }) }),
      getTriggerConfig: () => ({ enabled: true }), getAgentConfig: () => ({ inboundQueue: { merge: { enabled: false } } }),
    }, agent: {} } as never });
  let saved: EndpointDesiredSnapshot | undefined;
  const repository: EndpointDesiredRepository = {
    load: async () => saved,
    compareAndSet: async (_id, revision, endpoints) => {
      if ((saved?.revision ?? null) !== revision) throw new Error('conflict');
      return saved = structuredClone({ revision: (revision ?? 0) + 1, endpoints });
    },
  };
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'local-cancellation', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { endpoints: [{ id: 'one' }, { id: 'two' }] }]]),
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [ingressRouteToken.id, route]])]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, { repository });
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  im.attach(store); await index.start(); index.open();
  const rows = adapter.list(), one = adapter.getEndpoint(rows[0]!.instanceId)!, two = adapter.getEndpoint(rows[1]!.instanceId)!;
  return { adapter, rows, one, two, requests, childCancelled, store,
    receive(endpoint: LocalEndpoint, subjectId: string) {
      return endpoint[endpointSpec].events.message({ conversation: { endpoint: { id: 'ignored-normalizer-id', adapter: 'ignored' }, kind: 'group', id: 'room' },
        content: '#hello', endpointId: endpoint === one ? 'one' : 'two', sender: { id: subjectId }, event: { subjectId } });
    },
    finish: () => finish.splice(0).forEach(resolve => resolve()),
    async close() { route.dispose(); await index.stop(); await store.close(); },
  };
}

describe('IM Endpoint cancellation into Agent turns', () => {
  it.each(['stop', 'update'] as const)('cancels the real turn and cooperative child on %s, preserving another account', async action => {
    const f = await fixture();
    const one = f.receive(f.one, 'alice'), two = f.receive(f.two, 'bob');
    let changing: ReturnType<LocalAdapter['stop']> | undefined;
    try {
      await vi.waitFor(() => expect(f.requests).toHaveLength(2));
      const alice = f.requests.find(request => request.session.personal?.subjectId === 'alice')!;
      const bob = f.requests.find(request => request.session.personal?.subjectId === 'bob')!;
      expect(alice.signal.aborted).toBe(false); expect(bob.signal.aborted).toBe(false);
      changing = action === 'stop' ? f.adapter.stop(f.rows[0]!.instanceId, f.adapter.revision)
        : f.adapter.update(f.rows[0]!.instanceId, f.adapter.revision, { config: { id: 'one', changed: true } });
      await vi.waitFor(() => expect(alice.signal.aborted).toBe(true));
      expect(f.childCancelled).toEqual(['alice']);
      expect(bob.signal.aborted).toBe(false);
      expect(f.adapter.getEndpoint(f.rows[1]!.instanceId)).toBe(f.two);
      await one;
      expect((await changing).execution.status).toBe('applied');
      expect(f.store.current.generation).toBe(0);
      if (action === 'update') expect(f.adapter.getEndpoint(f.rows[0]!.instanceId)).not.toBe(f.one);
    } finally {
      f.finish(); await Promise.all([one, two]); await changing; await f.close();
    }
  });
});
