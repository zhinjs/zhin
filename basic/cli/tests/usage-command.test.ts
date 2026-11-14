import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildUsageReport, formatUsageReport, resolveUsageWindow, usageCommand } from '../src/commands/usage.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const T = new Date(2026, 9, 28, 12).getTime();
function turn(session: string, calls: Array<[number, number?]>, extra: Record<string, unknown> = {}, at = T) {
  return JSON.stringify({
    version: 1, turn_id: `t${Math.random()}`, session_key: session, started_at: at,
    model_calls: calls.map(([p, c], i) => ({ index: i + 1, prompt_tokens: p, completion_tokens: 1, total_tokens: p + 1, ...(c === undefined ? {} : { cache_read_tokens: c }) })),
    timeline: [], termination: { status: 'completed' }, ...extra,
  });
}
function fixture(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-'));
  dirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), lines.join('\n') + '\n');
  return dir;
}

describe('zhin usage report (ADR 0043 §6)', () => {
  it('aggregates calls, cache, segments and iteration-limit turns per day', async () => {
    const dir = fixture([
      turn('g:1', [[1000, 0], [2000, 1000], [3000, 2000]], { context_budget: { segments: { history: 600, system: 200, bootstrap: 100, user: 100 } } }),
      turn('g:2', [[10000]], {
        context_budget: { segments: { history: 0, system: 100, user: 100, active_skills: 100 } },
        timeline: [{ at_ms: 1, kind: 'last_iteration_nudge', detail: '14/15' }],
      }),
      turn('p:3', [[500, 0]], { termination: { status: 'budget_exceeded' } }),
    ]);
    const report = await buildUsageReport(dir);
    expect(report.malformed_lines).toBe(0);
    const [day] = report.days;
    expect(day!.day).toBe('2026-10-28');
    expect(day!.turns).toBe(3);
    expect(day!.model_calls).toBe(5);
    expect(day!.calls_per_turn).toEqual({ p50: 1, p90: 3, max: 3 });
    expect(day!.input_per_call.max).toBe(10000);
    expect(day!.cache_read_share).toBeCloseTo(3000 / 16500);
    expect(day!.iteration_limit_turns).toBe(2);
    expect(day!.budget_turns).toBe(2);
    expect(day!.segment_shares!.history).toBeCloseTo(600 / 1300);
    expect(day!.segment_shares!.fixed).toBeCloseTo(400 / 1300);
    expect(day!.segment_shares!.other).toBeCloseTo(100 / 1300);
    expect(day!.top_sessions.map(s => s.session_key)).toEqual(['g:2', 'g:1', 'p:3']);
    expect(formatUsageReport(report)).toContain('2026-10-28');
  });

  it('counts malformed lines and tolerates missing fields', async () => {
    const dir = fixture([
      '{not json',
      '"a string"',
      JSON.stringify({ session_key: 'x' }),
      turn('g:1', [[100]], { model_calls: [{ index: 1 }, { prompt_tokens: 'many' }, { prompt_tokens: 100 }], context_budget: undefined, timeline: undefined }),
      '',
    ]);
    const report = await buildUsageReport(dir);
    expect(report.malformed_lines).toBe(3);
    expect(report.days[0]!.model_calls).toBe(1);
    expect(report.days[0]!.segment_shares).toBeUndefined();
    expect(formatUsageReport(report)).toContain('跳过 3 行损坏记录');
  });

  it('filters by time window and session pattern; missing dir is empty', async () => {
    const dir = fixture([
      turn('icqq:1:group:10', [[100]]),
      turn('icqq:1:private:20', [[100]]),
      turn('icqq:1:group:10', [[100]], {}, T + 3 * 86_400_000),
    ]);
    expect((await buildUsageReport(dir, { session: 'group' })).days.map(d => d.turns)).toEqual([1, 1]);
    expect((await buildUsageReport(dir, { session: '*:private:*' })).days[0]!.turns).toBe(1);
    const windowed = await buildUsageReport(dir, { since: new Date(2026, 9, 28).getTime(), until: new Date(2026, 9, 29).getTime() });
    expect(windowed.days.map(d => d.turns)).toEqual([2]);
    const empty = await buildUsageReport(join(dir, 'nope'));
    expect(empty.days).toEqual([]);
    expect(formatUsageReport(empty)).toContain('没有符合条件');
  });

  it('resolves --days and date boundaries in local time', () => {
    const now = new Date(2026, 9, 28, 15).getTime();
    expect(resolveUsageWindow({ days: '1' }, now).since).toBe(new Date(2026, 9, 28).getTime());
    expect(resolveUsageWindow({ days: '3' }, now).since).toBe(new Date(2026, 9, 26).getTime());
    expect(resolveUsageWindow({ since: '2026-10-20', until: '2026-10-21' }, now)).toEqual({ since: new Date(2026, 9, 20).getTime(), until: new Date(2026, 9, 21).getTime() });
    expect(() => resolveUsageWindow({ days: '0' }, now)).toThrow(/--days/);
  });

  it('registers the report subcommand with its options', () => {
    const report = usageCommand.commands.find(c => c.name() === 'report')!;
    expect(report.options.map(o => o.long)).toEqual(expect.arrayContaining(['--days', '--since', '--until', '--session', '--json', '--dir', '--tz']));
  });

  it('shows 服务名 · 模型 rows, readable session names and the day time zone (#1250)', async () => {
    const svc = 'services:11111111-1111-4111-8111-111111111111';
    const acc = 'accounts:22222222-2222-4222-8222-222222222222';
    const hashed = 'personal-session:v1:' + 'c'.repeat(64);
    const dir = fixture([
      turn(hashed, [[100]], {
        model_calls: [
          { index: 1, provider: svc, model: 'ag/gemini-3.8-flash', prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
          { index: 2, provider: acc, model: 'ag/gemini-3.8-flash', prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 },
        ],
        origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: '42', conversation: { name: '测试群' } },
      }),
    ]);
    const resolveProvider = (id: string) => (id === svc || id === acc ? { key: svc, label: 'AG 中转' } : undefined);
    const report = await buildUsageReport(dir, { resolveProvider, timeZone: 'UTC' });
    expect(report.time_zone).toBe('UTC');
    expect(report.days[0]!.models).toEqual([{ display_name: 'AG 中转 · ag/gemini-3.8-flash', calls: 2, input_tokens: 150, output_tokens: 6 }]);
    expect(report.days[0]!.top_sessions[0]).toMatchObject({ session_key: hashed, display_name: 'qq · 群 测试群' });
    const text = formatUsageReport(report);
    expect(text).toContain('| AG 中转 · ag/gemini-3.8-flash | 2 | 150 | 6 |');
    expect(text).toContain('qq · 群 测试群（personal-session:cccccccc）');
    expect(text).toContain('时区 UTC');
    expect(text).not.toContain(svc);
    // Unresolved: the model alone, still one row.
    const bare = await buildUsageReport(dir, { timeZone: 'UTC' });
    expect(bare.days[0]!.models).toEqual([{ display_name: 'ag/gemini-3.8-flash', calls: 2, input_tokens: 150, output_tokens: 6 }]);
    // Day boundaries follow the zone: 20:00Z is the next day in Shanghai.
    const late = fixture([turn('s', [[1]], {}, Date.UTC(2026, 9, 28, 20))]);
    expect((await buildUsageReport(late, { timeZone: 'Asia/Shanghai' })).days[0]!.day).toBe('2026-10-29');
    expect((await buildUsageReport(late, { timeZone: 'UTC' })).days[0]!.day).toBe('2026-10-28');
  });
});
