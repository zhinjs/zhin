import { describe, expect, it } from 'vitest';
import { extractChannelInfo, subscriptionScope } from '../src/channel.js';
import { BiliApiError } from '../src/api.js';
import { getBiliState, getBiliSubs } from '../src/store.js';
import { dyn, harness, live, type Harness } from './fixtures.js';

/** Fixture clock in seconds (see harness()). */
const T = 1_800_000_000;

async function subscribe(h: Harness, uid: string, kinds = 'all', channelId = '10001') {
  await getBiliSubs(h.db)!.insert({
    uid, uname: `UP${uid}`, kinds, adapter_name: 'sandbox', endpoint_id: 'bot1',
    channel_type: 'group', channel_id: channelId, creator_id: '', created_at: '',
  });
}

describe('BilibiliWatcher', () => {
  it('formats the same live event per saved subscriber language, with Chinese for legacy rows', async () => {
    const h = harness();
    await subscribe(h, '1', 'live', 'old');
    await subscribe(h, '1', 'live', 'new');
    await getBiliSubs(h.db)!.update({ locale: 'en' }).where({ channel_id: 'new' });
    h.client.liveStatus.set('1', live('1', 0));
    await h.watcher.tick();
    h.client.liveStatus.set('1', live('1', 1, 2000));
    await h.watcher.tick();
    expect(h.pushes).toHaveLength(2);
    expect(h.pushes.find(row => row.channelId === 'old')?.locale).toBe('zh-CN');
    expect(h.pushes.find(row => row.channelId === 'new')?.locale).toBe('en');
    expect(h.pushes.find(row => row.channelId === 'old')?.content).toContain('【开播】');
    expect(h.pushes.find(row => row.channelId === 'new')?.content).toContain('[Live]');
    expect(h.client.calls.live).toBe(2);
  });

  it('restores canonical subscription destinations without reusing a display alias', async () => {
    const h = harness(), Subs = getBiliSubs(h.db)!;
    const targets = ['canonical\0first', 'canonical\0second'].map(id => ({ endpoint: { adapter: 'icqq', id }, kind: 'group' as const, id: 'group' }));
    for (const conversation of targets) await Subs.insert({ uid: '1', kinds: 'live',
      ...subscriptionScope(extractChannelInfo({ conversation, endpointId: 'same-name', clientAdapter: 'icqq' })!),
    });
    await Subs.insert({ uid: '1', kinds: 'live', ...subscriptionScope(extractChannelInfo({ conversation: targets[0] })!), target_json: '{invalid-json' });
    const before = await Subs.select();
    h.client.liveStatus.set('1', live('1', 0)); await h.watcher.tick();
    h.client.liveStatus.set('1', live('1', 1, 2000));
    expect((await h.watcher.tick()).pushed).toBe(2);
    expect(h.pushes.map(row => row.target)).toEqual(targets);
    expect(await Subs.select()).toEqual(before);
  });

  it('records a silent baseline, then pushes a live start once', async () => {
    const h = harness();
    await subscribe(h, '1');
    h.client.liveStatus.set('1', live('1', 1, 1000));
    await h.watcher.tick();
    expect(h.pushes).toEqual([]);

    h.client.liveStatus.set('1', live('1', 0));
    await h.watcher.tick();
    h.client.liveStatus.set('1', live('1', 1, 2000));
    await h.watcher.tick();
    await h.watcher.tick();
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]!.content).toContain('【开播】UP1 开播啦！');
    expect(h.pushes[0]!.content).toContain('https://live.bilibili.com/91');
  });

  it('detects a new live session even if the offline gap was missed', async () => {
    const h = harness();
    await subscribe(h, '1', 'live');
    h.client.liveStatus.set('1', live('1', 1, 1000));
    await h.watcher.tick();
    h.client.liveStatus.set('1', live('1', 1, 5000));
    await h.watcher.tick();
    expect(h.pushes).toHaveLength(1);
  });

  it('pushes only new non-baseline dynamics, deduped across ticks', async () => {
    const h = harness();
    await subscribe(h, '1', 'dynamic');
    await subscribe(h, '1', 'live', '20002');
    h.client.dynamics.set('1', [dyn('top', T + 50, { pinned: true }), dyn('a', T + 100)]);
    await h.watcher.tick();
    expect(h.pushes).toEqual([]);

    h.client.dynamics.set('1', [dyn('top', T + 50, { pinned: true }), dyn('c', T + 300), dyn('b', T + 200), dyn('a', T + 100)]);
    await h.watcher.tick();
    expect(h.pushes.map((p) => p.content.split('\n')[0])).toEqual(['【动态】UP 动态 b', '【动态】UP 动态 c']);
    expect(h.pushes.every((p) => p.channelId === '10001')).toBe(true);

    await h.watcher.tick();
    expect(h.pushes).toHaveLength(2);
    const state = (await getBiliState(h.db)!.select().where({ uid: '1' }))[0]!;
    expect(state.last_dynamic_ts).toBe(T + 300);
  });

  it('caps a burst of dynamics per tick and ignores untimestamped items', async () => {
    const h = harness();
    await subscribe(h, '1', 'dynamic');
    h.client.dynamics.set('1', [dyn('d0', T)]);
    await h.watcher.tick();
    h.client.dynamics.set('1', [1, 2, 3, 4, 5].map((n) => dyn(`d${n}`, T + n * 10)).concat(dyn('broken', 0)));
    await h.watcher.tick();
    expect(h.pushes.map((p) => p.content.split('\n')[0])).toEqual(['【动态】UP 动态 d3', '【动态】UP 动态 d4', '【动态】UP 动态 d5']);
    await h.watcher.tick();
    expect(h.pushes).toHaveLength(3);
  });

  it('does not take an empty (soft-blocked) feed as baseline', async () => {
    const h = harness();
    await subscribe(h, '1', 'dynamic');
    h.client.dynamics.set('1', []);
    await h.watcher.tick();
    h.client.dynamics.set('1', [dyn('a', T - 10), dyn('b', T - 5)]);
    await h.watcher.tick();
    expect(h.pushes).toEqual([]);
    h.client.dynamics.set('1', [dyn('c', T + 1), dyn('b', T - 5), dyn('a', T - 10)]);
    await h.watcher.tick();
    expect(h.pushes).toHaveLength(1);
  });

  it('marks stale unseen dynamics as seen without pushing', async () => {
    const h = harness();
    await subscribe(h, '1', 'dynamic');
    h.client.dynamics.set('1', [dyn('a', T - 100_000)]);
    await h.watcher.tick();
    h.client.dynamics.set('1', [dyn('late', T - 50_000), dyn('a', T - 100_000)]);
    await h.watcher.tick();
    expect(h.pushes).toEqual([]);
    const state = (await getBiliState(h.db)!.select().where({ uid: '1' }))[0]!;
    expect(String(state.seen_dynamics)).toContain('late');
  });

  it('backs off a failing source and recovers after the window', async () => {
    const h = harness({ maxBackoffMinutes: 30 });
    await subscribe(h, '1', 'live');
    h.client.liveError = new BiliApiError('http', 'boom', 500);
    const first = await h.watcher.tick();
    expect(first.errors[0]).toContain('live: boom');
    expect(h.watcher.backoffStatus()[0]).toContain('1 分钟后重试');

    await h.watcher.tick();
    expect(h.client.calls.live).toBe(1);

    h.clock.now += 61_000;
    h.client.liveError = undefined;
    h.client.liveStatus.set('1', live('1', 0));
    await h.watcher.tick();
    expect(h.client.calls.live).toBe(2);
    expect(h.watcher.backoffStatus()).toEqual([]);
  });

  it('risk control backs off harder and stops the dynamic round', async () => {
    const h = harness();
    await subscribe(h, '1', 'dynamic');
    await subscribe(h, '2', 'dynamic');
    h.client.dynamicError = new BiliApiError('risk', 'B 站风控拦截（-352）', -352);
    await h.watcher.tick();
    expect(h.client.calls.dynamics).toBe(1);
    expect(h.watcher.backoffStatus()[0]).toContain('2 分钟后重试');
    expect(h.watcher.lastError?.message).toContain('-352');
  });

  it('applies jitter and request gaps through the injected sleeper', async () => {
    const h = harness({ jitterMs: 10_000, requestGapMs: 1500 });
    await subscribe(h, '1', 'dynamic');
    await subscribe(h, '2', 'dynamic');
    await h.watcher.tick();
    expect(h.sleeps).toEqual([5000, 1500]);
  });

  it('respects the live/dynamic switches and skips empty subscription sets', async () => {
    const h = harness({ live: false });
    const empty = await h.watcher.tick();
    expect(empty).toMatchObject({ liveChecked: 0, dynamicsChecked: 0 });
    await subscribe(h, '1');
    await h.watcher.tick();
    expect(h.client.calls).toEqual({ live: 0, dynamics: 1 });
  });

  it('never overlaps ticks', async () => {
    const h = harness();
    await subscribe(h, '1');
    const [a, b] = await Promise.all([h.watcher.tick(), h.watcher.tick()]);
    expect([a.skipped, b.skipped]).toContain('busy');
  });
});
