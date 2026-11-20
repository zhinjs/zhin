import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { AssistantStatus } from '../../../src/instance/console/assistant-status.js';
import {
  USAGE_STATS_MAX_RANGE_MS, USAGE_STATS_PERMISSION, UsageStatsService, previousUsageWindow, resolveUsageStatsQuery,
} from '../../../src/instance/console/usage-stats-rpc.js';
import { createProviderDisplayIndex } from '../../../src/instance/inference/provider-display.js';

const signal = new AbortController().signal;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const DAY = 86_400_000;
const NOON = Date.UTC(2026, 9, 28, 12);
const SVC = 'services:11111111-1111-4111-8111-111111111111';
const ACC = 'accounts:22222222-2222-4222-8222-222222222222';
const graph = {
  rootId: '/p', revision: 1,
  services: { [SVC]: { id: SVC, rootId: '/p', ownerId: 'o', revision: 1, label: 'AG 中转', driver: { id: 'openai-compatible', owner: 'x', contractVersion: '1' }, options: {}, models: {} } },
  accounts: { [ACC]: { id: ACC, rootId: '/p', ownerId: 'o', revision: 1, serviceId: SVC, incarnation: 'i', authentication: { method: 'none' } } },
  profiles: { 'profiles:p1': { id: 'profiles:p1', rootId: '/p', ownerId: 'o', revision: 1, accountId: ACC, model: 'flash', parameters: {}, label: '日常对话' } },
  purposes: { defaults: { chat: 'profiles:p1' } },
} as never;

