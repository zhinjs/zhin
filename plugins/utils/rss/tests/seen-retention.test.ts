import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as feeds from '../src/feed.js';
import { createInMemoryRssDb, getRssSeen, getRssSubs } from '../src/db-store.js';
import { checkSubscriptions, cleanOldSeen, markItemsSeen } from '../src/poll.js';
import type { RssRuntime } from '../src/runtime.js';

const URL_ = 'https://example.org/feed.xml';
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-03-01T00:00:00.000Z');

function item(guid: string, date = ''): feeds.FeedItem {
  return { guid, title: guid, link: `https://example.org/${guid}`, date, summary: '' };
}

function setup() {
  const pushes: string[] = [];
  const runtime: RssRuntime = {
    db: createInMemoryRssDb(),
    config: feeds.resolveRssConfig({}),
    outbound: async (input) => { pushes.push(input.content); },
  };
  return { runtime, pushes };
}

async function subscribe(runtime: RssRuntime) {
  await getRssSubs(runtime.db)!.insert({
    url: URL_, feed_title: 'Demo', adapter_name: 'sandbox', endpoint_id: 'bot', channel_type: 'group', channel_id: 'g1',
  });
}

describe('rss seen retention (fixed clock)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not re-push an item that stays in the feed longer than the retention window', async () => {
    const { runtime, pushes } = setup();
    await subscribe(runtime);
    // An evergreen, undated entry (a pinned post) plus one normal entry.
    const load = vi.spyOn(feeds, 'fetchFeed').mockResolvedValue({ title: 'Demo', items: [item('pinned'), item('a')] });
    expect((await checkSubscriptions(runtime, { urls: [URL_] })).totalNew).toBe(2);
    expect(pushes).toHaveLength(1);

    // Three weeks of daily polls and nightly cleanups with the same two entries still listed.
    for (let day = 1; day <= 21; day += 1) {
      vi.setSystemTime(START + day * DAY);
      expect((await checkSubscriptions(runtime, { urls: [URL_] })).totalNew).toBe(0);
      await cleanOldSeen(runtime);
    }
    expect(pushes).toHaveLength(1);
    expect((await getRssSeen(runtime.db)!.select()).map(row => row.item_guid).sort()).toEqual(['a', 'pinned']);
    expect(load).toHaveBeenCalledTimes(22);
  });

  it('never announces an item whose publish date is older than the retention window', async () => {
    const { runtime, pushes } = setup();
    await subscribe(runtime);
    const old = new Date(START - 8 * DAY).toISOString();
    const recent = new Date(START - 6 * DAY).toISOString();
    vi.spyOn(feeds, 'fetchFeed').mockResolvedValue({
      title: 'Demo', items: [item('ancient', old), item('recent', recent), item('undated'), item('garbled', 'not a date')],
    });
    const result = await checkSubscriptions(runtime, { urls: [URL_] });
    expect(result.totalNew).toBe(3);
    expect(pushes[0]).not.toContain('ancient');
    expect((await getRssSeen(runtime.db)!.select()).map(row => row.item_guid).sort()).toEqual(['garbled', 'recent', 'undated']);
  });

  it('drops rows of items that left the feed once they are past the window, one delete per batch', async () => {
    const { runtime } = setup();
    const Seen = getRssSeen(runtime.db)!;
    await markItemsSeen(runtime, URL_, [item('gone-1'), item('gone-2'), item('gone-1')]);
    expect(await Seen.select()).toHaveLength(2);
    // Both rows carry the same batch timestamp.
    expect(new Set((await Seen.select()).map(row => row.seen_at)).size).toBe(1);
    vi.setSystemTime(START + 3 * DAY);
    await markItemsSeen(runtime, URL_, [item('kept'), item('gone-1')]);
    expect(await Seen.select()).toHaveLength(3);

    vi.setSystemTime(START + 8 * DAY);
    const remove = vi.spyOn(Seen, 'delete');
    await cleanOldSeen(runtime);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await Seen.select()).map(row => row.item_guid)).toEqual(['kept']);
  });

  it('markItemsSeen reads the seen table once per feed, not once per item', async () => {
    const { runtime } = setup();
    const Seen = getRssSeen(runtime.db)!;
    const select = vi.spyOn(Seen, 'select');
    await markItemsSeen(runtime, URL_, Array.from({ length: 20 }, (_, index) => item(`g${index}`)));
    expect(select).toHaveBeenCalledTimes(1);
    expect(await Seen.select()).toHaveLength(20);
  });
});
