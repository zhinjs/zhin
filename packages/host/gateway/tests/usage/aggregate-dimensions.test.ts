import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  USAGE_MAIN_AGENT_KEY, USAGE_STATS_SCHEMA_VERSION, USAGE_STATS_SESSION_LIMIT, USAGE_UNRECORDED_KEY,
  buildUsageStats, sessionDisplayNameOf, sessionPartsOf, usagePurposeLabel,
} from '../../src/usage/aggregate.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const NOON = Date.UTC(2026, 9, 28, 12);
const DAY = 86_400_000;
const range = { since: NOON - DAY, until: NOON + DAY, bucket: 'day' as const, timeZone: 'UTC' };
const call = (provider: string, model: string, prompt: number, extra: Record<string, number> = {}) => ({
  provider, model, prompt_tokens: prompt, completion_tokens: 2, cache_read_tokens: 0, ...extra,
});
function fixture(lines: readonly unknown[], name = '2026-10-28.jsonl'): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-dims-'));
  dirs.push(dir);
  writeFileSync(join(dir, name), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  return dir;
}

const SVC_A = 'services:aaaaaaaa-0000-4000-8000-000000000001';
const SVC_B = 'services:bbbbbbbb-0000-4000-8000-000000000002';
const ACC_A = 'accounts:a1';
const ACC_B = 'accounts:b1';
const services: Record<string, { key: string; label: string; driverLabel?: string }> = {
  [SVC_A]: { key: SVC_A, label: 'OpenAI', driverLabel: 'OpenAI 官方' },
  [ACC_A]: { key: SVC_A, label: 'OpenAI', driverLabel: 'OpenAI 官方' },
  [SVC_B]: { key: SVC_B, label: 'OpenAI', driverLabel: 'OpenAI 兼容' },
  [ACC_B]: { key: SVC_B, label: 'OpenAI', driverLabel: 'OpenAI 兼容' },
};
const profiles: Record<string, { label?: string }> = { 'profiles:fast': { label: '快速' }, 'profiles:relay': {} };
const options = {
  resolveProvider: (id: string) => services[id],
  resolveProfile: (id: string) => profiles[id],
  resolveAccount: (platform: string, endpoint: string) => (platform === 'qq' && endpoint === 'ep-1' ? '客服号' : undefined),
};