function traces(lines: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-dims-rpc-'));
  dirs.push(dir);
  for (const [name, rows] of Object.entries(lines)) writeFileSync(join(dir, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

describe('usage-stats compare: previous (#1250 第 58 批)', () => {
  it('resolves the previous window of the same length, each window limited to 31 days on its own', () => {
    expect(resolveUsageStatsQuery({ since: NOON - DAY, until: NOON, compare: 'previous' }, NOON).previous)
      .toEqual({ since: NOON - 2 * DAY, until: NOON - DAY, truncated: false });
    expect(resolveUsageStatsQuery({ since: NOON - DAY, until: NOON }, NOON)).not.toHaveProperty('previous');
    // "Last 30 days": the previous 30 days come back complete (60 days scanned in all).
    expect(resolveUsageStatsQuery({ since: NOON - 30 * DAY, until: NOON, compare: 'previous' }, NOON).previous)
      .toEqual({ since: NOON - 60 * DAY, until: NOON - 30 * DAY, truncated: false });
    // The maximum: 31 + 31 days.
    expect(resolveUsageStatsQuery({ since: NOON - USAGE_STATS_MAX_RANGE_MS, until: NOON, compare: 'previous' }, NOON).previous)
      .toEqual({ since: NOON - 2 * USAGE_STATS_MAX_RANGE_MS, until: NOON - USAGE_STATS_MAX_RANGE_MS, truncated: false });
    // Cut short only by the per-window limit or the epoch; then `truncated`.
    expect(previousUsageWindow(NOON - 10 * DAY, NOON, 5 * DAY)).toEqual({ since: NOON - 15 * DAY, until: NOON - 10 * DAY, truncated: true });
    expect(previousUsageWindow(DAY, 3 * DAY)).toEqual({ since: 0, until: DAY, truncated: true });
    for (const compare of ['next', 1, true]) {
      expect(() => resolveUsageStatsQuery({ compare } as never, NOON), String(compare)).toThrow(PluginConsoleRpcError);
    }
    expect(resolveUsageStatsQuery({ compare: null } as never, NOON)).not.toHaveProperty('previous');
  });

  it('caches compare and plain requests separately', async () => {
    const seen: unknown[] = [];
    const svc = new UsageStatsService({ dir: () => '/x', now: () => NOON, build: async (_d, q) => { seen.push(q.previous); return { range: q } as never; } });
    await svc.stats({ since: NOON - DAY });
    await svc.stats({ since: NOON - DAY, compare: 'previous' });
    await svc.stats({ since: NOON - DAY, compare: 'previous' });
    expect(seen).toEqual([undefined, { since: NOON - 2 * DAY, until: NOON - DAY, truncated: false }]);
  });
});

describe('usage-stats labels through AssistantStatus (#1250 第 58 批)', () => {
  it('stays a control:read query and returns schemaVersion, profile, driver, account, Agent and purpose fields', async () => {
    const status = new AssistantStatus({ now: () => NOON + DAY });
    const method = status.consoleRpc.methods.get('usage-stats')!;
    expect(method).toMatchObject({ readOnly: true, requiredPermissions: [USAGE_STATS_PERMISSION] });
    expect(USAGE_STATS_PERMISSION).toBe('control:read');

    const dir = traces({
      '2026-10-27.jsonl': [{ version: 1, session_key: 's', started_at: NOON - DAY, model_calls: [{ provider: ACC, model: 'flash', prompt_tokens: 4, completion_tokens: 1 }] }],
      '2026-10-28.jsonl': [{
        version: 1, session_key: 'personal-session:v1:' + 'd'.repeat(64), started_at: NOON,
        origin: { kind: 'im', platform: 'qq', endpoint: 'ep-1', scope: 'group', sceneId: '42' },
        model_selection: { purpose: 'chat', profile_id: 'profiles:p1', account_id: ACC, model: 'flash' },
        model_calls: [{ provider: ACC, model: 'flash', prompt_tokens: 10, completion_tokens: 2, cache_read_tokens: 5 }],
        user_text: 'secret prompt text',
      }],
    });
    status.bindUsageTraces(() => dir);
    status.bindProviderDisplay(async () => createProviderDisplayIndex(graph, { driverLabel: id => (id === 'openai-compatible' ? 'OpenAI 兼容' : undefined) }));
    status.bindUsageEndpoints(() => [{ id: 'ep-1', name: '客服号', adapter: 'qq' }]);

    const out = (await method.handler({ since: NOON - DAY / 2, until: NOON + DAY / 2, compare: 'previous', timeZone: 'UTC' } as never, { signal })) as Record<string, any>;
    expect(out.schemaVersion).toBe(2);
    expect(out.byModel[0]).toMatchObject({ displayName: 'AG 中转 · flash', driverLabel: 'OpenAI 兼容', profileId: 'profiles:p1', profileName: '日常对话' });
    expect(out.bySession[0]).toMatchObject({ endpoint: 'ep-1', accountLabel: '客服号' });
    expect(out.byAgent).toEqual([expect.objectContaining({ agent: '@main', label: '主助手', calls: 1, inputTokens: 10 })]);
    expect(out.byPurpose).toEqual([expect.objectContaining({ purpose: 'chat', label: '对话' })]);
    expect(out.previous).toMatchObject({ since: NOON - 3 * DAY / 2, until: NOON - DAY / 2, truncated: false, totals: { calls: 1, inputTokens: 4 } });
    expect(out.previous).not.toHaveProperty('byModel');
    // Never message text.
    expect(JSON.stringify(out)).not.toContain('secret prompt text');
  });

  it('returns the whole previous 30 days for "last 30 days", filtered by the same session', async () => {
    const status = new AssistantStatus({ now: () => NOON });
    const row = (key: string, at: number, prompt: number) => ({ version: 1, session_key: key, started_at: at, model_calls: [{ provider: 'gemini', model: 'flash', prompt_tokens: prompt, completion_tokens: 1 }] });
    const dir = traces({
      // 59 days back: inside the previous 30 days, outside any 31-day total span.
      '2026-08-30.jsonl': [row('qq:1:group:a', NOON - 59 * DAY, 7), row('qq:1:group:b', NOON - 59 * DAY, 500)],
      '2026-10-27.jsonl': [row('qq:1:group:a', NOON - DAY, 3)],
    });
    status.bindUsageTraces(() => dir);
    const out = (await status.consoleRpc.methods.get('usage-stats')!.handler({ since: NOON - 30 * DAY, until: NOON, compare: 'previous', session: 'group:a', timeZone: 'UTC' } as never, { signal })) as Record<string, any>;
    expect(out.totals).toMatchObject({ calls: 1, inputTokens: 3 });
    expect(out.previous).toMatchObject({ since: NOON - 60 * DAY, until: NOON - 30 * DAY, truncated: false, totals: { turns: 1, calls: 1, inputTokens: 7 } });
  });

  it('matches accounts by the platform traces record and never mixes same-named accounts across platforms', async () => {
    const status = new AssistantStatus({ now: () => NOON + DAY });
    const im = (key: string, platform: string, endpoint: string) => ({ version: 1, session_key: key, started_at: NOON, origin: { kind: 'im', platform, endpoint, scope: 'group', sceneId: '1' }, model_calls: [{ provider: 'gemini', model: 'flash', prompt_tokens: 3, completion_tokens: 1 }] });
    const dir = traces({ '2026-10-28.jsonl': [
      im('a', 'qq', 'ep-1'), im('b', 'discord', 'bot'), im('c', 'qq', 'x1'), im('d', 'telegram', 'ep-9'), im('e', 'qq', '10001'),
    ] });
    status.bindUsageTraces(() => dir);
    status.bindUsageEndpoints(() => [
      // `adapter` is the client adapter (what traces record), e.g. `qq` for the `icqq` package's accounts.
      { id: 'ep-1', name: '旧号', adapter: 'icqq' },
      { id: 'ep-1', name: '客服号', adapter: 'qq' },
      { id: 'x1', name: 'bot', adapter: 'qq' },
      { id: 'x2', name: 'bot', adapter: 'kook' },
      { id: 'ep-9', name: '唯一号', adapter: 'tg' },
      { id: '10001', name: '10001', adapter: 'qq' },
    ]);
    const out = (await status.consoleRpc.methods.get('usage-stats')!.handler({ since: NOON - DAY, until: NOON + DAY } as never, { signal })) as Record<string, any>;
    const row = (key: string) => out.bySession.find((r: { sessionKey: string }) => r.sessionKey === key);
    expect(row('a')).toMatchObject({ accountLabel: '客服号' });
    // `bot` exists on two other platforms: ambiguous, no label.
    expect(row('b')).not.toHaveProperty('accountLabel');
    expect(row('c')).toMatchObject({ accountLabel: 'bot' });
    // A different platform name, but the id is unique among all accounts.
    expect(row('d')).toMatchObject({ accountLabel: '唯一号' });
    // A name that is just the raw id adds nothing.
    expect(row('e')).toMatchObject({ endpoint: '10001' });
    expect(row('e')).not.toHaveProperty('accountLabel');
  });

  it('names schedule sessions after the job label when the instance knows it (#1250 b63)', async () => {
    const status = new AssistantStatus({ now: () => NOON + DAY });
    const job = (key: string, jobId: string) => ({ version: 1, session_key: key, started_at: NOON, origin: { kind: 'schedule', jobId }, model_calls: [{ provider: 'gemini', model: 'flash', prompt_tokens: 3, completion_tokens: 1 }] });
    const dir = traces({ '2026-10-28.jsonl': [job('schedule:sched_1', 'sched_1'), job('schedule:sched_gone', 'sched_gone')] });
    status.bindUsageTraces(() => dir);
    status.bindUsageScheduleJobs(async () => new Map([['sched_1', '每日早报']]));
    const out = (await status.consoleRpc.methods.get('usage-stats')!.handler({ since: NOON - DAY, until: NOON + DAY } as never, { signal })) as Record<string, any>;
    const row = (key: string) => out.bySession.find((r: { sessionKey: string }) => r.sessionKey === key);
    expect(row('schedule:sched_1')).toMatchObject({ scopeKind: 'schedule', sceneLabel: '每日早报', displayName: '定时任务 每日早报' });
    // A deleted job keeps its id.
    expect(row('schedule:sched_gone')).toMatchObject({ scopeKind: 'schedule', sceneLabel: 'sched_gone', displayName: '定时任务 sched_gone' });
  });

  it('never shows a raw service id as the service label', () => {
    const bare = createProviderDisplayIndex({ ...(graph as object), services: { [SVC]: { ...(graph as any).services[SVC], label: undefined, driver: undefined } } } as never);
    expect(bare.resolveProvider(ACC)).toEqual({ key: SVC });
    expect(bare.profile('profiles:p1')).toMatchObject({ key: SVC, model: 'flash', displayName: 'flash' });
    expect(bare.profile('profiles:p1')).not.toHaveProperty('label');
  });

  it('falls back to the Driver id and drops a throwing account source', async () => {
    const index = createProviderDisplayIndex(graph, { driverLabel: () => { throw new Error('x'); } });
    expect(index.resolveProvider(ACC)).toEqual({ key: SVC, label: 'AG 中转', driverId: 'openai-compatible', driverLabel: 'openai-compatible' });
    const status = new AssistantStatus({ now: () => NOON + DAY });
    const dir = traces({ '2026-10-28.jsonl': [{ version: 1, session_key: 'k', started_at: NOON, origin: { kind: 'im', platform: 'qq', endpoint: 'ep-1', scope: 'group', sceneId: '1' }, model_calls: [{ provider: 'gemini', model: 'flash', prompt_tokens: 3, completion_tokens: 1 }] }] });
    status.bindUsageTraces(() => dir);
    status.bindUsageEndpoints(() => { throw new Error('not ready'); });
    const out = (await status.consoleRpc.methods.get('usage-stats')!.handler({ since: NOON - DAY, until: NOON + DAY } as never, { signal })) as Record<string, any>;
    expect(out.bySession[0]).not.toHaveProperty('accountLabel');
    expect(out.byAgent[0]).toMatchObject({ agent: '@unrecorded', kind: 'unrecorded' });
  });
});
