import { AdapterIndex, Endpoint, defineAdapter, adapterFeatureId, endpointEventGatewayToken, type EndpointSendRequest } from '../../../../packages/im/adapter/src/index.js';
import { HandlerIndex, handlerFeatureId } from '../../../../packages/im/handler/src/index.js';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '../../../../packages/im/middleware/src/index.js';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, childPluginId, type SnapshotState } from '../../../../packages/im/plugin-runtime/src/index.js';
import { ImRuntime, outboundMessageToken, type IncomingNotice, type OutboundEnvelope } from '../../../../packages/im/core/src/plugin-runtime/im/index.js';
import { EndpointDeliveryError } from '../../../../packages/im/im-contract/src/index.js';
import type { DeliveryTarget } from 'zhin.js';
import welcome from '../handlers/welcome/index.js';

async function fixture() {
  const root = rootPluginId();
  const first = childPluginId(root, 'account-one'); const second = childPluginId(root, 'account-two');
  const alpha = childPluginId(root, 'alpha'); const beta = childPluginId(root, 'beta');
  const im = new ImRuntime(); const sent: EndpointSendRequest[] = []; const requesters: string[] = [];
  let failure: 'unknown' | 'not_sent' | undefined;
  class MemoryEndpoint extends Endpoint<object> {
    readonly client = {};
    start() {} stop() {} open() {} close() {}
    async send(request: EndpointSendRequest) {
      sent.push(request);
      if (failure) throw new EndpointDeliveryError('synthetic_delivery_failure', 'synthetic delivery failure', failure);
      return `message-${sent.length}`;
    }
  }
  const adapters = ([[first, 'memory'], [second, 'memory'], [first, 'another']] as const).map(([owner, localName]) => createCapabilitySlot({
    owner, feature: adapterFeatureId, localName, source: `/adapters/${localName}/index.ts`,
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], segments: { markdown: 'text', interactive: 'text' }, create: () => new MemoryEndpoint() }),
  }));
  const handlers = [alpha, beta].map(owner => createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'welcome',
    source: '/handlers/welcome/index.ts', definition: welcome }));
  const observer = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'observe', source: '/middlewares/observe/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', async handle({ input }, next) { requesters.push(input.requester); await next(); } }) });
  const ids = [root, first, second, alpha, beta];
  const state: SnapshotState = { root,
    tree: new Map(ids.map(id => [id, { id, ...(id === root ? {} : { parent: root }), instanceKey: id.split('/').at(-1)!,
      packageName: '@test/welcome-scope', packageRoot: '/project', children: id === root ? ids.slice(1) : [] }])),
    config: new Map(ids.map(id => [id, id === alpha ? { welcomeMessage: '欢迎 {name} ({id})', welcomeConversations: [] }
      : id === beta ? { welcomeMessage: 'not enabled', welcomeConversations: [] } : {}])),
    capabilities: new Map([...adapters, ...handlers, observer].map(slot => [slot.id, slot])), projections: new Map(),
    resources: new Map(ids.map(id => [id, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }], [outboundMessageToken.id, im]])])),
  };
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create(adapters, view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([
    [adapterFeatureId, index], [handlerFeatureId, new HandlerIndex(handlers, view)], [middlewareFeatureId, new MiddlewareIndex([observer], view)],
  ]) });
  im.attach(store); await index.start(); index.open();
  const target: DeliveryTarget = { endpoint: im.endpoints.list().find(item => item.id === String(adapters[0]!.id))!.endpoint,
    kind: 'group', id: 'same-group', parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };
  const config = new Map(store.current.config);
  config.set(alpha, { welcomeMessage: '欢迎 {name} ({id})', welcomeConversations: [target, target] });
  store.commit(0, { snapshot: createSnapshotView(1, { ...store.current, config }), dispose() {} });
  const notice: IncomingNotice = { id: 'joined', type: 'notice', name: 'notice.group.member_increase', timestamp: 1, metadata: {},
    conversation: { kind: target.kind, id: target.id, parent: target.parent, threadId: target.threadId }, target: { id: 'new', name: 'Bob' } };
  const receive = (payload = notice, endpointId = String(adapters[0]!.id)) => im.endpointEvents.receive({ name: 'notice.receive',
    endpoint: im.endpoints.list().find(item => item.id === endpointId)!.endpoint, payload, client: {} });
  return { target, alpha, sent, requesters, adapters, notice, receive,
    fail: (status: typeof failure) => { failure = status; },
    close: async () => { await store.close(); await index.stop(); },
  };
}

it('uses exact canonical notice identity across accounts, adapters, parents and threads, and preserves the original target and owner', async () => {
  const f = await fixture();
  try {
    await f.receive();
    expect(f.sent).toHaveLength(1); // Duplicate entries still produce only one send; beta is independently disabled.
    expect(f.sent[0]!.conversation).toEqual(f.target); expect(f.requesters).toEqual([f.alpha]);
    expect(f.sent[0]!.payload).toEqual([{ type: 'text', data: { text: '欢迎 Bob (new)' } }]);
    for (const adapter of f.adapters.slice(1)) await f.receive(f.notice, String(adapter.id));
    const conversation = f.notice.conversation!;
    for (const changed of [
      { ...conversation, id: 'other' }, { ...conversation, parent: undefined },
      { ...conversation, parent: { kind: 'group' as const, id: 'parent' } },
      { ...conversation, parent: { kind: 'channel' as const, id: 'other' } },
      { ...conversation, threadId: undefined }, { ...conversation, threadId: 'other' },
      { ...conversation, kind: 'private' as const }, { ...conversation, kind: 'channel' as const },
    ]) await f.receive({ ...f.notice, conversation: changed });
    await f.receive({ ...f.notice, conversation: undefined }); await f.receive({ ...f.notice, target: undefined });
    await f.receive({ ...f.notice, name: 'notice.group.member_decrease' });
    expect(f.sent).toHaveLength(1);
  } finally { await f.close(); }
});

it.each(['unknown', 'not_sent'] as const)('reports %s delivery once without retrying or changing the target', async status => {
  const f = await fixture();
  try {
    f.fail(status); await expect(f.receive()).rejects.toThrow('Group welcome delivery');
    expect(f.sent).toHaveLength(1); expect(f.sent[0]!.conversation).toEqual(f.target); expect(f.requesters).toEqual([f.alpha]);
  } finally { await f.close(); }
});