describe('usage stats dimensions (#1250 第 58 批)', () => {
  it('labels same-named services by driver and profile, and splits calls by Agent and purpose', async () => {
    const dir = fixture([{
      version: 1, session_key: 'personal-session:v1:' + 'c'.repeat(64), started_at: NOON,
      origin: { kind: 'im', platform: 'qq', endpoint: 'ep-1', scope: 'group', sceneId: '42' },
      model_selection: { purpose: 'chat', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' },
      model_calls: [call(ACC_A, 'gpt-x', 1000, { cache_read_tokens: 400, cache_write_tokens: 30 }), call(SVC_A, 'gpt-x', 500)],
      subagents: [{
        session_key: 'x#actor:draw', started_at: NOON,
        model_selection: { purpose: 'agent:draw', profile_id: 'profiles:relay', account_id: ACC_B, model: 'gpt-x', agent: 'draw' },
        model_calls: [call(ACC_B, 'gpt-x', 300)],
        subagents: [{ session_key: 'x#actor:old', started_at: NOON, model_calls: [call('gemini', 'flash', 7)], subagents: [] }],
      }],
    }]);
    const s = await buildUsageStats(dir, range, options);
    expect(s.schemaVersion).toBe(USAGE_STATS_SCHEMA_VERSION);
    expect(s.schemaVersion).toBe(2);

    const a = s.byModel.find(m => m.provider === SVC_A)!;
    const b = s.byModel.find(m => m.provider === SVC_B)!;
    expect(a).toMatchObject({ displayName: 'OpenAI · gpt-x', driverLabel: 'OpenAI 官方', profileId: 'profiles:fast', profileName: '快速', calls: 2, inputTokens: 1500 });
    expect(b).toMatchObject({ displayName: 'OpenAI · gpt-x', driverLabel: 'OpenAI 兼容', profileId: 'profiles:relay', calls: 1 });
    expect(b).not.toHaveProperty('profileName');
    expect(s.byModel.find(m => m.model === 'flash')).not.toHaveProperty('profileId');

    expect(s.byAgent).toEqual([
      expect.objectContaining({ agent: USAGE_MAIN_AGENT_KEY, label: '主助手', kind: 'main', turns: 1, calls: 2, inputTokens: 1500, outputTokens: 4, cacheReadTokens: 400, cacheWriteTokens: 30 }),
      expect.objectContaining({ agent: 'draw', label: 'draw', kind: 'agent', turns: 1, calls: 1, inputTokens: 300 }),
      expect.objectContaining({ agent: USAGE_UNRECORDED_KEY, label: '未记录', kind: 'unrecorded', turns: 1, calls: 1, inputTokens: 7 }),
    ]);
    expect(s.byPurpose!.map(p => [p.purpose, p.label, p.calls, p.inputTokens])).toEqual([
      ['chat', '对话', 2, 1500], ['agent', '子 Agent', 1, 300], [USAGE_UNRECORDED_KEY, '未记录', 1, 7],
    ]);
    // Agent and purpose rows add up to the totals.
    expect(s.byAgent!.reduce((n, r) => n + r.inputTokens, 0)).toBe(s.totals.inputTokens);
    expect(s.byPurpose!.reduce((n, r) => n + r.calls, 0)).toBe(s.totals.calls);

    expect(s.bySession[0]).toMatchObject({ endpoint: 'ep-1', accountLabel: '客服号' });
    expect(s.sessionsTotal).toBe(1);
    expect(s.othersTotals).toMatchObject({ sessions: 0, turns: 0, calls: 0, inputTokens: 0 });
    expect(s).not.toHaveProperty('previous');
  });

  it('attributes a fallback call to the profile switched to, and leaves mixed rows without a profile', async () => {
    const dir = fixture([
      {
        version: 1, session_key: 's1', started_at: NOON,
        model_selection: { purpose: 'summary', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' },
        model_fallbacks: [{ purpose: 'summary', from_profile_id: 'profiles:fast', from_account_id: ACC_A, from_model: 'gpt-x', to_profile_id: 'profiles:relay', to_account_id: ACC_B, to_model: 'gpt-y', reason: 'server', phase: 'request' }],
        model_calls: [call(ACC_B, 'gpt-y', 10)],
      },
      { version: 1, session_key: 's2', started_at: NOON, model_selection: { purpose: 'chat', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' }, model_calls: [call(ACC_A, 'gpt-x', 5)] },
      { version: 1, session_key: 's3', started_at: NOON, model_selection: { purpose: 'chat', profile_id: 'profiles:other', account_id: ACC_A, model: 'gpt-x' }, model_calls: [call(ACC_A, 'gpt-x', 5)] },
    ]);
    const s = await buildUsageStats(dir, range, options);
    expect(s.byModel.find(m => m.model === 'gpt-y')).toMatchObject({ profileId: 'profiles:relay' });
    const mixed = s.byModel.find(m => m.model === 'gpt-x')!;
    expect(mixed).not.toHaveProperty('profileId');
    expect(mixed).not.toHaveProperty('profileName');
    expect(s.byPurpose!.find(p => p.purpose === 'summary')).toMatchObject({ label: '摘要', calls: 1, turns: 1 });
  });

  it('degrades on old traces: everything unrecorded, no driver / profile / account labels', async () => {
    const dir = fixture([{ version: 1, session_key: 'icqq:1:group:42', started_at: NOON, model_calls: [call('gemini', 'flash', 9)] }]);
    const s = await buildUsageStats(dir, range);
    expect(s.byAgent).toEqual([expect.objectContaining({ agent: USAGE_UNRECORDED_KEY, kind: 'unrecorded', calls: 1, inputTokens: 9, turns: 1 })]);
    expect(s.byPurpose).toEqual([expect.objectContaining({ purpose: USAGE_UNRECORDED_KEY, label: '未记录', calls: 1 })]);
    expect(s.byModel[0]).not.toHaveProperty('driverLabel');
    expect(s.byModel[0]).not.toHaveProperty('profileId');
    expect(s.bySession[0]).not.toHaveProperty('accountLabel');
    expect(s.bySession[0]).not.toHaveProperty('endpoint');
    // A throwing resolver degrades the same way instead of failing the request.
    const throwing = await buildUsageStats(dir, range, { resolveProfile: () => { throw new Error('x'); }, resolveAccount: () => { throw new Error('y'); } });
    expect(throwing.byAgent).toHaveLength(1);
  });

  it('sums sessions beyond the top list into othersTotals', async () => {
    const lines = Array.from({ length: USAGE_STATS_SESSION_LIMIT + 3 }, (_, i) => ({
      version: 1, session_key: `qq:1:group:${i}`, started_at: NOON, model_calls: [call('gemini', 'flash', 1000 - i)],
    }));
    const s = await buildUsageStats(fixture(lines), range);
    expect(s.bySession).toHaveLength(USAGE_STATS_SESSION_LIMIT);
    expect(s.sessionsTotal).toBe(USAGE_STATS_SESSION_LIMIT + 3);
    const shown = s.bySession.reduce((n, r) => n + r.inputTokens, 0);
    expect(s.othersTotals).toMatchObject({ sessions: 3, turns: 3, calls: 3 });
    expect(shown + s.othersTotals!.inputTokens).toBe(s.totals.inputTokens);
    expect(s.othersTotals!.inputTokens).toBe((1000 - 50) + (1000 - 51) + (1000 - 52));
  });

  it('adds previous-window totals only when asked, without details', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-prev-'));
    dirs.push(dir);
    writeFileSync(join(dir, '2026-10-27.jsonl'), JSON.stringify({ version: 1, session_key: 'a', started_at: NOON - DAY - 1000, model_calls: [call('gemini', 'flash', 40)] }) + '\n');
    writeFileSync(join(dir, '2026-10-28.jsonl'), JSON.stringify({ version: 1, session_key: 'a', started_at: NOON, model_calls: [call('gemini', 'flash', 10)] }) + '\n');
    const s = await buildUsageStats(dir, { ...range, previous: { since: NOON - 3 * DAY, until: NOON - DAY } });
    expect(s.totals.inputTokens).toBe(10);
    expect(s.previous).toEqual({ since: NOON - 3 * DAY, until: NOON - DAY, truncated: false, totals: expect.objectContaining({ turns: 1, calls: 1, inputTokens: 40, inputBasis: 'reported-all-calls' }) });
    expect(Object.keys(s.previous!)).toEqual(['since', 'until', 'truncated', 'totals']);
    const empty = await buildUsageStats(dir, { ...range, previous: { since: NOON - DAY, until: NOON - DAY, truncated: true } });
    expect(empty.previous).toMatchObject({ truncated: true, totals: { turns: 0, calls: 0, inputTokens: 0 } });
  });

  it('gives each session structured scope / scene / short key next to the unchanged displayName', async () => {
    const hashed = 'personal-session:v1:' + 'e'.repeat(64);
    const other = 'personal-session:v1:' + 'f'.repeat(64);
    const im = (key: string, extra: Record<string, unknown>) => ({ version: 1, session_key: key, started_at: NOON, model_calls: [call('gemini', 'flash', 5)], ...extra });
    const dir = fixture([
      im(hashed, { origin: { kind: 'im', platform: 'qq', endpoint: 'ep', scope: 'group', sceneId: '42', conversation: { name: '测试群' } } }),
      im(other, { origin: { kind: 'im', platform: 'qq', endpoint: 'ep', scope: 'group', sceneId: '43', conversation: { name: '测试群' } } }),
      im('dm', { origin: { kind: 'im', platform: 'qq', endpoint: 'ep', scope: 'direct', sceneId: 'u1' }, principal: { display_name: 'Alice' } }),
      im('job', { origin: { kind: 'schedule', jobId: 'daily' } }),
      im('int', { origin: { kind: 'internal', source: 'heartbeat' } }),
      im('web', { origin: { kind: 'http', sessionId: 'h' } }),
      im('old', {}),
    ]);
    const s = await buildUsageStats(dir, range);
    const row = (key: string) => s.bySession.find(r => r.sessionKey === key)!;
    expect(row(hashed)).toMatchObject({ displayName: 'qq · 群 测试群', scopeKind: 'group', sceneLabel: '测试群', shortKey: 'personal-session:eeeeeeee' });
    expect(row(other)).toMatchObject({ displayName: 'qq · 群 测试群', shortKey: 'personal-session:ffffffff' });
    expect(row('dm')).toMatchObject({ displayName: 'qq · 私聊 Alice', scopeKind: 'private', sceneLabel: 'Alice', shortKey: 'dm' });
    expect(row('job')).toMatchObject({ displayName: '定时任务 daily', scopeKind: 'schedule', sceneLabel: 'daily' });
    expect(row('int')).toMatchObject({ displayName: '内部 heartbeat', scopeKind: 'internal', sceneLabel: 'heartbeat' });
    expect(row('web')).toMatchObject({ displayName: 'HTTP', scopeKind: 'http' });
    expect(row('web')).not.toHaveProperty('sceneLabel');
    expect(row('old')).toMatchObject({ shortKey: 'old' });
    expect(row('old')).not.toHaveProperty('scopeKind');
    expect(row('old')).not.toHaveProperty('displayName');
    // The helpers agree with each other for every origin kind.
    for (const kind of ['a2a', 'mcp']) {
      const trace = { origin: { kind } };
      expect(sessionPartsOf(trace)).toEqual({ scopeKind: kind });
      expect(sessionDisplayNameOf(trace)).toBe(kind.toUpperCase());
    }
    expect(sessionPartsOf({ origin: { kind: 'im', scope: 'guild', conversation: { id: 'c9' } } })).toEqual({ scopeKind: 'channel', sceneLabel: 'c9' });
  });

  it('labels known purposes and passes unknown ones through', () => {
    expect(usagePurposeLabel('perception')).toBe('媒体理解');
    expect(usagePurposeLabel('ambient-judge')).toBe('插话判断');
    expect(usagePurposeLabel('custom-x')).toBe('custom-x');
  });
});

describe('usage stats review fixes (#1250 第 58 批)', () => {
  const sum = <T,>(rows: readonly T[], pick: (row: T) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const TOKEN_KEYS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;

  it('keeps totals = Σ byModel = Σ byAgent = Σ byPurpose = Σ series, nested sub-agents included', async () => {
    const dir = fixture([
      {
        version: 1, session_key: 'qq:ep:group:1', started_at: NOON,
        model_selection: { purpose: 'chat', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' },
        model_calls: [call(ACC_A, 'gpt-x', 100, { cache_read_tokens: 40, cache_write_tokens: 3 }), call(ACC_A, 'gpt-x', 120, { completion_tokens: 9 })],
        subagents: [{
          session_key: 'x#actor:draw', started_at: NOON,
          model_selection: { purpose: 'agent:draw', agent: 'draw', profile_id: 'profiles:relay', account_id: ACC_B, model: 'gpt-y' },
          model_calls: [call(ACC_B, 'gpt-y', 50, { cache_read_tokens: 5 })],
          subagents: [{
            session_key: 'x#actor:sum', started_at: NOON,
            model_selection: { purpose: 'summary', agent: 'sum', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' },
            model_calls: [call(ACC_A, 'gpt-x', 30, { cache_write_tokens: 7 })],
            subagents: [{ session_key: 'x#actor:old', started_at: NOON, model_calls: [call('gemini', 'flash', 8)] }],
          }],
        }],
      },
      { version: 1, session_key: 'qq:ep:group:2', started_at: NOON - DAY / 2, model_calls: [call('gemini', 'flash', 11, { cache_read_tokens: 2 })] },
    ]);
    const s = await buildUsageStats(dir, range, options);
    for (const key of TOKEN_KEYS) {
      expect(sum(s.byModel, r => r[key]), `byModel ${key}`).toBe(s.totals[key]);
      expect(sum(s.byAgent!, r => r[key]), `byAgent ${key}`).toBe(s.totals[key]);
      expect(sum(s.byPurpose!, r => r[key]), `byPurpose ${key}`).toBe(s.totals[key]);
      expect(sum(s.series, r => r[key]), `series ${key}`).toBe(s.totals[key]);
      expect(sum(s.bySession, r => r[key]), `bySession ${key}`).toBe(s.totals[key]);
    }
    expect(s.totals).toMatchObject({ turns: 2, calls: 6, inputTokens: 319 });
    expect(sum(s.series, r => sum(Object.values(r.byModel), v => v))).toBe(s.totals.inputTokens);
    // (Sub-)turns: 2 root turns + 3 nested nodes.
    expect(sum(s.byAgent!, r => r.turns)).toBe(5);
    expect(sum(s.byPurpose!, r => r.turns)).toBe(5);
    expect(sum(s.byAgent!, r => r.turns)).toBeGreaterThan(s.totals.turns);
    expect(s.byPurpose!.find(p => p.purpose === 'summary')).toMatchObject({ calls: 1, inputTokens: 30, turns: 1 });
    expect(s.byAgent!.find(a => a.agent === 'sum')).toMatchObject({ kind: 'agent', calls: 1, inputTokens: 30 });
  });

  it('gives hashed session keys the platform of the recorded IM origin', async () => {
    const hashed = 'personal-session:v1:' + 'a'.repeat(64);
    const task = 'scene-task:v1:' + 'b'.repeat(64);
    const dir = fixture([
      { version: 1, session_key: hashed, started_at: NOON, origin: { kind: 'im', platform: 'qq', endpoint: 'ep-1', scope: 'group', sceneId: '42' }, model_calls: [call('gemini', 'flash', 5)] },
      { version: 1, session_key: task, started_at: NOON, origin: { kind: 'im', platform: 'kook', endpoint: 'ep-2', scope: 'channel', sceneId: '7' }, model_calls: [call('gemini', 'flash', 4)] },
      { version: 1, session_key: 'personal-session:v1:' + 'c'.repeat(64), started_at: NOON, origin: { kind: 'http' }, model_calls: [call('gemini', 'flash', 3)] },
      { version: 1, session_key: 'icqq:1:group:42', started_at: NOON, origin: { kind: 'im', platform: 'other', endpoint: '1', scope: 'group', sceneId: '42' }, model_calls: [call('gemini', 'flash', 2)] },
    ]);
    const s = await buildUsageStats(dir, range, options);
    const row = (key: string) => s.bySession.find(r => r.sessionKey === key)!;
    expect(row(hashed)).toMatchObject({ platform: 'qq', endpoint: 'ep-1', accountLabel: '客服号' });
    expect(row(task)).toMatchObject({ platform: 'kook', endpoint: 'ep-2' });
    expect(row('personal-session:v1:' + 'c'.repeat(64))).not.toHaveProperty('platform');
    // An addressable key keeps its own platform.
    expect(row('icqq:1:group:42')).toMatchObject({ platform: 'icqq', scope: 'group', sceneId: '42' });
  });

  it('omits an account label that is just the raw endpoint id', async () => {
    const dir = fixture([{ version: 1, session_key: 'k', started_at: NOON, origin: { kind: 'im', platform: 'qq', endpoint: '10001', scope: 'group', sceneId: '1' }, model_calls: [call('gemini', 'flash', 1)] }]);
    const s = await buildUsageStats(dir, range, { resolveAccount: (_platform, endpoint) => endpoint });
    expect(s.bySession[0]).toMatchObject({ endpoint: '10001' });
    expect(s.bySession[0]).not.toHaveProperty('accountLabel');
  });

  it('filters the previous window by the same session pattern', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-prev-session-'));
    dirs.push(dir);
    writeFileSync(join(dir, '2026-10-27.jsonl'), [
      { version: 1, session_key: 'qq:1:group:a', started_at: NOON - DAY - 1000, model_calls: [call('gemini', 'flash', 40)] },
      { version: 1, session_key: 'qq:1:group:b', started_at: NOON - DAY - 1000, model_calls: [call('gemini', 'flash', 900)] },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');
    writeFileSync(join(dir, '2026-10-28.jsonl'), JSON.stringify({ version: 1, session_key: 'qq:1:group:a', started_at: NOON, model_calls: [call('gemini', 'flash', 10)] }) + '\n');
    const s = await buildUsageStats(dir, { ...range, session: 'group:a', previous: { since: NOON - 3 * DAY, until: NOON - DAY } });
    expect(s.totals.inputTokens).toBe(10);
    expect(s.previous!.totals).toMatchObject({ turns: 1, calls: 1, inputTokens: 40 });
  });

  it('attributes calls after a fallback on the same account and model to the profile switched to', async () => {
    const dir = fixture([{
      version: 1, session_key: 's', started_at: NOON,
      model_selection: { purpose: 'chat', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' },
      model_fallbacks: [{ purpose: 'chat', from_profile_id: 'profiles:fast', from_account_id: ACC_A, from_model: 'gpt-x', to_profile_id: 'profiles:relay', to_account_id: ACC_A, to_model: 'gpt-x', reason: 'server', phase: 'request' }],
      model_calls: [call(ACC_A, 'gpt-x', 10)],
    }]);
    const s = await buildUsageStats(dir, range, options);
    expect(s.byModel).toEqual([expect.objectContaining({ model: 'gpt-x', profileId: 'profiles:relay' })]);
    expect(s.byModel[0]).not.toHaveProperty('profileName');
  });

  it('names no profile when any call of the row cannot be attributed', async () => {
    const dir = fixture([
      { version: 1, session_key: 's1', started_at: NOON, model_selection: { purpose: 'chat', profile_id: 'profiles:fast', account_id: ACC_A, model: 'gpt-x' }, model_calls: [call(ACC_A, 'gpt-x', 10)] },
      { version: 1, session_key: 's2', started_at: NOON, model_calls: [call(ACC_A, 'gpt-x', 10)] },
    ]);
    const s = await buildUsageStats(dir, range, options);
    expect(s.byModel).toHaveLength(1);
    expect(s.byModel[0]).not.toHaveProperty('profileId');
    expect(s.byModel[0]).not.toHaveProperty('profileName');
  });

  it('takes displayName and its parts from the first trace with an origin, and keeps them after origin-less traces', async () => {
    const t = (startedAt: number, extra: Record<string, unknown>) => ({ version: 1, session_key: 'sess', started_at: startedAt, model_calls: [call('gemini', 'flash', 1)], ...extra });
    const dir = fixture([
      t(NOON - 3000, {}),
      t(NOON - 2000, { origin: { kind: 'im', platform: 'qq', endpoint: 'ep', scope: 'group', sceneId: '42', conversation: { name: '旧群名' } } }),
      t(NOON - 1000, {}),
      t(NOON, { origin: { kind: 'im', platform: 'qq', endpoint: 'ep', scope: 'group', sceneId: '42', conversation: { name: '新群名' } } }),
    ]);
    const s = await buildUsageStats(dir, range);
    expect(s.bySession[0]).toMatchObject({ displayName: 'qq · 群 旧群名', scopeKind: 'group', sceneLabel: '旧群名', turns: 4 });
  });
});
