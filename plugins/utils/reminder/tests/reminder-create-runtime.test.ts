import { createTestEventGateway } from '../../../adapters/test-utils/endpoint.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Adapter, AdapterIndex, createEndpointSpecification, defineAdapter, endpointSpec, adapterFeatureId, endpointEventGatewayToken, type EndpointSendRequest } from '../../../../packages/im/adapter/src/index.js';
import { CommandIndex, commandFeatureId } from '../../../../packages/im/command/src/index.js';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '../../../../packages/im/middleware/src/index.js';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, childPluginId, PluginDatabaseHost, type SnapshotState } from '../../../../packages/im/plugin-runtime/src/index.js';
import { ImRuntime, type IncomingMessage } from '../../../../packages/im/core/src/plugin-runtime/im/index.js';
import type { OutboundEnvelope } from '../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import create from '../commands/remind/create/index.js';
import { ReminderService } from '../src/service.js';
import { reminderServiceToken } from '../src/runtime.js';
import type { ReminderConfig } from '../src/config.js';

async function fixture(options: { afterSend?: (count: number) => void; locale?: 'zh-CN' | 'en'; prefix?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-create-reminder-'));
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') }); await database.start();
  const root = rootPluginId(); const owner = childPluginId(root, 'personal'); const sent: EndpointSendRequest[] = []; let uncertainIn = 0;
  const outbound = { send: vi.fn(async () => null), sendTarget: vi.fn(async () => 'unused') };
  const config: ReminderConfig & { commandPrefix: string; locale: 'zh-CN' | 'en' } = { timezone: 'UTC', maxTasks: 20, adminMaxTasks: 20,
    maxTasksPerSender: 10, batchSize: 5, missedGraceSeconds: 15, commandPrefix: options.prefix ?? '/', locale: options.locale ?? 'zh-CN' };
  const service = new ReminderService(new PluginDatabaseHost(owner, database).state, outbound, config);
  const added = vi.spyOn(service, 'add');
  class MemoryClient {
    async send(request: EndpointSendRequest) {
      sent.push(request);
      options.afterSend?.(sent.length);
      if (uncertainIn > 0 && --uncertainIn === 0) throw new EndpointDeliveryError('delivery_unconfirmed', 'synthetic unknown', 'unknown');
      return `message-${sent.length}`;
    }
  }
  class MemoryEndpoint extends MemoryClient {
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start() {}, open() {}, close() {}, stop() {}, send: request => this.send(request),
    });
  }
  class MemoryAdapter extends Adapter<MemoryEndpoint> { protected createEndpoint() { return new MemoryEndpoint(); } }
  const slots = ['first', 'second'].map(localName => createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName,
    source: `/adapters/${localName}/index.ts`, definition: defineAdapter({ capabilities: ['inbound', 'outbound'],
      segments: { interactive: 'text', markdown: 'text', outboundMedia: ['url'] }, createAdapter: () => new MemoryAdapter() }) }));
  const command = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'remind/create',
    source: '/commands/remind/create/index.ts', definition: create });
  const requesters: string[] = [];
  const middleware = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'observe',
    source: '/middlewares/observe/index.ts', definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound',
      async handle({ input }, next) { requesters.push(input.requester); await next(); },
    }) });
  const capabilities = [...slots, command, middleware];
  const state: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: directory, children: [owner] }],
    [owner, { id: owner, parent: root, instanceKey: 'personal', packageName: '@test/reminder', packageRoot: directory, children: [] }],
  ]), config: new Map([[root, config], [owner, config]]), capabilities: new Map(capabilities.map(slot => [slot.id, slot])), projections: new Map(),
    resources: new Map([
      [root, new Map([[endpointEventGatewayToken.id, createTestEventGateway()]])],
      [owner, new Map([[endpointEventGatewayToken.id, createTestEventGateway()], [reminderServiceToken.id, service]])],
    ]) };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create(slots, view, new AbortController().signal);
  const index = new CommandIndex([command], view);
  const store = new SnapshotStore({ ...state, projections: new Map([
    [adapterFeatureId, adapters], [commandFeatureId, index], [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
  ]) });
  const im = new ImRuntime(); im.attach(store); await adapters.start(); adapters.open();
  const conversation = { endpoint: im.endpoints.list()[0]!.endpoint, kind: 'channel' as const, id: 'room',
    parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'topic' };
  const receive = async (content: string, overrides: Partial<IncomingMessage> = {}) => {
    const payload = { conversation, sender: { id: 'alice' }, content, ...overrides };
    const endpoint = im.endpoints.list().find(item => item.id === payload.conversation.endpoint.id)!.endpoint;
    return im.endpointEvents.receive({ name: 'message.receive', endpoint, payload, client: adapters.clientById(endpoint.id as typeof slots[number]['id']) });
  };
  return { sent, requesters, service, added, outbound, index, store, im, conversation, receive, owner,
    failPrompt: (after = 1) => { uncertainIn = after; },
    close: async () => { service.stop(); await store.close(); await adapters.stop(); await database.stop(); await rm(directory, { recursive: true, force: true }); },
  };
}
function rendered(sent: EndpointSendRequest[]): string { return JSON.stringify(sent.map(item => item.payload)); }

