import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, projectLocaleToken, PluginOutboundHost,
  userLocalePreferencesToken, type Locale, type TokenId, type FeatureId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken, type EndpointSendRequest } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '@zhin.js/middleware';
import { ImRuntime, type Message, type SendContent, type OutboundEnvelope } from '../../src/plugin-runtime/im/index.js';
import { createOutboundHost } from '../../src/plugin-runtime/im/host/outbound-host-installer.js';
import { createRuntimeProactiveOutbound } from '../../../agent/src/plugin-runtime/host/runtime-factory.js';
import { EndpointDeliveryError, type DeliveryReceipt } from '@zhin.js/im-contract';
import { createNotificationRouter, createTaskExecutor, TimerScheduler, ScheduleJobStore } from '../../../agent/src/index.js';
import { createScheduleAuditRecord } from '../../../agent/src/schedule-domain/audit-logger.js';
import type { ScheduleJob } from '../../../agent/src/assistant/types.js';

async function fixture(projectLocale: Locale, replace = false, partial = false) {
  const root = rootPluginId();
  const im = new ImRuntime();
  const sent: EndpointSendRequest[] = [];
  let userLocale: Locale = 'en';
  class MemoryClient {
    async send(request: EndpointSendRequest) {
      sent.push(request);
      if (partial) throw new EndpointDeliveryError('connection_lost', 'Later bubble is unconfirmed', 'unknown', { parts: [{ messageId: 'confirmed-first' }] });
      return `m${sent.length}`;
    }
  }
  class MemoryEndpoint extends MemoryClient implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: request => this.send(request) });
  }
  const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'memory', source: '/adapters/memory/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new class extends Adapter<MemoryEndpoint> { protected createEndpoint() { return new MemoryEndpoint(); } }() }) });
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
    resources: new Map([[root, new Map<TokenId, unknown>([
      [projectLocaleToken.id, projectLocale], [endpointEventGatewayToken.id, im.endpointEvents],
      [userLocalePreferencesToken.id, { get: async () => userLocale, set: async () => undefined }],
    ])]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([
    [adapterFeatureId, adapters], [commandFeatureId, new CommandIndex([command], view)],
    [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
  ]) });
  im.attach(store); await adapters.start(); adapters.open();
  const row = im.endpoints.list()[0]!;
  return { im, sent, row, async receive() {
    return im.endpointEvents.receive({ name: 'message.receive', endpoint: { ...row.endpoint, id: row.id as never }, client: adapters.clientById(row.id as never)!,
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

it('carries captured language through owner-bound Host sends, exact targets and scheduled proactive sends', async () => {
  const f = await fixture('zh-CN');
  try {
    const host = new PluginOutboundHost(rootPluginId(), createOutboundHost(f.im));
    const conversation = { kind: 'channel' as const, id: 'room', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 'thread' };
    await host.send({ adapter: f.row.endpoint.adapter, endpointKey: f.row.endpoint.id, conversation, content: '后台原文', locale: 'en' });
    await host.sendTarget!({ ...conversation, endpoint: f.row.endpoint }, '队列原文', { locale: 'en' });
    const proactive = createRuntimeProactiveOutbound(f.im);
    await proactive.send({ scene: { platform: f.row.endpoint.adapter, endpointKey: f.row.endpoint.id, kind: 'private', sceneId: 'recipient' }, source: 'scheduled', locale: 'en' }, '计划原文');
    expect(f.sent.map(request => request.locale)).toEqual(['en', 'en', 'en']);
    expect(f.sent[0]!.conversation).toMatchObject(conversation);
    expect(f.sent[1]!.conversation).toMatchObject(conversation);
    expect(JSON.stringify(f.sent.map(request => request.payload))).toContain('后台原文');
    expect(JSON.stringify(f.sent.map(request => request.payload))).toContain('队列原文');
    expect(JSON.stringify(f.sent.map(request => request.payload))).toContain('计划原文');
  } finally { await f.stop(); }
});

it('keeps a real partial unified-send receipt separate from completed scheduled work without replay', async () => {
  const f = await fixture('zh-CN', false, true);
  const proactive = createRuntimeProactiveOutbound(f.im);
  const execute = vi.fn(async () => {
    const output = 'Already completed task';
    return { success: true, output, durationMs: 7, toolsUsed: [], tokenUsage: { input: 3, output: 2 },
      audit: createScheduleAuditRecord({ jobId: 'partial-job', executionId: 'fixture-execution', timestamp: 1,
        prompt: 'Fixture', toolsResolved: [], toolsResolvedBy: 'affinity', skillsResolved: [], missingTools: [], missingSkills: [],
        toolsUsed: [], tokenUsage: { input: 3, output: 2 }, durationMs: 7, securityDenials: [], success: true,
        outputLength: output.length, outputStripped: [] }) };
  });
  const router = createNotificationRouter({ resolveAdapter: () => undefined,
    sendIm: async (notify, content) => {
      let receipt: DeliveryReceipt | undefined;
      await proactive.send({ scene: notify.target.scene, source: 'scheduled', onReceipt: value => { receipt = value; } }, content);
      return receipt;
    } });
  const executor = createTaskExecutor({ domain: { execute }, router });
  const dataDir = await mkdtemp(join(tmpdir(), 'zhin-outbound-locale-'));
  const scheduler = new TimerScheduler({
    store: new ScheduleJobStore({ dataDir }),
    due: { run: (job, opts) => executor.execute(job, { signal: opts.signal, attempt: opts.attempt }) },
    router,
    queue: { maxRetries: 1 },
  });
  const job: ScheduleJob = { id: 'partial-job', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
    action: { kind: 'agent', prompt: 'Fixture' }, notify: { channel: 'im', target: { channel: 'im', scene: {
      platform: f.row.endpoint.adapter, endpointKey: f.row.endpoint.id, kind: 'private', sceneId: 'recipient',
    } } }, createdAt: 1, updatedAt: 1, state: {} };
  try {
    const result = await scheduler.deliver(job);
    expect(result).toMatchObject({ success: true, output: 'Already completed task', durationMs: 7,
      delivery: { status: 'partial', deliveryUnknown: true, messages: [{ id: 'confirmed-first', conversation: {
        endpoint: f.row.endpoint, kind: 'private', id: 'recipient',
      } }] } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(1);
  } finally { await scheduler.stop(); scheduler.unload(); await executor.dispose(); await rm(dataDir, { recursive: true, force: true }); await f.stop(); }
});

it('observes the same successful proactive receipt without letting observer failure repeat or reject its send', async () => {
  const f = await fixture('zh-CN');
  const onReceipt = vi.fn(async () => { throw new Error('observer unavailable'); });
  try {
    expect(await createRuntimeProactiveOutbound(f.im).send({ scene: { platform: f.row.endpoint.adapter,
      endpointKey: f.row.endpoint.id, kind: 'private', sceneId: 'recipient' }, source: 'scheduled', onReceipt }, 'Once'))
      .toBe('m1');
    expect(onReceipt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'sent', message: expect.objectContaining({ id: 'm1' }) }));
    expect(f.sent).toHaveLength(1);
  } finally { await f.stop(); }
});
