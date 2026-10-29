/**
 * `zhin usage report` — read-only ledger of real model usage per day, built
 * from the Agent turn trace archive (`data/agent-traces/*.jsonl`, ADR 0043 §6).
 * Streams files line by line, never writes anything, and only reads token
 * counts, session keys and termination markers.
 */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { parseTraceTime } from './trace.js';

const DAY_MS = 86_400_000;
const FIXED_SEGMENTS = new Set(['system', 'tool_schemas', 'output_schema', 'tool_index', 'skill_catalog', 'agent_catalog', 'memory', 'bootstrap']);

export interface UsageReportOptions {
  readonly since?: number;
  readonly until?: number;
  /** Substring, or `*` glob, matched against the session key. */
  readonly session?: string;
}

export interface Distribution {
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
}

export interface SessionUsage {
  readonly session_key: string;
  readonly turns: number;
  readonly calls: number;
  readonly input_tokens: number;
}

export interface DayUsage {
  readonly day: string;
  readonly turns: number;
  readonly model_calls: number;
  readonly calls_per_turn: Distribution;
  readonly input_per_call: Distribution;
  readonly input_tokens: number;
  readonly cache_read_tokens: number;
  /** cache_read / input over calls; undefined without input. */
  readonly cache_read_share?: number;
  /** Shares of the first-request estimate summed over turns carrying context_budget. */
  readonly segment_shares?: { readonly history: number; readonly fixed: number; readonly user: number; readonly other: number };
  readonly budget_turns: number;
  readonly iteration_limit_turns: number;
  readonly top_sessions: readonly SessionUsage[];
}

export interface UsageReport {
  readonly days: readonly DayUsage[];
  readonly files: number;
  readonly lines: number;
  readonly malformed_lines: number;
}

/** Nearest-rank percentile over a sorted ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function distribution(values: number[]): Distribution {
  values.sort((a, b) => a - b);
  return { p50: percentile(values, 50), p90: percentile(values, 90), max: values.at(-1) ?? 0 };
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function sessionMatcher(pattern: string | undefined): (key: string) => boolean {
  if (!pattern) return () => true;
  if (!pattern.includes('*')) return key => key.includes(pattern);
  const re = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return key => re.test(key);
}

interface DayAcc {
  turns: number;
  callsPerTurn: number[];
  inputs: number[];
  input: number;
  cache: number;
  segments: { history: number; fixed: number; user: number; other: number };
  budgetTurns: number;
  limitTurns: number;
  sessions: Map<string, { turns: number; calls: number; input: number }>;
}

/** Aggregates every `*.jsonl` file under `dir`. A missing dir yields an empty report. */
export async function buildUsageReport(dir: string, options: UsageReportOptions = {}): Promise<UsageReport> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
  } catch {
    names = [];
  }
  const matches = sessionMatcher(options.session);
  const days = new Map<string, DayAcc>();
  let lines = 0;
  let malformed = 0;

  for (const name of names) {
    // Files are named for their day; skip those clearly outside the window (slack for time zones).
    const stamp = /^(\d{4}-\d{2}-\d{2})/.exec(name);
    if (stamp) {
      const fileStart = Date.parse(`${stamp[1]}T00:00:00Z`);
      if (options.since !== undefined && fileStart + 2 * DAY_MS <= options.since) continue;
      if (options.until !== undefined && fileStart - DAY_MS >= options.until) continue;
    }
    const reader = createInterface({ input: createReadStream(join(dir, name), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of reader) {
      if (line.trim() === '') continue;
      lines++;
      let trace: any;
      try {
        trace = JSON.parse(line);
      } catch {
        malformed++;
        continue;
      }
      const startedAt = num(trace?.started_at);
      if (!trace || typeof trace !== 'object' || startedAt === undefined || typeof trace.session_key !== 'string') {
        malformed++;
        continue;
      }
      if (options.since !== undefined && startedAt < options.since) continue;
      if (options.until !== undefined && startedAt >= options.until) continue;
      if (!matches(trace.session_key)) continue;

      const day = localDay(startedAt);
      let acc = days.get(day);
      if (!acc) {
        acc = { turns: 0, callsPerTurn: [], inputs: [], input: 0, cache: 0, segments: { history: 0, fixed: 0, user: 0, other: 0 }, budgetTurns: 0, limitTurns: 0, sessions: new Map() };
        days.set(day, acc);
      }
      const calls: unknown[] = Array.isArray(trace.model_calls) ? trace.model_calls : [];
      let turnInput = 0;
      let turnCalls = 0;
      for (const call of calls) {
        const prompt = num((call as any)?.prompt_tokens);
        if (prompt === undefined) continue;
        turnCalls++;
        turnInput += prompt;
        acc.inputs.push(prompt);
        acc.cache += num((call as any)?.cache_read_tokens) ?? 0;
      }
      acc.turns++;
      acc.callsPerTurn.push(turnCalls);
      acc.input += turnInput;

      const segments = trace.context_budget?.segments;
      if (segments && typeof segments === 'object') {
        acc.budgetTurns++;
        for (const [key, raw] of Object.entries(segments)) {
          const value = num(raw) ?? 0;
          if (key === 'history') acc.segments.history += value;
          else if (key === 'user') acc.segments.user += value;
          else if (FIXED_SEGMENTS.has(key)) acc.segments.fixed += value;
          else acc.segments.other += value;
        }
      }
      const timeline: unknown[] = Array.isArray(trace.timeline) ? trace.timeline : [];
      if (trace.termination?.status === 'budget_exceeded' || timeline.some(entry => (entry as any)?.kind === 'last_iteration_nudge')) acc.limitTurns++;

      const session = acc.sessions.get(trace.session_key) ?? { turns: 0, calls: 0, input: 0 };
      session.turns++;
      session.calls += turnCalls;
      session.input += turnInput;
      acc.sessions.set(trace.session_key, session);
    }
  }

  const result: DayUsage[] = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, acc]) => {
    const segTotal = acc.segments.history + acc.segments.fixed + acc.segments.user + acc.segments.other;
    return {
      day,
      turns: acc.turns,
      model_calls: acc.inputs.length,
      calls_per_turn: distribution(acc.callsPerTurn),
      input_per_call: distribution(acc.inputs),
      input_tokens: acc.input,
      cache_read_tokens: acc.cache,
      cache_read_share: acc.input > 0 ? acc.cache / acc.input : undefined,
      segment_shares: segTotal > 0
        ? { history: acc.segments.history / segTotal, fixed: acc.segments.fixed / segTotal, user: acc.segments.user / segTotal, other: acc.segments.other / segTotal }
        : undefined,
      budget_turns: acc.budgetTurns,
      iteration_limit_turns: acc.limitTurns,
      top_sessions: [...acc.sessions.entries()]
        .map(([session_key, s]) => ({ session_key, turns: s.turns, calls: s.calls, input_tokens: s.input }))
        .sort((a, b) => b.input_tokens - a.input_tokens)
        .slice(0, 5),
    };
  });
  return { days: result, files: names.length, lines, malformed_lines: malformed };
}

