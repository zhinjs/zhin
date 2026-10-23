import { randomUUID } from 'node:crypto';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { PluginTaskProvider } from '../../../../packages/im/plugin-runtime/src/index.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import * as feed from '../src/feed.js';
import { ADMIN_RSS_STATE_KEY, type AdministratorRssBook } from '../src/admin-tasks.js';
import { rssFixture, target, createTask, changeTask } from './admin-fixture.js';

const quiet = { quietTimezone: 'Asia/Shanghai', quietStart: '22:00', quietEnd: '08:00' };
const fixtures: Awaited<ReturnType<typeof rssFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); vi.restoreAllMocks(); });
function items(...guids: string[]): Awaited<ReturnType<typeof feed.fetchFeed>> {
  return { title: 'Source', items: guids.map(guid => ({ guid, title: `Article ${guid}`, link: `https://example.test/${guid}`, summary: 'DO NOT PERSIST BODY', date: '' })) };
}
async function setup(maxItems?: number) {
  let now = Date.parse('2026-10-20T13:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const load = vi.spyOn(feed, 'fetchFeed').mockResolvedValue(items('baseline'));
  const f = await rssFixture(maxItems === undefined ? {} : { rssConfig: { maxItems } }); fixtures.push(f); await f.runtime.start();
  return { f, provider: f.provider()!, load, at: (at: string) => { now = Date.parse(at); } };
}
async function createQuiet(provider: PluginTaskProvider, destination: object = target) {
  return provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision,
    target: destination as typeof target, parameters: { url: 'https://example.test/quiet', ...quiet } });
}
async function book(f: Awaited<ReturnType<typeof rssFixture>>) { return (await f.state().get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))!; }
async function queue(s: Awaited<ReturnType<typeof setup>>) {
  await createQuiet(s.provider); await s.f.tick();
  s.at('2026-10-20T14:00:00Z'); s.load.mockResolvedValue(items('one', 'baseline')); await s.f.tick();
  expect(s.f.send).not.toHaveBeenCalled(); expect((await book(s.f)).tasks[0]!.pending?.count).toBe(1);
}

