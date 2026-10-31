import { extractChannelInfo, subscriptionScope } from '../src/channel.js';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { childPluginId, rootPluginId } from '../../../../packages/im/plugin-runtime/src/index.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import * as feed from '../src/feed.js';
import { ADMIN_RSS_STATE_KEY, type AdministratorRssBook } from '../src/admin-tasks.js';
import { getRssSeen, getRssSubs } from '../src/db-store.js';
import remove from '../commands/rss-remove/[url]/index.js';
import list from '../commands/rss-list/index.js';
import { rssFixture, target, createTask, changeTask } from './admin-fixture.js';

const fixtures: Awaited<ReturnType<typeof rssFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.close(); vi.restoreAllMocks(); });
async function setup(options: Parameters<typeof rssFixture>[0] = {}) {
  const fixture = await rssFixture(options); fixtures.push(fixture); await fixture.runtime.start(); return fixture;
}
function items(...ids: string[]): Awaited<ReturnType<typeof feed.fetchFeed>> {
  return { title: '测试源', items: ids.map(guid => ({ guid, title: `Article ${guid}`, summary: '', link: `https://example.test/${guid}`, date: '' })) };
}
function mockFeed(...ids: string[]) { return vi.spyOn(feed, 'fetchFeed').mockResolvedValue(items(...ids)); }

