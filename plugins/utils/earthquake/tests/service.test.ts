import { describe, expect, it, vi } from 'vitest';
import { resolveEarthquakeConfig } from '../src/config.js';
import { EarthquakeService, EarthquakeUnavailableError, type PushSender } from '../src/service.js';
import { createMemoryState, SubscriptionStore, type EarthquakeSubscription } from '../src/subscriptions.js';
import {
  createRoutedFetch,
  JAPAN_USGS,
  jsonResponse,
  MIRROR_URL,
  mirrorBody,
  NOW,
  OFFICIAL_URL,
  officialBody,
  SICHUAN_CENC,
  SICHUAN_MIRROR,
  SICHUAN_USGS,
  SMALL_XINJIANG_CENC,
  statusResponse,
  USGS_URL,
  usgsBody,
  type QuakeSpec,
  type Route,
} from './fixtures.js';

interface Feeds {
  mirror?: Route;
  official?: Route;
  usgs?: Route;
}

function setup(feeds: Feeds, configOverrides: Record<string, unknown> = {}) {
  const clock = { now: NOW };
  const fetch = createRoutedFetch({
    [MIRROR_URL]: feeds.mirror ?? (() => statusResponse(503)),
    [OFFICIAL_URL]: feeds.official ?? (() => statusResponse(503)),
    [USGS_URL]: feeds.usgs ?? (() => statusResponse(503)),
  });
  const config = resolveEarthquakeConfig({ maxRetries: 0, ...configOverrides });
  const store = new SubscriptionStore(createMemoryState(), { maxSubscriptions: 10 });
  const push = vi.fn<PushSender>(async () => undefined);
  const logger = { warn: vi.fn() };
  const service = new EarthquakeService({
    config,
    store,
    push,
    logger,
    deps: { fetch, sleep: async () => undefined, now: () => clock.now, random: () => 0 },
  });
  return { service, store, push, fetch, clock, logger };
}

