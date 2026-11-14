import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { AssistantStatus } from '../../../src/instance/console/assistant-status.js';
import { UsageStatsService, resolveUsageStatsQuery, USAGE_STATS_PERMISSION } from '../../../src/instance/console/usage-stats-rpc.js';
import { buildUsageStats, bucketStartOf, dayKeyOf, parseSessionKey } from '../../../../../host/gateway/src/usage/aggregate.js';
import { createProviderDisplayIndex } from '../../../src/instance/inference/provider-display.js';

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
  it('carries prompt-cache hints for services that never hit the cache on a stable prefix (#1250)', async () => {
    const lines = Array.from({ length: 12 }, (_, index) => JSON.stringify({
      version: 1, session_key: `icqq:1:group:${index % 3}`, started_at: NOON + index,
      model_calls: [1, 2].map(() => ({ provider: 'relay', model: 'flash', prompt_tokens: 3000, completion_tokens: 1, cache_read_tokens: 0, prefix_hash: 'p' })),
    }));
    const s = await buildUsageStats(fixture({ '2026-10-28.jsonl': lines }), range());
    expect(s.promptCacheHints).toHaveLength(1);
    expect(s.promptCacheHints[0]).toMatchObject({ provider: 'relay', zeroCacheCalls: 24, sessions: 3, samePrefixRatio: 1 });
    const quiet = await buildUsageStats(fixture({ '2026-10-28.jsonl': [turn('icqq:1:group:1', [{ p: 1000, c: 500 }])] }), range());
    expect(quiet.promptCacheHints).toEqual([]);
  });

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

