/**
 * `zhin usage report` — read-only ledger of real model usage per day, built
 * from the Agent turn trace archive (`data/agent-traces/*.jsonl`, ADR 0043 §6).
 * Streams files line by line, never writes anything, and only reads token
 * counts, session keys and termination markers.
 */
import { join } from 'node:path';
import { Command } from 'commander';
import {
  FIXED_SEGMENTS, dayKeyOf, defaultUsageTimeZone, isOpaqueProviderId, isUsageTimeZone, num, scanTraces,
  sessionDisplayNameOf, usageModelDisplayName, type UsageProviderResolver,
} from '@zhin.js/gateway/usage';
import { parseTraceTime } from './trace.js';
import { importProjectInstanceCli } from '../utils/project-instance.js';

export interface UsageReportOptions {
  readonly since?: number;
  readonly until?: number;
  /** Substring, or `*` glob, matched against the session key. */
  readonly session?: string;
  /** IANA zone for day boundaries; defaults to the instance zone (`TZ`, else the system zone). */
  readonly timeZone?: string;
  /** Maps recorded provider ids to their service, so one model is one row (`服务名 · 模型`). */
  readonly resolveProvider?: UsageProviderResolver;
}

export interface ModelUsage {
  /** `服务名 · 模型`; just the model when the service cannot be resolved. */
  readonly display_name: string;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface Distribution {
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
}

export interface SessionUsage {
  readonly session_key: string;
  /** Readable conversation label from the trace origin, when recorded (session keys are hashes). */
  readonly display_name?: string;
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
  readonly models: readonly ModelUsage[];
}

export interface UsageReport {
  readonly time_zone: string;
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


interface DayAcc {
  turns: number;
  callsPerTurn: number[];
  inputs: number[];
  input: number;
  cache: number;
  segments: { history: number; fixed: number; user: number; other: number };
  budgetTurns: number;
  limitTurns: number;
  sessions: Map<string, { turns: number; calls: number; input: number; name?: string }>;
  models: Map<string, { name: string; calls: number; input: number; output: number }>;
}

/** Aggregates every `*.jsonl` file under `dir`. A missing dir yields an empty report. */
export async function buildUsageReport(dir: string, options: UsageReportOptions = {}): Promise<UsageReport> {
  const days = new Map<string, DayAcc>();
  const timeZone = options.timeZone && isUsageTimeZone(options.timeZone) ? options.timeZone : defaultUsageTimeZone();
  const resolved = new Map<string, ReturnType<UsageProviderResolver>>();
  const serviceOf = (provider: string) => {
    if (!options.resolveProvider) return undefined;
    if (!resolved.has(provider)) {
      try { resolved.set(provider, options.resolveProvider(provider)); } catch { resolved.set(provider, undefined); }
    }
    return resolved.get(provider);
  };

  const scan = await scanTraces(dir, options, (trace, startedAt) => {
    const day = dayKeyOf(startedAt, timeZone);
    let acc = days.get(day);
    if (!acc) {
      acc = { turns: 0, callsPerTurn: [], inputs: [], input: 0, cache: 0, segments: { history: 0, fixed: 0, user: 0, other: 0 }, budgetTurns: 0, limitTurns: 0, sessions: new Map(), models: new Map() };
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
      const provider = typeof (call as any)?.provider === 'string' ? (call as any).provider as string : '';
      const model = typeof (call as any)?.model === 'string' && (call as any).model ? (call as any).model as string : 'unknown';
      const service = provider ? serviceOf(provider) : undefined;
      // Same service through `services:` and `accounts:` ids → one row.
      const key = service ? `${service.key}\n${model}` : !provider || isOpaqueProviderId(provider) ? `\n${model}` : `${provider}\n${model}`;
      const row = acc.models.get(key) ?? { name: usageModelDisplayName(provider, model, service?.label), calls: 0, input: 0, output: 0 };
      row.calls++;
      row.input += prompt;
      row.output += num((call as any)?.completion_tokens) ?? 0;
      acc.models.set(key, row);
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
    session.name ??= sessionDisplayNameOf(trace);
    session.turns++;
    session.calls += turnCalls;
    session.input += turnInput;
    acc.sessions.set(trace.session_key, session);
  });

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
        .map(([session_key, s]) => ({ session_key, ...(s.name ? { display_name: s.name } : {}), turns: s.turns, calls: s.calls, input_tokens: s.input }))
        .sort((a, b) => b.input_tokens - a.input_tokens)
        .slice(0, 5),
      models: [...acc.models.values()]
        .map(m => ({ display_name: m.name, calls: m.calls, input_tokens: m.input, output_tokens: m.output }))
        .sort((a, b) => b.input_tokens - a.input_tokens),
    };
  });
  return { time_zone: timeZone, days: result, files: scan.files, lines: scan.lines, malformed_lines: scan.malformed };
}

/** Hashed session keys stay identifiable without filling the column. */
function shortKey(key: string): string {
  const hashed = /^([a-z-]+):v\d+:([0-9a-f]{16,})$/u.exec(key);
  return hashed ? `${hashed[1]}:${hashed[2]!.slice(0, 8)}` : key;
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
      if (d.models.length) {
        out.push('', `模型（${d.day}，服务 · 模型，按输入 token）`, '', '| 模型 | 调用 | 输入 tokens | 输出 tokens |', '|---|---:|---:|---:|');
        for (const m of d.models) out.push(`| ${m.display_name} | ${m.calls} | ${m.input_tokens} | ${m.output_tokens} |`);
      }
      out.push('', `Top 会话（${d.day}，按输入 token）`, '', '| 会话 | 回合 | 调用 | 输入 tokens |', '|---|---:|---:|---:|');
      for (const s of d.top_sessions) out.push(`| ${s.display_name ? `${s.display_name}（${shortKey(s.session_key)}）` : s.session_key} | ${s.turns} | ${s.calls} | ${s.input_tokens} |`);
    }
    out.push('', `日期按时区 ${report.time_zone} 划分。输入 tokens = 每次模型调用上报的输入之和（含多轮迭代与子 Agent）。`);
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
  readonly tz?: string;
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

/** Service names come from the project's inference graph via its `zhin.js/instance/cli`; optional. */
async function loadProviderResolver(root: string): Promise<UsageProviderResolver | undefined> {
  try {
    const instance = await importProjectInstanceCli(root);
    const display = await instance.loadProviderDisplay?.(root);
    return display ? (id: string) => display.resolveProvider(id) : undefined;
  } catch {
    return undefined;
  }
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
  .option('--tz <zone>', '按此 IANA 时区划分日期（默认实例时区：TZ 环境变量，否则系统时区）')
  .action(async (options: UsageReportCommandOptions) => {
    let window: { since: number | undefined; until: number | undefined };
    try {
      if (options.tz !== undefined && !isUsageTimeZone(options.tz)) throw new Error(`--tz 需要 IANA 时区名（如 Asia/Shanghai）：${options.tz}`);
      window = resolveUsageWindow(options);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
    const root = options.cwd ?? process.cwd();
    const dir = options.dir ?? join(root, 'data', 'agent-traces');
    const resolveProvider = await loadProviderResolver(root);
    const report = await buildUsageReport(dir, {
      ...window, session: options.session, ...(options.tz ? { timeZone: options.tz } : {}), ...(resolveProvider ? { resolveProvider } : {}),
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatUsageReport(report));
  });

export const usageCommand = new Command('usage')
  .description('模型用量账本')
  .addCommand(reportCommand);