describe.skipIf(!sqliteAvailable)('remind create through actual CommandIndex, interaction and SQLite', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses English-only confirmation, preserves its locale and formats the actual prefix', async () => {
    const f = await fixture({ locale: 'en', prefix: '!' });
    const now = 1_800_000_000_000; const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const pending = f.receive('!remind create "in 10 minutes" Ship the report');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('Create this reminder?'));
      expect(rendered(f.sent)).not.toContain('确认创建');
      await f.receive('确认');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('No reminder was created. Enter'));
      expect(f.added).not.toHaveBeenCalled();
      await f.receive('confirm'); await pending;
      expect(f.added).toHaveBeenCalledTimes(1);
      const tasks = await f.service.list({ senderId: 'alice', target: f.conversation });
      expect(tasks[0]).toMatchObject({ locale: 'en', text: 'Ship the report', nextRunAt: now + 600_000 });
      clock.mockReturnValue(now + 600_000); await f.service.tick();
      expect(f.outbound.sendTarget).toHaveBeenCalledWith(f.conversation, '⏰ Reminder: Ship the report', { locale: 'en' });
      const incomplete = f.receive('!remind create');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('When should I remind you?'));
      await f.receive('cancel'); await incomplete;
      expect(rendered(f.sent)).toContain('Cancelled. No reminder was created.');
    } finally { await f.close(); }
  });

  it('does not accept an English confirmation in a Chinese flow', async () => {
    const f = await fixture();
    try {
      const pending = f.receive('/remind create 10分钟后 正文');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      await f.receive('confirm');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('请明确输入'));
      expect(f.added).not.toHaveBeenCalled();
      await f.receive('取消'); await pending;
      expect(f.added).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('requires confirmation even with complete arguments and creates exactly one personal task', async () => {
    const f = await fixture(); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const pending = f.receive('/remind create 10分钟后 交周报');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      expect(rendered(f.sent)).toContain('UTC'); expect(rendered(f.sent)).toContain('parent'); expect(rendered(f.sent)).toContain('topic');
      expect(f.added).not.toHaveBeenCalled();
      await f.receive('确认'); await pending;
      expect(f.added).toHaveBeenCalledTimes(1);
      const tasks = await f.service.list({ senderId: 'alice', target: f.conversation });
      expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ text: '交周报', nextRunAt: 1_800_000_600_000 });
      await f.receive('确认'); expect(f.added).toHaveBeenCalledTimes(1); expect(f.outbound.sendTarget).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('asks for missing fields, corrects invalid time and never treats a repeated command as body text', async () => {
    const f = await fixture(); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const pending = f.receive('/remind create');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('什么时候'));
      await f.receive('每天九点');
      await vi.waitFor(() => expect(f.sent.length).toBeGreaterThanOrEqual(2));
      expect(f.added).not.toHaveBeenCalled();
      await f.receive('10分钟后');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('提醒你做什么'));
      await f.receive('/remind create 20分钟后 其他任务');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('先取消'));
      await f.receive('写周报');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      await f.receive('确认'); await pending;
      expect(f.added).toHaveBeenCalledTimes(1); expect(f.added.mock.calls[0]![1]).toBe('写周报');
    } finally { await f.close(); }
  });

  it('preserves quoted multi-word time and literal Markdown reminder text in the confirmation', async () => {
    const f = await fixture(); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const text = '**正文** [链接](https://example.org/a_b)\n```literal```\n<h1>不是HTML</h1> # 不应伪装为标题';
      const pending = f.receive(`/remind create "明天 上午九点" ${text}`);
      await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      const content = f.sent[0]!.payload as Array<{ type: string; data: { text?: string } }>;
      expect(content).toHaveLength(1); expect(content[0]!.type).toBe('text');
      expect(f.requesters[0]).toBe(f.owner);
      expect(content.map(segment => segment.data.text ?? '').join('')).toContain(text);
      expect(rendered(f.sent)).toContain('2027-01-16 09:00:00');
      await f.receive('确认'); await pending;
      expect(f.added.mock.calls[0]![1]).toBe(text);
    } finally { await f.close(); }
  });

  it.each(['time', 'body', 'confirmation'])('accepts cancellation at the %s step without writing', async step => {
    const f = await fixture();
    try {
      const pending = f.receive(step === 'time' ? '/remind create' : step === 'body' ? '/remind create 10分钟后' : '/remind create 10分钟后 正文');
      await vi.waitFor(() => expect(rendered(f.sent)).toContain(step === 'confirmation' ? '确认创建' : step === 'body' ? '提醒你做什么' : '什么时候')); await f.receive('取消'); await pending;
      expect(f.added).not.toHaveBeenCalled(); expect(rendered(f.sent)).toContain('已取消');
    } finally { await f.close(); }
  });

  it('rejects another sender, account, parent and thread before accepting the originating confirmation', async () => {
    const f = await fixture();
    try {
      const pending = f.receive('/remind create 10分钟后 正文'); await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      await f.receive('确认', { sender: { id: 'bob' } });
      await f.receive('确认', { conversation: { ...f.conversation, endpoint: f.im.endpoints.list()[1]!.endpoint } });
      await f.receive('确认', { conversation: { ...f.conversation, parent: { kind: 'channel', id: 'other-parent' } } });
      await f.receive('确认', { conversation: { ...f.conversation, threadId: 'other-thread' } });
      expect(f.added).not.toHaveBeenCalled(); await f.receive('确认'); await pending; expect(f.added).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });

  it('runs concurrent senders and exact conversations without sharing reminder drafts', async () => {
    const f = await fixture();
    try {
      const sources = [
        { conversation: f.conversation, sender: { id: 'alice' } },
        { conversation: f.conversation, sender: { id: 'bob' } },
        { conversation: { ...f.conversation, endpoint: f.im.endpoints.list()[1]!.endpoint }, sender: { id: 'alice' } },
        { conversation: { ...f.conversation, parent: { kind: 'channel' as const, id: 'other-parent' } }, sender: { id: 'alice' } },
        { conversation: { ...f.conversation, threadId: 'other-topic' }, sender: { id: 'alice' } },
      ];
      const pending = sources.map((source, index) => f.receive(`/remind create 10分钟后 reminder-${index}`, source));
      await vi.waitFor(() => expect(f.sent.filter(item => JSON.stringify(item.payload).includes('确认创建'))).toHaveLength(5));
      await Promise.all(sources.map(source => f.receive('确认', source))); await Promise.all(pending);
      expect(f.added).toHaveBeenCalledTimes(5);
      for (const [index, source] of sources.entries()) {
        const tasks = await f.service.list({ senderId: source.sender.id, target: source.conversation });
        expect(tasks).toHaveLength(1); expect(tasks[0]!.text).toBe(`reminder-${index}`);
      }
    } finally { await f.close(); }
  });

  it('does not extend a logical step after invalid input and sends one timeout notice only', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(1_800_000_000_000);
    try {
      const pending = f.receive('/remind create');
      await vi.waitFor(() => expect(f.sent).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(50_000); await f.receive('每天九点');
      await vi.waitFor(() => expect(f.sent).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(11_000); await pending;
      expect(f.added).not.toHaveBeenCalled();
      const notices = f.sent.filter(item => JSON.stringify(item.payload).includes('提醒输入超时，未创建提醒'));
      expect(notices).toHaveLength(1);
      expect((await f.service.list({ senderId: 'alice', target: f.conversation }))).toEqual([]);
    } finally { vi.useRealTimers(); await f.close(); }
  });

  it('does not create after an expired confirmation, unknown prompt delivery or generation retirement', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const pending = f.receive('/remind create 1秒后 正文'); await vi.waitFor(() => expect(rendered(f.sent)).toContain('确认创建'));
      clock.mockReturnValue(Date.now() + 2000); await f.receive('确认'); await pending;
      expect(f.added).not.toHaveBeenCalled(); expect(rendered(f.sent)).toContain('不会自动顺延');
      f.failPrompt(); await f.receive('/remind create 10分钟后 unknown'); expect(f.added).not.toHaveBeenCalled();
      expect(f.sent.filter(item => JSON.stringify(item.payload).includes('正文（原样显示）') && JSON.stringify(item.payload).includes('unknown'))).toHaveLength(1);
      const retired = f.receive('/remind create 10分钟后 retired'); await vi.waitFor(() => expect(rendered(f.sent)).toContain('retired'));
      const before = f.sent.length; f.store.commit(0, { snapshot: f.store.current, dispose() {} }); await retired;
      expect(f.sent).toHaveLength(before); expect(f.added).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('does not create or retry when the confirmation question has unknown delivery', async () => {
    const f = await fixture();
    try {
      f.failPrompt(2); await f.receive('/remind create 10分钟后 正文');
      await f.receive('确认');
      expect(f.added).not.toHaveBeenCalled();
      expect(f.sent.filter(item => JSON.stringify(item.payload).includes('确认创建这条提醒'))).toHaveLength(1);
      expect(rendered(f.sent)).toContain('未创建提醒');
    } finally { await f.close(); }
  });

  it('reports an elapsed total deadline during preview delivery without asking or writing', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const f = await fixture({ afterSend: count => { if (count === 1) clock.mockReturnValue(1_800_000_181_000); } });
    try {
      await f.receive('/remind create 10分钟后 正文');
      expect(f.added).not.toHaveBeenCalled();
      expect(rendered(f.sent)).not.toContain('确认创建这条提醒');
      expect(f.sent.filter(item => JSON.stringify(item.payload).includes('提醒输入超时，未创建提醒'))).toHaveLength(1);
    } finally { await f.close(); }
  });

  it('does not send an old timeout when preview delivery crosses retirement and the total deadline', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const f: Awaited<ReturnType<typeof fixture>> = await fixture({ afterSend: count => {
      if (count !== 1) return;
      f.store.commit(0, { snapshot: f.store.current, dispose() {} });
      clock.mockReturnValue(1_800_000_181_000);
    } });
    try {
      await f.receive('/remind create 10分钟后 old-preview');
      expect(f.sent).toHaveLength(1);
      expect(rendered(f.sent)).toContain('old-preview');
      expect(rendered(f.sent)).not.toContain('提醒输入超时，未创建提醒');
      expect(f.added).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('keeps help and non-IM execution read-only', async () => {
    const f = await fixture();
    try {
      await f.receive('/remind create --help'); expect(rendered(f.sent)).toContain('when'); expect(rendered(f.sent)).not.toContain('什么时候');
      const result = await f.index.execute('remind create 10分钟后 正文'); expect(result).toContain('真实聊天'); expect(f.added).not.toHaveBeenCalled();
      const reply = vi.fn(async () => ({ status: 'sent' }));
      const source = { conversation: f.conversation, content: 'remind create 10分钟后 正文', sender: { id: 'alice' }, $reply: reply };
      const noInteraction = await f.index.dispatch({ input: source.content, source });
      expect(noInteraction.value).toContain('真实聊天'); expect(reply).not.toHaveBeenCalled();
      const noSender = await f.index.dispatch({ input: source.content, source: { ...source, sender: { id: '' } } });
      expect(noSender.value).toContain('真实聊天'); expect(f.added).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
});
