import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import { UsageStatsService, resolveUsageStatsQuery, USAGE_STATS_PERMISSION } from '../../../src/plugin-runtime/console/usage-stats-rpc.js';
import { buildUsageStats, parseSessionKey } from '../../../src/usage/aggregate.js';

const signal = new AbortController().signal;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const DAY = 86_400_000;
const NOON = new Date(2026, 9, 28, 12).getTime();
type Call = { provider?: string; model?: string; p: number; o?: number; c?: number; w?: number };
function turn(session: string, calls: Call[], at = NOON, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1, session_key: session, started_at: at,
    model_calls: calls.map(x => ({ provider: x.provider ?? 'gemini', model: x.model ?? 'flash', prompt_tokens: x.p, completion_tokens: x.o ?? 1, cache_read_tokens: x.c ?? 0, ...(x.w ? { cache_write_tokens: x.w } : {}) })),
    ...extra,
  });
}
function fixture(files: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-stats-'));
  dirs.push(dir);
  for (const [name, lines] of Object.entries(files)) writeFileSync(join(dir, name), lines.join('\n') + '\n');
  return dir;
}
const range = (bucket: 'hour' | 'day' = 'day') => ({ since: NOON - 2 * DAY, until: NOON + DAY, bucket });

describe('buildUsageStats', () => {
  it('aggregates by model, session, segments, cache and zero-fills the series', async () => {
    const dir = fixture({
      '2026-10-28.jsonl': [
        turn('icqq:1:group:42', [{ p: 1000, c: 500, w: 10 }, { p: 3000, o: 5, c: 0, provider: 'openai', model: 'mini' }], NOON, { context_budget: { segments: { history: 5, system: 2, bootstrap: 1, user: 3, active_skills: 9 } } }),
        turn('icqq:1:private:7', [{ p: 200 }], NOON + 1000),
        'not json',
        '{"started_at":1}',
      ],
    });
    const s = await buildUsageStats(dir, range());
    expect(s.totals).toMatchObject({ turns: 2, calls: 3, inputTokens: 4200, outputTokens: 7, cacheReadTokens: 500, cacheWriteTokens: 10 });
    expect(s.totals.cacheShare).toBeCloseTo(500 / 4200);
    expect(s.totals.cacheShareByCall).toEqual({ p50: 0, p90: 0.5 });
    expect(s.byModel.map(m => [m.provider, m.model, m.inputTokens])).toEqual([['openai', 'mini', 3000], ['gemini', 'flash', 1200]]);
    expect(s.byModel[1]).toMatchObject({ calls: 2, cacheReadTokens: 500, cacheShare: 500 / 1200 });
    expect(s.bySession[0]).toMatchObject({ sessionKey: 'icqq:1:group:42', platform: 'icqq', scope: 'group', sceneId: '42', turns: 1, calls: 2, inputTokens: 4000 });
    expect(s.segments).toEqual({ history: 5, fixed: 3, user: 3 });
    expect(s.malformedLines).toBe(2);
    expect(s.filesRead).toBe(1);
    // day buckets, zero-filled ascending: Oct 26-29
    expect(s.series).toHaveLength(4);
    expect(s.series.map(b => b.calls)).toEqual([0, 0, 3, 0]);
    expect(s.series[2]!.byModel).toEqual({ 'gemini/flash': 1200, 'openai/mini': 3000 });
    expect(s.series[0]!.byModel).toEqual({});
    expect(s.series[1]!.bucketStart).toBeGreaterThan(s.series[0]!.bucketStart);
  });

  it('buckets hourly, filters sessions and skips files outside the range', async () => {
    const dir = fixture({
      '2026-10-28.jsonl': [turn('icqq:1:group:42', [{ p: 10 }]), turn('qq:1:group:9', [{ p: 20 }])],
      '2026-09-01.jsonl': [turn('icqq:1:group:42', [{ p: 99 }], new Date(2026, 8, 1, 12).getTime())],
    });
    const s = await buildUsageStats(dir, { since: NOON - 3 * 3_600_000, until: NOON + 3 * 3_600_000, bucket: 'hour', session: 'icqq:*:group:*' });
    expect(s.series).toHaveLength(6);
    expect(s.totals.inputTokens).toBe(10);
    expect(s.filesRead).toBe(1);
  });

  it('handles a missing directory and odd session keys', async () => {
    const s = await buildUsageStats(join(tmpdir(), 'no-such-usage-dir'), range());
    expect(s.totals).toMatchObject({ turns: 0, calls: 0, cacheShare: 0 });
    expect(parseSessionKey('weird')).toEqual({ platform: 'weird' });
    expect(parseSessionKey('a:b:c')).toEqual({ platform: 'a', scope: 'b', sceneId: 'c' });
  });
});