function subscription(overrides: Partial<EarthquakeSubscription> = {}): EarthquakeSubscription {
  return {
    adapter: 'sandbox',
    endpointKey: 'bot',
    conversationKind: 'group',
    conversationId: 'g1',
    minMagnitude: 5,
    regions: [],
    createdBy: 'u1',
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

/** A mutable feed whose contents tests can change between polls. */
function mutableFeed(render: (quakes: QuakeSpec[]) => string, initial: QuakeSpec[] = []) {
  const state = { quakes: initial };
  const route: Route = () => jsonResponse(render(state.quakes));
  return { state, route };
}

describe('EarthquakeService.queryRecent', () => {
  it('merges CENC and USGS and sorts newest first', async () => {
    const { service } = setup({
      mirror: () => jsonResponse(mirrorBody([SICHUAN_MIRROR, SMALL_XINJIANG_CENC])),
      usgs: () => jsonResponse(usgsBody([SICHUAN_USGS, JAPAN_USGS])),
    });
    const result = await service.queryRecent({ limit: 10, minMagnitude: 3, regions: [], hours: 24 });
    expect(result.stale).toBe(false);
    expect(result.events.map((event) => event.primary.location)).toEqual([
      '四川绵阳市北川县',
      'off the east coast of Honshu, Japan',
      '新疆巴音郭楞州尉犁县',
    ]);
    expect(result.events[0]!.reports).toHaveLength(2);
  });

  it('falls back from the CENC mirror to the official URL', async () => {
    const { service, fetch } = setup({
      mirror: () => Promise.reject(new TypeError('fetch failed')),
      official: () => jsonResponse(officialBody([SICHUAN_CENC])),
      usgs: () => jsonResponse(usgsBody([])),
    });
    const result = await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    expect(result.events).toHaveLength(1);
    expect(result.outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(fetch.mock.calls.map((call) => call[0])).toContain(OFFICIAL_URL);
    expect(service.health().find((health) => health.id === 'cenc')!.activeUrl).toBe(OFFICIAL_URL);
  });

  it('falls back to USGS when every CENC URL fails, and reports the failure', async () => {
    const { service } = setup({
      mirror: () => statusResponse(500),
      official: () => jsonResponse('<html>gateway</html>'),
      usgs: () => jsonResponse(usgsBody([SICHUAN_USGS])),
    });
    const result = await service.queryRecent({ limit: 5, minMagnitude: 0, regions: ['中国'], hours: 24 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.primary.source).toBe('usgs');
    const cenc = result.outcomes.find((outcome) => outcome.source === 'cenc')!;
    expect(cenc.ok).toBe(false);
    expect(cenc.error).toContain('HTTP 500');
    expect(cenc.error).toContain('不是有效 JSON');
  });

  it('serves stale cached data when every source fails later', async () => {
    let healthy = true;
    const { service, clock } = setup({
      mirror: () => (healthy ? jsonResponse(mirrorBody([SICHUAN_CENC])) : statusResponse(503)),
      usgs: () => (healthy ? jsonResponse(usgsBody([])) : statusResponse(503)),
    });
    await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    healthy = false;
    clock.now += 60_000;
    const result = await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    expect(result.stale).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it('throws EarthquakeUnavailableError when nothing was ever fetched', async () => {
    const { service } = setup({});
    await expect(service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 }))
      .rejects.toBeInstanceOf(EarthquakeUnavailableError);
  });

  it('puts a failing source on cooldown and skips it until the cooldown ends', async () => {
    const { service, fetch, clock } = setup({ usgs: () => jsonResponse(usgsBody([JAPAN_USGS])) }, { sources: ['usgs', 'cenc'] });
    await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    const cencCalls = () => fetch.mock.calls.filter((call) => call[0] !== USGS_URL).length;
    expect(cencCalls()).toBe(2);
    const second = await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    expect(cencCalls()).toBe(2);
    expect(second.outcomes.find((outcome) => outcome.source === 'cenc')!.skipped).toBe(true);
    clock.now += 31_000;
    await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    expect(cencCalls()).toBe(4);
  });

  it('cools a source down for the server-requested Retry-After', async () => {
    const { service, clock } = setup({
      mirror: () => statusResponse(429, { 'retry-after': '900' }),
      official: () => statusResponse(503),
      usgs: () => jsonResponse(usgsBody([])),
    });
    await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    const cenc = service.health().find((health) => health.id === 'cenc')!;
    expect(cenc.coolingDownUntil).toBe(clock.now + 900_000);
  });

  it('reuses the cache on 304 Not Modified', async () => {
    let calls = 0;
    const { service } = setup({
      mirror: (init) => {
        calls += 1;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers['If-None-Match'] === '"v1"') return statusResponse(304);
        return jsonResponse(mirrorBody([SICHUAN_CENC]), { headers: { etag: '"v1"' } });
      },
      usgs: () => jsonResponse(usgsBody([])),
    });
    await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    const second = await service.queryRecent({ limit: 5, minMagnitude: 0, regions: [], hours: 24 });
    expect(calls).toBe(2);
    expect(second.events).toHaveLength(1);
  });
});

describe('EarthquakeService.poll', () => {
  it('baselines the first round without pushing, then pushes new matching events once', async () => {
    const cenc = mutableFeed(mirrorBody, [SMALL_XINJIANG_CENC]);
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push } = setup({ mirror: cenc.route, usgs: usgs.route });
    await store.upsert(subscription({ minMagnitude: 5, regions: ['中国'] }));

    const baseline = await service.poll();
    expect(baseline.status).toBe('ok');
    expect(push).not.toHaveBeenCalled();

    cenc.state.quakes = [SMALL_XINJIANG_CENC, SICHUAN_CENC];
    const first = await service.poll();
    expect(first).toMatchObject({ newEvents: 1, pushed: 1 });
    expect(push).toHaveBeenCalledTimes(1);
    const [target, content] = push.mock.calls[0]!;
    expect(target.conversationId).toBe('g1');
    expect(content).toContain('地震速报');
    expect(content).toContain('四川绵阳市北川县');

    // USGS reports the same quake later, and the mirror re-ids it: no second push.
    usgs.state.quakes = [SICHUAN_USGS];
    cenc.state.quakes = [SMALL_XINJIANG_CENC, SICHUAN_MIRROR];
    const second = await service.poll();
    expect(second.newEvents).toBe(0);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('applies subscription filters', async () => {
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push } = setup({ usgs: usgs.route }, { sources: ['usgs'] });
    await store.upsert(subscription({ conversationId: 'china', minMagnitude: 5, regions: ['中国'] }));
    await store.upsert(subscription({ conversationId: 'big', minMagnitude: 6.5, regions: [] }));
    await store.upsert(subscription({ conversationId: 'japan', minMagnitude: 6, regions: ['japan'] }));
    await service.poll();
    usgs.state.quakes = [SICHUAN_USGS, JAPAN_USGS];
    await service.poll();
    const targets = push.mock.calls.map((call) => call[0].conversationId).sort();
    expect(targets).toEqual(['china', 'japan']);
  });

  it('never pushes events older than maxEventAgeMinutes', async () => {
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push } = setup({ usgs: usgs.route }, { sources: ['usgs'], maxEventAgeMinutes: 15 });
    await store.upsert(subscription({ minMagnitude: 0 }));
    await service.poll();
    usgs.state.quakes = [JAPAN_USGS]; // 20 minutes old
    const report = await service.poll();
    expect(report.newEvents).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('rate-limits pushes per conversation and reports skipped events later', async () => {
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push, clock } = setup({ usgs: usgs.route }, {
      sources: ['usgs'],
      pushLimit: 1,
      pushWindowMinutes: 10,
    });
    await store.upsert(subscription({ minMagnitude: 0 }));
    await service.poll();

    const quake = (index: number): QuakeSpec => ({
      ...JAPAN_USGS,
      id: `q${index}`,
      time: clock.now - 60_000,
      latitude: 10 + index * 5,
    });
    usgs.state.quakes = [quake(1)];
    expect((await service.poll()).pushed).toBe(1);

    clock.now += 60_000;
    usgs.state.quakes = [quake(1), quake(2), quake(3)];
    const limited = await service.poll();
    expect(limited).toMatchObject({ pushed: 0, rateLimited: 2 });

    clock.now += 10 * 60_000;
    usgs.state.quakes = [quake(1), quake(2), quake(3), quake(4)];
    const after = await service.poll();
    expect(after.pushed).toBe(1);
    expect(push.mock.calls.at(-1)![1]).toContain('另有 2 条地震未推送');
  });

  it('caps events per message and summarises the rest', async () => {
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push, clock } = setup({ usgs: usgs.route }, { sources: ['usgs'], maxEventsPerMessage: 2 });
    await store.upsert(subscription({ minMagnitude: 0 }));
    await service.poll();
    usgs.state.quakes = [1, 2, 3, 4].map((index) => ({ ...JAPAN_USGS, id: `m${index}`, time: clock.now - index * 60_000, latitude: index * 10 }));
    await service.poll();
    const content = push.mock.calls[0]![1];
    expect(content).toContain('（4 条）');
    expect(content).toContain('另有 2 条未展示');
  });

  it('keeps going after push failures, source failures and store failures', async () => {
    const usgs = mutableFeed((quakes) => usgsBody(quakes));
    const { service, store, push, logger } = setup({ usgs: usgs.route }, { sources: ['usgs'] });
    await store.upsert(subscription({ conversationId: 'a', minMagnitude: 0 }));
    await store.upsert(subscription({ conversationId: 'b', minMagnitude: 0 }));
    await service.poll();
    push.mockRejectedValueOnce(new Error('adapter offline'));
    usgs.state.quakes = [SICHUAN_USGS];
    const report = await service.poll();
    expect(report).toMatchObject({ status: 'ok', pushed: 1, failedPushes: 1 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('adapter offline'));

    const down = setup({}, { sources: ['usgs'] });
    await expect(down.service.poll()).resolves.toMatchObject({ status: 'failed' });

    vi.spyOn(store, 'list').mockRejectedValueOnce(new Error('db locked'));
    usgs.state.quakes = [SICHUAN_USGS, JAPAN_USGS];
    await expect(service.poll()).resolves.toMatchObject({ status: 'failed', error: 'db locked' });
  });

  it('skips overlapping ticks (single flight) and stops after stop()', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = setup({
      usgs: async () => {
        await gate;
        return jsonResponse(usgsBody([]));
      },
    }, { sources: ['usgs'] });
    const first = service.poll();
    await expect(service.poll()).resolves.toMatchObject({ status: 'skipped' });
    release();
    await expect(first).resolves.toMatchObject({ status: 'ok' });
    service.stop();
    await expect(service.poll()).resolves.toMatchObject({ status: 'skipped' });
  });

  it('retries a transient failure inside one poll before giving up on the source', async () => {
    let calls = 0;
    const { service } = setup({
      usgs: () => {
        calls += 1;
        return calls === 1 ? statusResponse(503) : jsonResponse(usgsBody([]));
      },
    }, { sources: ['usgs'], maxRetries: 2 });
    await expect(service.poll()).resolves.toMatchObject({ status: 'ok' });
    expect(calls).toBe(2);
  });
});