describe.skipIf(!sqliteAvailable)('RSS quiet digest through real owner Runtime and SQLite', () => {
  it('defers only opt-in subscriptions, deduplicates accumulation and flushes without fetching on the first non-quiet poll', async () => {
    const s = await setup(); const { f, provider, load } = s;
    await createQuiet(provider); await createTask(provider, 'https://example.test/normal'); await f.tick();
    s.at('2026-10-20T14:00:00Z'); load.mockResolvedValue(items('one', 'baseline')); await f.tick();
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0]![1]).not.toContain('静默摘要');
    load.mockResolvedValue(items('two', 'one', 'baseline')); await f.tick(); await f.tick();
    const pending = (await book(f)).tasks.find(task => task.quiet)!.pending!;
    expect(pending.count).toBe(2); expect(pending.items.map(item => item.title)).toEqual(['Article one', 'Article two']);
    expect(JSON.stringify(await book(f))).not.toContain('DO NOT PERSIST BODY');
    load.mockRejectedValue(new Error('source is down')); await f.tick();
    expect((await provider.read()).tasks.find(task => 'quietTimezone' in task.parameters)!.detail).toContain('源站抓取失败');
    expect((await provider.read()).tasks.find(task => 'quietTimezone' in task.parameters)!.detail).toContain('待汇总2 条更新');
    const fetched = load.mock.calls.length;
    s.at('2026-10-21T00:00:00Z'); const before = f.send.mock.calls.length; await f.tick();
    expect(f.send).toHaveBeenCalledTimes(before + 1);
    expect(f.send.mock.calls.at(-1)![0]).toEqual(target);
    expect(f.send.mock.calls.at(-1)![1]).toContain('累计检测到 2 条更新');
    expect(load).toHaveBeenCalledTimes(fetched + 1); // Only the separate immediate task fetches.
    expect((await book(f)).tasks.find(task => task.quiet)!.pending).toBeNull();
    await f.tick(); expect(f.send).toHaveBeenCalledTimes(before + 1);
    load.mockResolvedValue(items('three', 'two', 'one', 'baseline')); await f.tick();
    expect(f.send.mock.calls.at(-1)![1]).toContain('Article three');
    expect(f.send.mock.calls.at(-1)![1]).not.toContain('Article two');
  });

  it('atomically discards pending on pause and resumes with a fresh non-sending baseline', async () => {
    const s = await setup(); await queue(s); const { f, provider, load } = s;
    await changeTask(provider, 'pause'); expect((await book(f)).tasks[0]!.pending).toBeNull();
    load.mockResolvedValue(items('while-paused', 'one')); const fetched = load.mock.calls.length; await f.tick(); expect(load).toHaveBeenCalledTimes(fetched);
    await changeTask(provider, 'resume'); s.at('2026-10-21T00:00:00Z'); await f.tick();
    expect(f.send).not.toHaveBeenCalled(); expect((await book(f)).tasks[0]!.pending).toBeNull();
    load.mockResolvedValue(items('after-resume', 'while-paused')); await f.tick();
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0]![1]).toContain('after-resume');
    expect(f.send.mock.calls[0]![1]).not.toContain('while-paused');
  });

  it('respects the actual instance maxItems when a queued digest has more sampled articles', async () => {
    const s = await setup(1); await queue(s);
    s.load.mockResolvedValue(items('two', 'three', 'one', 'baseline')); await s.f.tick();
    expect((await book(s.f)).tasks[0]!.pending!.items).toHaveLength(3);
    s.at('2026-10-21T00:00:00Z'); await s.f.tick();
    const text = String(s.f.send.mock.calls[0]![1]);
    expect(text).toContain('累计检测到 3 条更新'); expect(text).toContain('Article one');
    expect(text).not.toContain('Article two'); expect(text).not.toContain('Article three'); expect(text).toContain('仅展示 1 条短明细');
  });

  it('roundtrips the real flat parameters and closes quiet mode when all three fields are cleared', async () => {
    const s = await setup(); await queue(s); const { f, provider } = s;
    const paused = await changeTask(provider, 'pause'); const task = paused.tasks[0]!;
    expect(task.parameters).toMatchObject(quiet);
    const cleared = await provider.change({ requestId: randomUUID(), expectedRevision: paused.revision, id: task.id, action: 'update',
      parameters: { ...task.parameters, quietTimezone: ' ', quietStart: '', quietEnd: '' } });
    expect(cleared.tasks[0]!.parameters).toEqual({ url: 'https://example.test/quiet' });
    expect((await book(f)).tasks[0]!.quiet).toBeUndefined(); expect((await book(f)).tasks[0]!.pending).toBeNull();
    await changeTask(provider, 'resume'); await f.tick(); s.load.mockResolvedValue(items('after-edit')); await f.tick();
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0]![1]).not.toContain('静默摘要');
  });

  it.each([null, 'ambiguous', 'rejected'] as const)('keeps %s summary outcomes stopped across restart without retrying', async outcome => {
    const s = await setup(); await queue(s); const { f } = s;
    if (outcome === null) f.send.mockResolvedValueOnce(null);
    else f.send.mockRejectedValueOnce(outcome === 'rejected'
      ? new EndpointDeliveryError('unsupported_operation', 'private transport', 'not_sent') : new Error('private transport'));
    s.at('2026-10-21T00:00:00Z'); await f.tick();
    const snapshot = await f.provider()!.read();
    expect(snapshot.tasks[0]).toMatchObject({ state: outcome === 'rejected' ? 'failed' : 'unknown', actions: outcome === 'rejected' ? [] : ['cancel'] });
    expect(snapshot.tasks[0]!.detail).not.toContain('private transport');
    expect(snapshot.tasks[0]!.detail).toContain('本次摘要1 条更新'); expect(snapshot.tasks[0]!.detail).not.toContain('待汇总');
    if (outcome !== 'rejected') await expect(changeTask(f.provider()!, 'resume')).rejects.toMatchObject({ code: 'invalid_input' });
    await f.restart(); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('retains queued samples through HMR, rejected candidates and SQLite reopen without creating a new scheduler', async () => {
    const s = await setup(); await queue(s); const { f, provider } = s;
    const before = await book(f); expect((await f.hmr(true)).length).toBeGreaterThan(0); expect(await book(f)).toEqual(before);
    expect(await f.hmr()).toEqual([]); expect(f.active.size).toBe(4);
    await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
    await f.tick(); expect((await book(f)).tasks[0]!.pending).toEqual(before.tasks[0]!.pending);
    await f.restart(); await f.tick(); expect(f.send).not.toHaveBeenCalled();
    s.at('2026-10-21T00:00:00Z'); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a cancellation after a summary claim has started external I/O', async () => {
    const s = await setup(); await queue(s); const { f, provider } = s;
    let finish!: (value: string) => void; f.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    s.at('2026-10-21T00:00:00Z'); const running = f.tick(); await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect((await book(f)).tasks[0]).toMatchObject({ state: 'unknown', pending: { count: 1 } });
    await changeTask(provider, 'cancel'); expect((await book(f)).tasks[0]!.pending).toBeNull();
    finish('confirmed'); await running; expect((await provider.read()).tasks[0]!.state).toBe('cancelled');
    await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each(['claim', 'settlement'] as const)('preserves an unknown claim after lost %s write response, never replays after restart', async boundary => {
    const s = await setup(); await queue(s); const { f } = s;
    const exchange = f.database.transaction!.bind(f.database);
    const write = vi.spyOn(f.database, 'transaction').mockImplementation(async callback => {
      const committed = await exchange(callback);
      const rows = await f.storage().models.get('admin_rss_tasks')!.select();
      if (rows.some(task => task.state === 'unknown' && task.claim_id)) throw new Error('lost write response');
      return committed;
    });
    s.at('2026-10-21T00:00:00Z');
    if (boundary === 'settlement') {
      // Model storage failure before settlement commits; the confirmed platform
      // effect therefore has only its original durable unknown claim.
      write.mockImplementation(async (...args) => { if (f.send.mock.calls.length > 0) throw new Error('lost write response'); return exchange(...args); });
    }
    await expect(f.tick()).rejects.toThrow('lost write response'); write.mockRestore();
    expect((await book(f)).tasks[0]!.state).toBe('unknown'); expect(f.send).toHaveBeenCalledTimes(boundary === 'claim' ? 0 : 1);
    await f.restart(); await f.tick(); expect(f.send).toHaveBeenCalledTimes(boundary === 'claim' ? 0 : 1);
  });

  it('keeps detection and accumulation atomic when the collection response is lost', async () => {
    const s = await setup(); const { f, provider, load } = s; await createQuiet(provider); await f.tick();
    const exchange = f.database.transaction!.bind(f.database); let failed = false;
    const write = vi.spyOn(f.database, 'transaction').mockImplementation(async callback => {
      const committed = await exchange(callback);
      const row = (await f.storage().models.get('admin_rss_tasks')!.select())[0];
      if (!failed && Number(row?.pending_count) > 0) { failed = true; throw new Error('lost accumulation response'); }
      return committed;
    });
    s.at('2026-10-20T14:00:00Z'); load.mockResolvedValue(items('one', 'baseline'));
    await expect(f.tick()).rejects.toThrow('lost accumulation response'); write.mockRestore();
    await f.tick(); expect((await book(f)).tasks[0]!.pending?.count).toBe(1);
    s.at('2026-10-21T00:00:00Z'); await f.tick(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('bounds samples and saturated counts, and refuses capacity before creating or changing a subscription', async () => {
    const s = await setup(); await queue(s); const { f, provider, load } = s;
    await f.state().update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => ({ ...current!, tasks: current!.tasks.map(task => ({ ...task, pending: { ...task.pending!, count: 9999 } })) }));
    load.mockResolvedValue({ title: 'Source', items: Array.from({ length: 20 }, (_, index) => ({ guid: `new-${index}`, title: '标题'.repeat(500),
      link: `https://user:password@example.test/${index}`, summary: 'private body', date: '' })) });
    await f.tick(); const pending = (await book(f)).tasks[0]!.pending!;
    expect(pending).toMatchObject({ count: 10000, countCapped: true }); expect(pending.items).toHaveLength(3);
    expect(pending.items.every(item => new TextEncoder().encode(JSON.stringify(item.title)).length <= 128)).toBe(true);
    expect(JSON.stringify(pending)).not.toContain('password'); expect(JSON.stringify(pending)).not.toContain('private body');
    const before = await provider.read();
    await expect(createQuiet(provider, { ...target, threadId: 'x'.repeat(54_000) })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await provider.read()).toEqual(before);
    s.at('2026-10-21T00:00:00Z'); await f.tick(); expect(f.send.mock.calls[0]![1]).toContain('至少 10000 条更新');
    expect(new TextEncoder().encode(JSON.stringify(await book(f))).length).toBeLessThanOrEqual(60 * 1024);
  });

  it('reads legacy v1 without a write and preserves original mutation receipts when upgrading the same key', async () => {
    const s = await setup(); const { f, provider } = s;
    const input = { requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target, parameters: { url: 'https://example.test/legacy' } };
    const created = await provider.create(input), saved = await book(f);
    const legacy: AdministratorRssBook = { ...saved, version: 1, tasks: saved.tasks.map(task => { const { quiet: _quiet, pending: _pending, ...rest } = task; return rest; }) };
    await f.state().set(ADMIN_RSS_STATE_KEY, legacy); await f.restart();
    expect(await f.provider()!.read()).toEqual(created); expect((await book(f)).version).toBe(1);
    expect(await f.provider()!.create(input)).toEqual(created); expect((await book(f)).version).toBe(1);
    await f.tick(); expect((await book(f)).version).toBe(2); expect((await book(f)).receipts).toEqual(legacy.receipts);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects enabling quiet mode without enough reserved state space while preserving the paused task', async () => {
    const s = await setup(), provider = s.f.provider('beta')!;
    await createTask(provider, 'https://example.test/large-target', { ...target, threadId: 'x'.repeat(54_000) });
    const paused = await changeTask(provider, 'pause');
    await expect(provider.change({ requestId: randomUUID(), expectedRevision: paused.revision, id: paused.tasks[0]!.id, action: 'update',
      parameters: { ...paused.tasks[0]!.parameters, ...quiet } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await provider.read()).toEqual(paused); expect(s.load).not.toHaveBeenCalled(); expect(s.f.send).not.toHaveBeenCalled();
  });

  it('does not enqueue a fetched result that lost a race with an atomic pause', async () => {
    const s = await setup(); await createQuiet(s.provider); await s.f.tick();
    let finish!: (value: ReturnType<typeof items>) => void;
    s.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    s.at('2026-10-20T14:00:00Z'); const before = s.load.mock.calls.length, running = s.f.tick();
    await vi.waitFor(() => expect(s.load).toHaveBeenCalledTimes(before + 1)); await changeTask(s.provider, 'pause');
    finish(items('new', 'baseline')); await running;
    expect((await book(s.f)).tasks[0]).toMatchObject({ state: 'paused', pending: null }); expect(s.f.send).not.toHaveBeenCalled();
  });

  it('keeps identical URLs and complete targets isolated by the actual provider owner', async () => {
    const s = await setup(); await createQuiet(s.provider); await createQuiet(s.f.provider('beta')!);
    await s.f.tick(); await s.f.tick('beta'); s.at('2026-10-20T14:00:00Z');
    s.load.mockResolvedValue(items('one', 'baseline')); await s.f.tick();
    expect((await book(s.f)).tasks[0]!.pending?.count).toBe(1);
    expect((await s.f.state('beta').get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))!.tasks[0]!.pending).toBeNull();
    s.at('2026-10-21T00:00:00Z'); await s.f.tick();
    expect(s.f.send).toHaveBeenCalledTimes(1); expect(s.f.send.mock.calls[0]![0]).toEqual(target);
    expect(s.f.send.mock.calls[0]![2]).toBe(s.f.state().owner);
  });

  it.each(['timezone', 'window', 'pending'] as const)('fails closed and preserves a malformed durable %s policy instead of disabling it', async field => {
    const s = await setup(); await queue(s); const saved = await book(s.f);
    const broken = { ...saved, tasks: saved.tasks.map(task => ({ ...task,
      ...(field === 'timezone' ? { quiet: { ...task.quiet!, timezone: '+08:00' } }
        : field === 'window' ? { quiet: { ...task.quiet!, start: task.quiet!.end } }
        : { pending: { ...task.pending!, count: -1 } }),
    })) };
    await s.f.state().set(ADMIN_RSS_STATE_KEY, broken); const fetched = s.load.mock.calls.length;
    await expect(s.provider.read()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(s.f.tick()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await s.f.state().get(ADMIN_RSS_STATE_KEY)).toEqual(broken); expect(s.load).toHaveBeenCalledTimes(fetched); expect(s.f.send).not.toHaveBeenCalled();
  });
});