describe('resolveUsageStatsQuery', () => {
  it('defaults to 7 days ending now, choosing the bucket by range', () => {
    expect(resolveUsageStatsQuery({}, NOON)).toEqual({ since: NOON - 7 * DAY, until: NOON, bucket: 'day' });
    expect(resolveUsageStatsQuery({ since: NOON - DAY }, NOON).bucket).toBe('hour');
    expect(resolveUsageStatsQuery({ since: NOON - 2 * DAY }, NOON).bucket).toBe('hour');
    expect(resolveUsageStatsQuery({ since: NOON - 3 * DAY, bucket: 'hour' }, NOON).bucket).toBe('hour');
  });
  it('rejects ranges above 31 days and bad input', () => {
    expect(resolveUsageStatsQuery({ since: NOON - 31 * DAY }, NOON).since).toBe(NOON - 31 * DAY);
    for (const input of [{ since: NOON - 31 * DAY - 1 }, { since: NOON, until: NOON }, { bucket: 'week' }, { since: 'x' }, { session: 5 }]) {
      expect(() => resolveUsageStatsQuery(input as never, NOON), JSON.stringify(input)).toThrow(PluginConsoleRpcError);
    }
  });
});

describe('UsageStatsService cache', () => {
  it('serves identical input from cache for 60s, bounds entries, and drops on dispose', async () => {
    let now = NOON;
    let builds = 0;
    const svc = new UsageStatsService({
      dir: () => '/x',
      now: () => now,
      build: async (_d, q) => { builds++; return { range: { ...q, timeZone: 'UTC' } } as never; },
    });
    await svc.stats({});
    now += 30_000;
    await svc.stats({});
    expect(builds).toBe(1);
    now += 31_000;
    await svc.stats({});
    expect(builds).toBe(2);
    for (let i = 0; i < 40; i++) await svc.stats({ session: `s${i}` });
    builds = 0;
    await svc.stats({ session: 's39' });
    expect(builds).toBe(0);
    await svc.stats({ session: 's0' });
    expect(builds).toBe(1);
    svc.dispose();
    await svc.stats({ session: 's39' });
    expect(builds).toBe(2);
  });

  it('reports unavailable without a bound dir', async () => {
    await expect(new UsageStatsService({ dir: () => undefined }).stats({})).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('plugin.root.usage-stats registration', () => {
  it('is a read-only query behind control:read and answers through the bound dir', async () => {
    const status = new AssistantStatus({ now: () => NOON });
    const method = status.consoleRpc.methods.get('usage-stats')!;
    expect(method).toMatchObject({ readOnly: true, requiredPermissions: [USAGE_STATS_PERMISSION] });
    expect(USAGE_STATS_PERMISSION).toBe('control:read');
    await expect(Promise.resolve(method.handler({} as never, { signal }))).rejects.toMatchObject({ code: 'unavailable' });
    const dir = fixture({ '2026-10-28.jsonl': [turn('icqq:1:group:42', [{ p: 10, c: 5 }])] });
    status.bindUsageTraces(() => dir);
    const out = (await method.handler({ since: NOON - DAY, until: NOON + DAY } as never, { signal })) as Record<string, any>;
    expect(out.totals).toMatchObject({ turns: 1, calls: 1, inputTokens: 10, cacheShare: 0.5 });
    expect(out.range.bucket).toBe('hour');
  });
});