describe('usage model labels, input basis, time zone and session names (#1250)', () => {
  const SVC = 'services:11111111-1111-4111-8111-111111111111';
  const ACC = 'accounts:22222222-2222-4222-8222-222222222222';
  const graph = {
    rootId: '/p', revision: 1,
    services: { [SVC]: { id: SVC, rootId: '/p', ownerId: 'o', revision: 1, label: 'AG 中转', driver: { id: 'openai-compatible', owner: 'x', contractVersion: '1' }, options: {}, models: {} } },
    accounts: { [ACC]: { id: ACC, rootId: '/p', ownerId: 'o', revision: 1, serviceId: SVC, incarnation: 'i', authentication: { method: 'none' } } },
    profiles: { 'profiles:p1': { id: 'profiles:p1', rootId: '/p', ownerId: 'o', revision: 1, accountId: ACC, model: 'ag/gemini-3.8-flash', parameters: {} } },
    purposes: { defaults: { chat: 'profiles:p1' } },
  } as never;

  it('merges services:/accounts: ids of one service into a 服务名 · 模型 row', async () => {
    const dir = fixture({ '2026-10-28.jsonl': [
      turn('personal-session:v1:' + 'a'.repeat(64), [{ provider: SVC, model: 'ag/gemini-3.8-flash', p: 100 }, { provider: ACC, model: 'ag/gemini-3.8-flash', p: 50 }], NOON,
        { origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: '42', conversation: { name: '测试群' } } }),
    ] });
    const index = createProviderDisplayIndex(graph);
    const s = await buildUsageStats(dir, range(), { resolveProvider: id => index.resolveProvider(id) });
    expect(s.byModel).toHaveLength(1);
    expect(s.byModel[0]).toMatchObject({ provider: SVC, model: 'ag/gemini-3.8-flash', displayName: 'AG 中转 · ag/gemini-3.8-flash', providerLabel: 'AG 中转', inputTokens: 150, calls: 2 });
    expect(s.byModel[0]!.providerIds).toEqual([ACC, SVC].sort());
    expect(s.modelLabels).toEqual({ [`${SVC}/ag/gemini-3.8-flash`]: 'AG 中转 · ag/gemini-3.8-flash' });
    expect(s.series.find(b => b.calls)!.byModel).toEqual({ [`${SVC}/ag/gemini-3.8-flash`]: 150 });
    expect(s.bySession[0]).toMatchObject({ displayName: 'qq · 群 测试群' });
    expect(s.bySession[0]).not.toHaveProperty('platform');
    // Without a resolver opaque ids still merge by model and never show a UUID.
    const bare = await buildUsageStats(dir, range());
    expect(bare.byModel).toHaveLength(1);
    expect(bare.byModel[0]!.displayName).toBe('ag/gemini-3.8-flash');
  });

  it('labels the two input totals: all reported calls vs the first-request estimate', async () => {
    const dir = fixture({ '2026-10-28.jsonl': [
      turn('s', [{ p: 1000 }, { p: 3000 }], NOON, { context_budget: { segments: { history: 500, system: 200, user: 100, active_skills: 50 } } }),
      turn('s', [{ p: 400 }], NOON + 1),
    ] });
    const s = await buildUsageStats(dir, range());
    expect(s.totals).toMatchObject({ inputTokens: 4400, inputBasis: 'reported-all-calls' });
    expect(s.inputBreakdown).toEqual({ basis: 'first-request-estimate', turns: 1, history: 500, fixed: 200, user: 100, other: 50, estimatedTotal: 850, firstRequestInputTokens: 1000 });
  });

  it('buckets by the requested time zone, not the process zone', async () => {
    // 2026-10-28T20:00Z is 10-29 04:00 in Shanghai and 10-28 in UTC.
    const at = Date.UTC(2026, 9, 28, 20);
    expect(dayKeyOf(at, 'Asia/Shanghai')).toBe('2026-10-29');
    expect(dayKeyOf(at, 'UTC')).toBe('2026-10-28');
    expect(bucketStartOf(at, 'day', 'Asia/Shanghai')).toBe(Date.UTC(2026, 9, 28, 16));
    expect(bucketStartOf(at, 'hour', 'Asia/Kolkata')).toBe(Date.UTC(2026, 9, 28, 19, 30));
    // DST: 2026-03-08 is 23 h long in New York.
    const ny = bucketStartOf(Date.UTC(2026, 2, 8, 18), 'day', 'America/New_York');
    expect(ny).toBe(Date.UTC(2026, 2, 8, 5));
    const dir = fixture({ '2026-10-28.jsonl': [turn('s', [{ p: 7 }], at)] });
    const s = await buildUsageStats(dir, { since: Date.UTC(2026, 9, 27, 16), until: Date.UTC(2026, 9, 30, 16), bucket: 'day', timeZone: 'Asia/Shanghai' });
    expect(s.range.timeZone).toBe('Asia/Shanghai');
    expect(s.series.map(b => b.bucketStart)).toEqual([Date.UTC(2026, 9, 27, 16), Date.UTC(2026, 9, 28, 16), Date.UTC(2026, 9, 29, 16)]);
    expect(s.series.map(b => b.inputTokens)).toEqual([0, 7, 0]);
  });

  it('does not read hashed session keys as platform:scope:scene', () => {
    expect(parseSessionKey('scene-task:v1:' + 'b'.repeat(64))).toEqual({});
  });

  it('validates the requested time zone and defaults to the instance zone', () => {
    expect(resolveUsageStatsQuery({}, NOON, 'Asia/Shanghai').timeZone).toBe('Asia/Shanghai');
    expect(resolveUsageStatsQuery({ timeZone: 'UTC' }, NOON, 'Asia/Shanghai').timeZone).toBe('UTC');
    expect(() => resolveUsageStatsQuery({ timeZone: 'Mars/Olympus' }, NOON)).toThrow(PluginConsoleRpcError);
  });

  it('passes the bound provider display into the aggregation', async () => {
    const seen: unknown[] = [];
    const status = new AssistantStatus();
    const svc = new UsageStatsService({
      dir: () => '/x', now: () => NOON, timeZone: () => 'UTC',
      providerResolver: async () => (id: string) => createProviderDisplayIndex(graph).resolveProvider(id),
      build: async (_d, q, options) => { seen.push(q.timeZone, options.resolveProvider?.(ACC)); return { range: q } as never; },
    });
    await svc.stats({});
    expect(seen).toEqual(['UTC', { key: SVC, label: 'AG 中转' }]);
    status.bindProviderDisplay(async () => createProviderDisplayIndex(graph));
  });
});

describe('resolveUsageStatsQuery', () => {
  it('defaults to 7 days ending now, choosing the bucket by range', () => {
    expect(resolveUsageStatsQuery({}, NOON)).toEqual({ since: NOON - 7 * DAY, until: NOON, bucket: 'day' });
    expect(resolveUsageStatsQuery({}, NOON, 'UTC')).toEqual({ since: NOON - 7 * DAY, until: NOON, bucket: 'day', timeZone: 'UTC' });
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