describe.skipIf(!sqliteAvailable)('administrator RSS through real Runtime and SQLite', () => {
  it('adds locale columns to pre-localization tables and keeps legacy notifications in Chinese', async () => {
    const load = mockFeed('base'); const f = await setup({ locale: 'en' });
    await createTask(f.provider()!); await f.tick();
    await f.runtime.stop(); await f.database.stop();
    const legacy = new DatabaseSync(join(f.project, 'state.sqlite'));
    try {
      for (const row of legacy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
        const table = String(row.name);
        const columns = table.endsWith('admin_rss_tasks') ? ['locale', 'detail_key'] : table.endsWith('rss_subscriptions') ? ['locale'] : [];
        for (const column of columns) legacy.exec(`ALTER TABLE "${table.replaceAll('"', '""')}" DROP COLUMN "${column}"`);
      }
    } finally { legacy.close(); }
    await f.restart('en');
    expect((await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))!.tasks[0]!.locale).toBe('zh-CN');
    load.mockResolvedValue(items('new', 'base')); await f.tick();
    expect(f.send.mock.calls[0]![1]).toContain('新内容');
    expect(f.send.mock.calls[0]![3]).toEqual({ locale: 'zh-CN' });
    expect(f.send.mock.calls[0]![1]).not.toContain('new items');
  });

  it('pins notification language across SQLite reopen and keeps request locale outside mutation identity', async () => {
    const load = mockFeed('baseline'); const f = await setup({ locale: 'en' }); const provider = f.provider()!;
    const input = { requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target,
      parameters: { url: 'https://example.test/feed.xml' } };
    const chinese = await provider.create({ ...input, locale: 'zh-CN' });
    const english = await provider.create({ ...input, locale: 'en' });
    expect(chinese.tasks[0]!.detail).toContain('等待首次抓取');
    expect(english.tasks[0]!.detail).toContain('Waiting for the first fetch');
    expect(english.revision).toBe(chinese.revision); expect(english.receipts).toEqual(chinese.receipts);
    await expect(provider.change({ requestId: randomUUID(), expectedRevision: english.revision,
      id: input.requestId, action: 'resume', locale: 'en' })).rejects.toThrow('Only paused subscriptions');
    await f.tick(); await f.restart('zh-CN');
    expect((await f.provider()!.read({ locale: 'en' })).tasks[0]!.detail).toContain('Baseline established');
    load.mockResolvedValue(items('new-item', 'baseline')); await f.tick();
    expect(f.send.mock.calls[0]![1]).toContain('new items');
    expect(f.send.mock.calls[0]![3]).toEqual({ locale: 'en' });
    expect(f.send.mock.calls[0]![1]).not.toContain('新文章');
    expect((await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))!.tasks[0]!.locale).toBe('en');
  });

  it('establishes initial/resumed baselines, then delivers only later articles through the exact owner-bound target', async () => {
    const load = mockFeed('before-create'); const f = await setup(); const provider = f.provider()!;
    let snapshot = await createTask(provider);
    expect(snapshot.tasks[0]).toMatchObject({ ownership: 'administrator', target, state: 'scheduled', parameters: { url: 'https://example.test/feed.xml' } });
    expect(snapshot.tasks[0]!.nextRunAt).toBeUndefined(); expect(load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    await f.tick(); expect(f.send).not.toHaveBeenCalled();
    load.mockResolvedValue(items('new-one', 'before-create')); await f.tick();
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0]![0]).toEqual(target);
    expect(f.send.mock.calls[0]![2]).toBe(childPluginId(rootPluginId(), 'alpha'));
    expect(f.send.mock.calls[0]![1]).toContain('Article new-one'); expect(f.send.mock.calls[0]![1]).not.toContain('Article before-create');
    snapshot = await changeTask(provider, 'pause'); expect(snapshot.tasks[0]!.actions).toEqual(['update', 'resume', 'cancel']);
    load.mockResolvedValue(items('while-paused', 'new-one')); const before = load.mock.calls.length; await f.tick(); expect(load).toHaveBeenCalledTimes(before);
    await changeTask(provider, 'resume'); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
    load.mockResolvedValue(items('after-resume', 'while-paused')); await f.tick();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.send.mock.calls[1]![1]).toContain('Article after-resume');
    expect(f.send.mock.calls[1]![1]).not.toContain('while-paused');
    expect((await provider.read()).tasks[0]!.state).toBe('scheduled'); expect(f.active.size).toBe(4);
  });

  it('keeps administrator tasks and cursors separate from chat tables, list, remove and other instances', async () => {
    mockFeed('old'); const f = await setup(); const provider = f.provider()!;
    const created = await createTask(provider); await f.tick();
    expect(await f.chat(list)).toContain('没有订阅'); expect(await f.chat(remove, { url: 'https://example.test/feed.xml' })).toContain('未找到');
    expect(await getRssSubs(f.rss().db)!.select()).toEqual([]); expect(await getRssSeen(f.rss().db)!.select()).toEqual([]);
    expect((await f.provider('beta')!.read()).tasks).toEqual([]);
    await getRssSubs(f.rss().db)!.insert({ url: 'https://example.test/feed.xml', feed_title: 'Chat feed', ...subscriptionScope(extractChannelInfo({ conversation: { endpoint: { adapter: 'sandbox', id: 'chat-account' }, kind: 'group', id: 'chat' } })!), creator_id: 'alice', creator_name: 'Alice', created_at: new Date().toISOString() });
    expect(await f.chat(remove, { url: 'https://example.test/feed.xml' })).toContain('已取消');
    expect((await provider.read()).tasks[0]!.id).toBe(created.tasks[0]!.id);
    await expect(changeTask(f.provider('beta')!, 'cancel', created.tasks[0]!.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('uses independent cursors for the same source and preserves account/parent/thread identity', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    const targets = [target, { ...target, endpoint: { ...target.endpoint, id: 'second-account' } }, { ...target, parent: { ...target.parent, id: 'second-parent' } },
      { ...target, threadId: 'second-thread' }, { endpoint: target.endpoint, kind: target.kind, id: target.id }];
    for (const destination of targets) await createTask(provider, undefined, destination);
    await f.tick(); load.mockResolvedValue(items('added', 'base')); await f.tick();
    expect(f.send.mock.calls.map(call => call[0])).toEqual(targets);
    await expect(createTask(provider)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('reconciles operation IDs, rejects stale/concurrent edits and preserves state across real SQLite reopen', async () => {
    mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    const input = { requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target, parameters: { url: 'https://example.test/feed.xml' } };
    const created = await provider.create(input); expect(await provider.create(input)).toEqual(created);
    await expect(provider.create({ ...input, parameters: { url: 'https://other.test/feed' } })).rejects.toMatchObject({ code: 'conflict' });
    const attempts = await Promise.allSettled([1, 2].map(i => provider.create({ ...input, requestId: randomUUID(), expectedRevision: created.revision,
      target: { ...target, threadId: `thread-${i}` } })));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    const pause = { requestId: randomUUID(), expectedRevision: (await provider.read()).revision, id: input.requestId, action: 'pause' as const };
    const paused = await provider.change(pause); expect(await provider.change(pause)).toEqual(paused);
    const before = await provider.read(); await f.restart(); expect(await f.provider()!.read()).toEqual(before);
    await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([null, 'ambiguous-error'] as const)('persists unknown for %s and never retries after restart or forbidden actions', async result => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await f.tick(); load.mockResolvedValue(items('new', 'base'));
    if (result === null) f.send.mockResolvedValueOnce(null); else f.send.mockRejectedValueOnce(new Error('private transport detail'));
    await f.tick(); let snapshot = await provider.read(); expect(snapshot.tasks[0]!.state).toBe('unknown'); expect(snapshot.tasks[0]!.actions).toEqual(['cancel']);
    for (const action of ['pause', 'resume', 'update'] as const) await expect(changeTask(provider, action, undefined, action === 'update' ? 'https://other.test/feed' : undefined))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await f.tick(); await f.restart(); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
    snapshot = await f.provider()!.read(); expect(snapshot.tasks[0]!.detail).not.toContain('private transport');
    await changeTask(f.provider()!, 'cancel'); expect((await f.provider()!.read()).tasks[0]!.state).toBe('cancelled');
  });

  it('stops a definitively rejected delivery and retries source fetch failures without attempting a send', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); load.mockRejectedValueOnce(new Error('private origin details')); await f.tick();
    expect((await provider.read()).tasks[0]).toMatchObject({ state: 'scheduled' }); expect(f.send).not.toHaveBeenCalled();
    expect((await provider.read()).tasks[0]!.detail).not.toContain('private origin');
    await f.tick(); load.mockResolvedValue(items('new', 'base'));
    f.send.mockRejectedValueOnce(new EndpointDeliveryError('unsupported_operation', 'private platform details', 'not_sent'));
    await f.tick(); expect((await provider.read()).tasks[0]).toMatchObject({ state: 'failed', actions: [] });
    await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('persists a claim before external send and does not overwrite a concurrent cancellation with its receipt', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await f.tick(); load.mockResolvedValue(items('new', 'base'));
    let complete!: (value: string) => void; f.send.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const running = f.tick(); await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    const book = await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY); expect(book!.tasks[0]).toMatchObject({ state: 'unknown' });
    expect(book!.tasks[0]!.claimId).toBeTruthy(); await changeTask(provider, 'cancel'); complete('confirmed'); await running;
    expect((await provider.read()).tasks[0]!.state).toBe('cancelled');
  });

  it('does not claim or send a fetched result after pause and prevents concurrent worker reentry', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await f.tick(); let fetched!: (value: ReturnType<typeof items>) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { fetched = resolve; }));
    const before = load.mock.calls.length, running = f.tick(); await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(before + 1));
    await f.tick(); expect(load).toHaveBeenCalledTimes(before + 1); await changeTask(provider, 'pause'); fetched(items('new', 'base')); await running;
    expect(f.send).not.toHaveBeenCalled(); expect((await provider.read()).tasks[0]!.state).toBe('paused');
  });

  it('requires pause before editing and establishes a fresh baseline for an updated source', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await expect(changeTask(provider, 'update', undefined, 'https://other.test/feed')).rejects.toMatchObject({ code: 'invalid_input' });
    await changeTask(provider, 'pause'); const updated = await changeTask(provider, 'update', undefined, 'https://other.test/feed');
    expect(updated.tasks[0]).toMatchObject({ state: 'paused', parameters: { url: 'https://other.test/feed' } });
    await changeTask(provider, 'resume'); await f.tick(); expect(load).toHaveBeenLastCalledWith('https://other.test/feed', 15000); expect(f.send).not.toHaveBeenCalled();
  });

  it('keeps cursors, revision and receipt facts through HMR and rejects stale providers/jobs after retirement', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    const created = await createTask(provider); await f.tick(); const before = await provider.read();
    const oldJob = [...f.active].find(job => job.owner === childPluginId(rootPluginId(), 'alpha') && job.id.endsWith('rss/poll_feeds'))!;
    expect(await f.hmr()).toEqual([]); expect(f.active.size).toBe(4); expect(await f.provider()!.read()).toEqual(before);
    await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(Promise.resolve().then(() => oldJob.execute())).rejects.toThrow();
    load.mockResolvedValue(items('after-hmr', 'base')); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.provider()!.read()).tasks[0]!.id).toBe(created.tasks[0]!.id);
  });

  it('keeps the previous published worker and state when a real HMR candidate fails', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await f.tick(); const before = await provider.read(), generation = f.runtime.snapshot.generation;
    const fetched = load.mock.calls.length;
    expect((await f.hmr(true)).length).toBeGreaterThan(0); expect(f.runtime.snapshot.generation).toBe(generation);
    expect(await provider.read()).toEqual(before); expect(f.active.size).toBe(4); expect(load).toHaveBeenCalledTimes(fetched);
    load.mockResolvedValue(items('after-rollback', 'base')); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('retains a durable unknown claim if recording a confirmed result fails, then never resends it after restart', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); await f.tick(); load.mockResolvedValue(items('new', 'base'));
    // The external send can complete just before a process/storage failure. Throw
    // after the real SQLite claim has committed to exercise that crash boundary.
    const transaction = f.database.transaction!.bind(f.database);
    const write = vi.spyOn(f.database, 'transaction').mockImplementation(async callback => {
      if (f.send.mock.calls.length > 0) throw new Error('simulated failure after external send');
      return transaction(callback);
    });
    await expect(f.tick()).rejects.toThrow('simulated failure'); write.mockRestore();
    expect((await provider.read()).tasks[0]!.state).toBe('unknown'); expect(f.send).toHaveBeenCalledTimes(1);
    await f.restart(); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.provider()!.read()).tasks[0]).toMatchObject({ state: 'unknown', actions: ['cancel'] });
  });

  it('rejects oversized state without losing existing tasks and bounds each independent cursor', async () => {
    const load = mockFeed('initial'); const f = await setup(); const provider = f.provider()!;
    await createTask(provider); const before = await provider.read();
    await expect(createTask(provider, 'https://example.test/oversize', { ...target, threadId: 'x'.repeat(62_000) })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await provider.read()).toEqual(before);
    await f.tick();
    for (let batch = 0; batch < 5; batch++) {
      load.mockResolvedValue(items(...Array.from({ length: 20 }, (_, index) => `batch-${batch}-${index}`))); await f.tick();
    }
    const book = await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY);
    expect(book!.tasks[0]!.seen).toHaveLength(64); expect(f.send).toHaveBeenCalledTimes(5);
  });

  it('fails closed on malformed durable state without overwriting it or calling source/platform', async () => {
    const load = mockFeed(); const f = await setup(); const broken = { version: 99, revision: 'preserve', tasks: [], receipts: [] };
    await f.state().get(ADMIN_RSS_STATE_KEY);
    await f.storage().models.get('admin_rss_book')!.update({ version: broken.version, revision: broken.revision, storage_present: true }).where({ storage_id: 1 });
    await expect(f.provider()!.read()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.tick()).rejects.toThrow('持久状态格式无效');
    expect(await f.state().get(ADMIN_RSS_STATE_KEY)).toEqual(broken); expect(load).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('keeps the existing poll lease until the chat pool drains even when the administrator pool rejects', async () => {
    let finish!: (value: ReturnType<typeof items>) => void;
    const load = vi.spyOn(feed, 'fetchFeed').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = await setup();
    await getRssSubs(f.rss().db)!.insert({ url: 'https://example.test/chat', adapter_name: 'sandbox', endpoint_id: 'chat-account', channel_type: 'group', channel_id: 'chat' });
    await f.state().get(ADMIN_RSS_STATE_KEY);
    await f.storage().models.get('admin_rss_book')!.update({ version: 99, revision: 'preserve', storage_present: true }).where({ storage_id: 1 });
    let settled = false;
    const running = f.tick().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false); finish(items());
    expect(await running).toMatchObject({ code: 'unavailable' }); expect(settled).toBe(true); expect(f.send).not.toHaveBeenCalled();
  });

  it('bounds active tasks, receipts and item digests without discarding unknown tasks', async () => {
    const load = mockFeed('base'); const f = await setup(); const provider = f.provider()!;
    for (let i = 0; i < 8; i++) await createTask(provider, `https://example.test/${i}`);
    await expect(createTask(provider, 'https://example.test/overflow')).rejects.toMatchObject({ code: 'invalid_input' });
    await f.tick(); load.mockResolvedValue(items('new', 'base')); f.send.mockResolvedValue(null); await f.tick();
    expect((await provider.read()).tasks.every(task => task.state === 'unknown')).toBe(true);
    await expect(createTask(provider, 'https://example.test/overflow')).rejects.toMatchObject({ code: 'invalid_input' });
    const first = (await provider.read()).tasks[0]!.id; await changeTask(provider, 'cancel', first);
    for (let i = 0; i < 36; i++) {
      const created = await createTask(provider, `https://example.test/history-${i}`);
      await changeTask(provider, 'cancel', created.tasks.at(-1)!.id);
    }
    const snapshot = await provider.read(); expect(snapshot.tasks).toHaveLength(8); expect(snapshot.receipts).toHaveLength(32);
    expect(snapshot.tasks.filter(task => task.state === 'unknown')).toHaveLength(7);
    const book = await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY);
    expect(book!.tasks.every(task => task.seen === null || task.seen.every(key => /^[\da-f]{64}$/u.test(key)))).toBe(true);
  });

  it.each([{ persistence: false }, { outbound: false }, { scheduler: false }, { exactSend: false }])('does not advertise administrator tasks without required resources: %j', async options => {
    const f = await setup(options); expect(f.provider()).toBeUndefined(); expect(f.rss()).toBeDefined(); expect(f.send).not.toHaveBeenCalled();
  });

  it.each(['ftp://example.test/feed', 'https://user:pass@example.test/feed', 'not a url', 'https://example.test/white space'])('rejects invalid or credential-bearing source %s without fetching', async url => {
    const load = mockFeed(); const f = await setup(); await expect(createTask(f.provider()!, url)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(load).not.toHaveBeenCalled(); expect((await f.provider()!.read()).tasks).toEqual([]);
  });

  it('rejects an expanded URL that would otherwise poison the next durable-state read', async () => {
    mockFeed(); const f = await setup(); const provider = f.provider()!;
    await expect(createTask(provider, `https://example.test/${'中'.repeat(300)}`)).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await provider.read()).tasks).toEqual([]);
  });
});
