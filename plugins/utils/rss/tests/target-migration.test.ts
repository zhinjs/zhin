import {
  childPluginId,
  rootPluginId,
  pluginDataMigrationProviderToken,
  type PluginDataMigrationProvider,
} from 'zhin.js/plugin-runtime';
import { rssFixture, target } from './admin-fixture.js';
import { getRssSeen, getRssSubs } from '../src/db-store.js';
import { checkSubscriptions } from '../src/poll.js';
import * as feeds from '../src/feed.js';

it('migrates the exact keyless duplicate group through real Runtime/SQLite and preserves cursor and namespace isolation', async () => {
  const f = await rssFixture();
  const provider = () =>
    f.runtime.snapshot.resources
      .get(childPluginId(rootPluginId(), 'alpha'))!
      .get(pluginDataMigrationProviderToken.id) as PluginDataMigrationProvider;
  try {
    await f.runtime.start();
    const Subs = getRssSubs(f.rss().db)!,
      Seen = getRssSeen(f.rss().db)!;
    const old = {
      url: 'https://example.test/feed.xml',
      adapter_name: 'sandbox',
      endpoint_id: 'reusable-alias',
      channel_type: 'channel',
      channel_id: 'room',
      creator_id: 'alice',
      creator_name: 'Alice',
      locale: 'en',
      feed_title: 'Feed',
      created_at: '2026-01-01',
    };
    await Subs.insert(old);
    await Subs.insert(old);
    await getRssSubs(f.rss('beta').db)!.insert({ ...old, creator_id: 'bob' });
    await Seen.insert({ feed_url: old.url, item_guid: 'already-seen', item_title: 'Old', seen_at: '2026-01-01' });
    const beforeCursor = await Seen.select(),
      beta = await getRssSubs(f.rss('beta').db)!.select();
    const candidate = (await provider().preview()).candidates[0]!;
    expect(candidate.recordCount).toBe(2);
    const plan = await provider().prepare({
      planId: 'rss-explicit',
      candidateId: candidate.id,
      expectedDigest: candidate.beforeDigest,
      target,
    });
    const receipt = await provider().apply({ plan });
    expect(receipt.recordCount).toBe(2);
    expect(await Seen.select()).toEqual(beforeCursor);
    expect(await getRssSubs(f.rss('beta').db)!.select()).toEqual(beta);
    const rows = await Subs.select();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.creator_id)).toEqual(['alice', 'alice']);
    expect(rows.every((row) => !String(row.endpoint_id).includes('\0'))).toBe(true);
    await f.restart();
    expect(await provider().inspect({ plan })).toMatchObject({
      data: 'applied',
      maintenance: 'paused',
      resumable: true,
    });
    vi.spyOn(feeds, 'fetchFeed').mockResolvedValue({
      title: 'Feed',
      items: [{ guid: 'new-paused', title: 'New', summary: '', link: '', date: '' }],
    });
    expect((await checkSubscriptions(f.rss(), { urls: [old.url] })).pushed).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
    await provider().resume({ plan });
    vi.mocked(feeds.fetchFeed).mockResolvedValue({
      title: 'Feed',
      items: [{ guid: 'new-resumed', title: 'New', summary: '', link: '', date: '' }],
    });
    expect((await checkSubscriptions(f.rss(), { urls: [old.url] })).pushed).toBe(2);
    expect(f.send.mock.calls.map(([destination]) => destination)).toEqual([target, target]);
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});
