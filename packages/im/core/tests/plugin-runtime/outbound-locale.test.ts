import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, projectLocaleToken,
  userLocalePreferencesToken, type Locale, type SnapshotState } from '@zhin.js/plugin-runtime';
import { AdapterIndex, Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken, type EndpointSendRequest } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '@zhin.js/middleware';
import { ImRuntime, type Message, type SendContent, type OutboundEnvelope } from '../../src/plugin-runtime/im/index.js';

async function fixture(projectLocale: Locale, replace = false) {
  const root = rootPluginId();
  const im = new ImRuntime();
  const sent: EndpointSendRequest[] = [];
  let userLocale: Locale = 'en';
  class MemoryEndpoint extends Endpoint<object> {
    readonly client = {};
    start() {} open() {} close() {} stop() {}
    async send(request: EndpointSendRequest) { sent.push(request); return `m${sent.length}`; }
  }
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'memory', source: '/adapters/memory/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], create: () => new MemoryEndpoint() }) });
  const command = createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: 'multiple', source: '/commands/multiple/index.ts',
    definition: defineCommand<{}, SendContent, Message>({ async execute({ input }) {
      await input!.$reply('第一条原文');
      userLocale = 'zh-CN';
      await input!.$reply('第二条原文');
      return '第三条原文';
    } }) });
  const middleware = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'replace', source: '/middlewares/replace/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', async handle({ input }, next) {
      if (replace) input.replace('替换后的原文');
      await next();
    } }) });
  const slots = [adapter, command, middleware];
  const state: SnapshotState = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/locale', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { commandPrefix: '/', locale: projectLocale }]]),
    resources: new Map([[root, new Map<string, unknown>([
      [projectLocaleToken.id, projectLocale], [endpointEventGatewayToken.id, im.endpointEvents],
      [userLocalePreferencesToken.id, { get: async () => userLocale, set: async () => undefined }],
    ])]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<string, unknown>([
    [adapterFeatureId, adapters], [commandFeatureId, new CommandIndex([command], view)],
    [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
  ]) as SnapshotState['projections'] });
  im.attach(store); await adapters.start(); adapters.open();
  const row = im.endpoints.list()[0]!;
  return { im, sent, row, async receive() {
    return im.endpointEvents.receive({ name: 'message.receive', endpoint: { ...row.endpoint, id: row.id as never }, client: {},
      payload: { conversation: { endpoint: row.endpoint, kind: 'group', id: 'room' }, sender: { id: 'alice' }, content: '/multiple' } });
  }, async stop() { await store.close(); await adapters.stop(); } };
}

it.each([false, true])('keeps personal operation language through all replies and outbound replacement=%s', async replace => {
  const f = await fixture('zh-CN', replace);
  try {
    await f.receive();
    expect(f.sent).toHaveLength(3);
    expect(f.sent.map(request => request.locale)).toEqual(['en', 'en', 'en']);
    expect(JSON.stringify(f.sent.map(request => request.payload))).toContain(replace ? '替换后的原文' : '第一条原文');
    await f.receive();
    expect(f.sent.slice(3).map(request => request.locale)).toEqual(['zh-CN', 'zh-CN', 'zh-CN']);
  } finally { await f.stop(); }
});

it.each<Locale>(['en', 'zh-CN'])('uses snapshot project language %s for an explicit send without incoming context', async locale => {
  const f = await fixture(locale);
  try {
    await f.im.endpoints.send({ adapter: f.row.endpoint.adapter, endpointKey: f.row.endpoint.id,
      conversation: { kind: 'private', id: 'recipient' }, content: '原始内容' });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.locale).toBe(locale);
    expect(JSON.stringify(f.sent[0]!.payload)).toContain('原始内容');
  } finally { await f.stop(); }
});
