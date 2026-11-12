import { ingressInferenceFixture } from './inference-fixture.js';
import { assistantTextReply } from '../../../../../agent/tests/helpers/mock-llm-api.js';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec, type Endpoint, type EndpointProfile } from '@zhin.js/adapter';
import { ImRuntime, ingressRouteToken } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { AgentTurnIngressRoute } from '@zhin.js/agent/runtime';

it('identifies an unaddressed group participant from the original native account without a profile network read', async () => {
  const read = vi.fn(async () => ({ nickname: 'Native account name' }));
  class NativeEndpoint implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start: () => this[endpointSpec].reportSelfUserId('actual-account'), open() {}, close() {}, stop() {}, send: async () => 'sent',
      profile: { writableFields: [], current: { nickname: 'Native account name' }, read } satisfies EndpointProfile,
    });
  }
  class NativeAdapter extends Adapter<NativeEndpoint> { protected createEndpoint() { return new NativeEndpoint(); } }
  const root = rootPluginId(), im = new ImRuntime({ conversationEvents: new MemoryConversationEventStore() });
  const adapter = new NativeAdapter();
  const inference = ingressInferenceFixture({ respond: () => assistantTextReply('{"engage":false,"confidence":0.9,"reason":"not addressed"}') });
  const executeLeased = vi.fn();
  const route = new AgentTurnIngressRoute({ withInferenceScope: inference.withInferenceScope, projectRoot: '/host', im, runtime: { executeLeased } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: { service: {
      getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', nickname: 'Configured AI nickname', mcpServers: [] }) }),
      getTriggerConfig: () => ({ enabled: true, ambient: { conversations: ['*'], quietMs: 0, cooldownMs: 0, judgeIntervalMs: 0 } }),
      getAgentConfig: () => ({}),
    }, agent: {} } as never,
  });
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'native-profile', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { endpoints: [{ id: 'account' }] }]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [ingressRouteToken.id, route]])]]),
  };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  im.attach(store);
  try {
    await index.start(); index.open();
    const endpoint = adapter.getEndpoint(adapter.list()[0]!.instanceId)!;
    await endpoint[endpointSpec].events.message({ conversation: { endpoint: { id: 'normalizer', adapter: 'normalizer' }, kind: 'group', id: 'group' },
      content: 'An unanswered question', endpointId: 'account', sender: { id: 'member' }, event: {},
      message: { conversation: { endpoint: { id: 'normalizer', adapter: 'normalizer' }, kind: 'group', id: 'group' }, id: 'native-message' } });
    expect(inference.requests).toHaveLength(1);
    expect(inference.closed).toBe(1);
    expect(inference.generations).toEqual([store.current]);
    const context = inference.requests[0]?.context;
    expect(JSON.stringify(context)).toContain('Native account name');
    expect(JSON.stringify(context)).not.toContain('Configured AI nickname');
    expect(read).not.toHaveBeenCalled();
    expect(executeLeased).not.toHaveBeenCalled();
  } finally { route.dispose(); await index.stop(); await store.close(); }
});