const pct = (value: number | undefined): string => (value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const dist = (d: Distribution): string => `${d.p50} / ${d.p90} / ${d.max}`;

export function formatUsageReport(report: UsageReport): string {
  const out: string[] = [];
  if (report.days.length === 0) {
    out.push('没有符合条件的 trace 记录。');
  } else {
    out.push('| 日期 | 回合 | 模型调用 | 调用/回合 p50/p90/max | 单次输入 p50/p90/max | 缓存命中 | 历史 | 固定 | 用户 | 撞迭代上限 |');
    out.push('|---|---:|---:|---|---|---:|---:|---:|---:|---:|');
    for (const d of report.days) {
      const s = d.segment_shares;
      out.push(`| ${d.day} | ${d.turns} | ${d.model_calls} | ${dist(d.calls_per_turn)} | ${dist(d.input_per_call)} | ${pct(d.cache_read_share)} | ${pct(s?.history)} | ${pct(s?.fixed)} | ${pct(s?.user)} | ${d.iteration_limit_turns} |`);
    }
    for (const d of report.days) {
      out.push('', `Top 会话（${d.day}，按输入 token）`, '', '| 会话 | 回合 | 调用 | 输入 tokens |', '|---|---:|---:|---:|');
      for (const s of d.top_sessions) out.push(`| ${s.session_key} | ${s.turns} | ${s.calls} | ${s.input_tokens} |`);
    }
    out.push('', '历史/固定/用户为各回合首次请求的估算占比（固定 = system + tool_schemas + output_schema + tool_index + skill_catalog + agent_catalog + memory + bootstrap）；其余段不单列。撞迭代上限 = 出现 last_iteration_nudge 或以 budget_exceeded 结束的回合。');
  }
  out.push('', `读取 ${report.files} 个文件、${report.lines} 行${report.malformed_lines > 0 ? `，跳过 ${report.malformed_lines} 行损坏记录` : ''}。`);
  return out.join('\n');
}

interface UsageReportCommandOptions {
  readonly days?: string;
  readonly since?: string;
  readonly until?: string;
  readonly session?: string;
  readonly json?: boolean;
  readonly cwd?: string;
  readonly dir?: string;
}

/** `YYYY-MM-DD` means local midnight; everything else follows `zhin trace`. */
function parseBoundary(value: string | undefined): number | undefined {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [y, m, d] = value.trim().split('-').map(Number);
    return new Date(y!, m! - 1, d!).getTime();
  }
  return parseTraceTime(value);
}

export function resolveUsageWindow(
  options: Pick<UsageReportCommandOptions, 'days' | 'since' | 'until'>,
  now = Date.now(),
): { since: number | undefined; until: number | undefined } {
  const until = parseBoundary(options.until);
  let since = parseBoundary(options.since);
  if (options.since === undefined) {
    const days = Number.parseInt(options.days ?? '1', 10);
    if (!Number.isFinite(days) || days < 1) throw new Error(`--days 需要正整数：${options.days}`);
    const today = new Date(now);
    since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)).getTime();
  }
  return { since, until };
}

const reportCommand = new Command('report')
  .description('按天汇总真实模型用量（读取 data/agent-traces/*.jsonl，只读）')
  .option('--days <n>', '最近 n 天（含今天，按本地日期）', '1')
  .option('--since <time>', '起始：2h、7d、YYYY-MM-DD（本地）、ISO 时间或毫秒时间戳（优先于 --days）')
  .option('--until <time>', '截止（不含），格式同 --since')
  .option('-s, --session <pattern>', '只看匹配的会话（子串，或带 * 的通配）')
  .option('--json', '输出 JSON')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .option('--dir <dir>', 'trace 目录（默认 <cwd>/data/agent-traces）')
  .action(async (options: UsageReportCommandOptions) => {
    let window: { since: number | undefined; until: number | undefined };
    try {
      window = resolveUsageWindow(options);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
    const dir = options.dir ?? join(options.cwd ?? process.cwd(), 'data', 'agent-traces');
    const report = await buildUsageReport(dir, { ...window, session: options.session });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatUsageReport(report));
  });

export const usageCommand = new Command('usage')
  .description('模型用量账本')
  .addCommand(reportCommand);
