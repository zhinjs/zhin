import { describe, expect, it } from 'vitest';
import { distanceKm, isSameEvent, mergeReports, SeenEventLog } from '../src/dedupe.js';
import { eventMagnitude, matchesFilter, matchesRegions } from '../src/filters.js';
import { SlidingWindowRateLimiter } from '../src/rate-limit.js';
import type { SourceEarthquake } from '../src/types.js';
import { parseSubscribeArgs } from '../src/subscribe-args.js';
import { JAPAN_USGS, NOW, SICHUAN_CENC, SICHUAN_MIRROR, SICHUAN_USGS, type QuakeSpec } from './fixtures.js';

function report(source: 'cenc' | 'usgs', spec: QuakeSpec): SourceEarthquake {
  return { source, ...spec, depthKm: spec.depth ?? 10 };
}

const cenc = report('cenc', SICHUAN_CENC);
const mirror = report('cenc', SICHUAN_MIRROR);
const usgs = report('usgs', SICHUAN_USGS);
const japan = report('usgs', JAPAN_USGS);

describe('dedupe', () => {
  it('computes great-circle distance', () => {
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.19, 1);
  });

  it('matches the same quake across sources within tolerance', () => {
    expect(isSameEvent(cenc, usgs)).toBe(true);
    expect(isSameEvent(cenc, japan)).toBe(false);
    expect(isSameEvent(cenc, { ...usgs, time: cenc.time + 120_000 })).toBe(false);
    expect(isSameEvent(cenc, { ...usgs, magnitude: 7.5 })).toBe(false);
  });

  it('matches one event published by two CENC mirrors under different ids', () => {
    expect(isSameEvent(cenc, mirror)).toBe(true);
    expect(isSameEvent(cenc, { ...mirror, time: cenc.time + 60_000 })).toBe(false);
  });

  it('merges reports, preferring the first configured source as primary', () => {
    const events = mergeReports([usgs, japan, cenc, mirror], ['cenc', 'usgs']);
    expect(events).toHaveLength(2);
    const sichuan = events.find((event) => event.primary.source === 'cenc')!;
    expect(sichuan.reports.map((entry) => entry.source)).toEqual(['cenc', 'usgs']);
    expect(eventMagnitude(sichuan)).toBe(5.9);
    // newest first
    expect(events[0]!.primary.time).toBeGreaterThan(events[1]!.primary.time);

    const usgsFirst = mergeReports([cenc, usgs], ['usgs', 'cenc']);
    expect(usgsFirst[0]!.primary.source).toBe('usgs');
  });

  it('remembers seen events across sources and prunes by age and size', () => {
    const log = new SeenEventLog({ maxEntries: 2, maxAgeMs: 60 * 60_000 });
    log.add({ primary: cenc, reports: [cenc] });
    expect(log.has({ primary: usgs, reports: [usgs] })).toBe(true);
    expect(log.has({ primary: mirror, reports: [mirror] })).toBe(true);
    expect(log.has({ primary: japan, reports: [japan] })).toBe(false);
    log.add({ primary: japan, reports: [japan] });
    log.add({ primary: { ...japan, id: 'old', time: NOW - 2 * 60 * 60_000 }, reports: [{ ...japan, id: 'old', time: NOW - 2 * 60 * 60_000 }] });
    log.prune(NOW);
    expect(log.size).toBe(2);
  });
});

describe('filters', () => {
  const [sichuan, japanEvent] = [
    { primary: cenc, reports: [cenc, usgs] },
    { primary: japan, reports: [japan] },
  ];

  it('matches region keywords against every report, case-insensitively', () => {
    expect(matchesRegions(sichuan, ['四川'])).toBe(true);
    expect(matchesRegions(sichuan, ['jiangyou'])).toBe(true);
    expect(matchesRegions(japanEvent, ['Japan'])).toBe(true);
    expect(matchesRegions(japanEvent, ['四川', '云南'])).toBe(false);
    expect(matchesRegions(japanEvent, [])).toBe(true);
  });

  it('treats 中国 / 国内 as a preset for domestic events', () => {
    expect(matchesRegions(sichuan, ['中国'])).toBe(true);
    expect(matchesRegions(japanEvent, ['国内'])).toBe(false);
    const taiwan = report('usgs', { ...JAPAN_USGS, id: 'tw', location: '20 km E of Hualien City, Taiwan' });
    expect(matchesRegions({ primary: taiwan, reports: [taiwan] }, ['中国'])).toBe(true);
  });

  it('applies the magnitude threshold to the largest reported magnitude', () => {
    expect(matchesFilter(sichuan, { minMagnitude: 5.5, regions: [] })).toBe(true);
    expect(matchesFilter(sichuan, { minMagnitude: 6, regions: [] })).toBe(false);
  });

  it('parses subscribe arguments', () => {
    expect(parseSubscribeArgs([])).toEqual({ minMagnitude: undefined, regions: [] });
    expect(parseSubscribeArgs(['5.5', '四川', '云南'])).toEqual({ minMagnitude: 5.5, regions: ['四川', '云南'] });
    expect(parseSubscribeArgs(['M6', '日本'])).toEqual({ minMagnitude: 6, regions: ['日本'] });
    expect(parseSubscribeArgs(['4级'])).toEqual({ minMagnitude: 4, regions: [] });
    expect(parseSubscribeArgs(['四川'])).toEqual({ minMagnitude: undefined, regions: ['四川'] });
    expect(parseSubscribeArgs(['四川', '5'])).toHaveProperty('error');
    expect(parseSubscribeArgs(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveProperty('error');
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('allows `limit` acquisitions per window per key', () => {
    let now = NOW;
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('b')).toBe(true);
    expect(limiter.remaining('a')).toBe(0);
    now += 60_001;
    expect(limiter.remaining('a')).toBe(2);
    expect(limiter.tryAcquire('a')).toBe(true);
  });
});
