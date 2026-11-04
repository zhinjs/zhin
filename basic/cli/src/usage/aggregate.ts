/**
 * Shared, read-only reader/aggregator over the Agent turn trace archive
 * (`data/agent-traces/*.jsonl`, ADR 0043 §6). Used by `zhin usage report` and the
 * Console RPC `plugin.root.usage-stats`. Streams files line by line and only
 * looks at token counts, ids, session keys and provider/model names — never
 * message text.
 */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const FIXED_SEGMENTS: ReadonlySet<string> = new Set(['system', 'tool_schemas', 'output_schema', 'tool_index', 'skill_catalog', 'agent_catalog', 'memory', 'bootstrap']);

export interface TraceScanOptions {
  readonly since?: number;
  readonly until?: number;
  /** Substring, or `*` glob, matched against the session key. */
  readonly session?: string;
}

export interface TraceScanResult {
  /** `*.jsonl` files found in the directory. */
  readonly files: number;
  /** Files actually opened (not skipped by their date name). */
  readonly filesRead: number;
  readonly lines: number;
  readonly malformed: number;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function sessionMatcher(pattern: string | undefined): (key: string) => boolean {
  if (!pattern) return () => true;
  if (!pattern.includes('*')) return key => key.includes(pattern);
  const re = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return key => re.test(key);
}

/**
 * Streams every valid trace record in range to `visit`. A missing dir yields an
 * empty scan. A record is valid with a numeric `started_at` and a string `session_key`.
 */
export async function scanTraces(
  dir: string,
  options: TraceScanOptions,
  visit: (trace: any, startedAt: number) => void,
): Promise<TraceScanResult> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
  } catch {
    names = [];
  }
  const matches = sessionMatcher(options.session);
  let filesRead = 0;
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
    filesRead++;
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
      visit(trace, startedAt);
    }
  }
  return { files: names.length, filesRead, lines, malformed };
}

// ---------------------------------------------------------------------------
// Console usage stats (`plugin.root.usage-stats`)
// ---------------------------------------------------------------------------

export type UsageBucket = 'hour' | 'day';

export interface UsageStatsQuery {
  readonly since: number;
  readonly until: number;
  readonly bucket: UsageBucket;
  readonly session?: string;
}

export interface UsageStatsTokens {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** cacheReadTokens / inputTokens, 0..1 (0 without input). */
  readonly cacheShare: number;
}

export interface UsageStats {
  readonly range: { readonly since: number; readonly until: number; readonly bucket: UsageBucket; readonly timeZone: string };
  readonly totals: UsageStatsTokens & { readonly turns: number; readonly cacheShareByCall: { readonly p50: number; readonly p90: number } };
  readonly byModel: ReadonlyArray<UsageStatsTokens & { readonly provider: string; readonly model: string }>;
  readonly bySession: ReadonlyArray<UsageStatsTokens & {
    readonly sessionKey: string;
    readonly platform?: string;
    readonly scope?: string;
    readonly sceneId?: string;
    readonly turns: number;
  }>;
  readonly series: ReadonlyArray<UsageStatsTokens & { readonly bucketStart: number; readonly byModel: Readonly<Record<string, number>> }>;
  readonly segments: { readonly history: number; readonly fixed: number; readonly user: number };
  readonly filesRead: number;
  readonly malformedLines: number;
}

export const USAGE_STATS_SESSION_LIMIT = 50;

/** Start of the local hour/day containing `ms`. */
export function bucketStartOf(ms: number, bucket: UsageBucket): number {
  const d = new Date(ms);
  return bucket === 'day'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
}

function nextBucket(start: number, bucket: UsageBucket): number {
  const d = new Date(start);
  return bucket === 'day'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    : start + HOUR_MS;
}

/** `platform:endpoint:scope:sceneId`; other shapes keep whatever parts they have. */
export function parseSessionKey(key: string): { platform?: string; scope?: string; sceneId?: string } {
  const parts = key.split(':');
  if (parts.length >= 4) return { platform: parts[0]!, scope: parts[2]!, sceneId: parts.slice(3).join(':') };
  if (parts.length === 3) return { platform: parts[0]!, scope: parts[1]!, sceneId: parts[2]! };
  return parts[0] ? { platform: parts[0] } : {};
}

interface Tally { calls: number; input: number; output: number; cache: number; cacheWrite: number }
const tally = (): Tally => ({ calls: 0, input: 0, output: 0, cache: 0, cacheWrite: 0 });

function tokens(t: Tally): UsageStatsTokens {
  return {
    calls: t.calls,
    inputTokens: t.input,
    outputTokens: t.output,
    cacheReadTokens: t.cache,
    cacheWriteTokens: t.cacheWrite,
    cacheShare: t.input > 0 ? Math.min(1, t.cache / t.input) : 0,
  };
}

function nearestRank(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export async function buildUsageStats(dir: string, query: UsageStatsQuery): Promise<UsageStats> {
  const { since, until, bucket } = query;
  const total = tally();
  let turns = 0;
  const callShares: number[] = [];
  const segments = { history: 0, fixed: 0, user: 0 };
  const models = new Map<string, Tally & { provider: string; model: string }>();
  const sessions = new Map<string, Tally & { turns: number }>();
  const buckets = new Map<number, Tally & { byModel: Record<string, number> }>();
  for (let t = bucketStartOf(since, bucket); t < until; t = nextBucket(t, bucket)) {
    buckets.set(t, { ...tally(), byModel: {} });
  }

  const scan = await scanTraces(dir, { since, until, session: query.session }, (trace, startedAt) => {
    turns++;
    const session = sessions.get(trace.session_key) ?? { ...tally(), turns: 0 };
    session.turns++;
    sessions.set(trace.session_key, session);

    const calls: unknown[] = Array.isArray(trace.model_calls) ? trace.model_calls : [];
    for (const raw of calls) {
      const call = raw as any;
      const prompt = num(call?.prompt_tokens);
      if (prompt === undefined) continue;
      const output = num(call?.completion_tokens) ?? 0;
      const cache = num(call?.cache_read_tokens) ?? 0;
      const cacheWrite = num(call?.cache_write_tokens) ?? 0;
      if (prompt > 0) callShares.push(Math.min(1, cache / prompt));
      const provider = typeof call?.provider === 'string' && call.provider ? call.provider : 'unknown';
      const model = typeof call?.model === 'string' && call.model ? call.model : 'unknown';
      const at = num(call?.started_at) ?? num(call?.at) ?? startedAt;

      for (const t of [total, session]) { t.calls++; t.input += prompt; t.output += output; t.cache += cache; t.cacheWrite += cacheWrite; }
      const modelKey = `${provider}/${model}`;
      const m = models.get(modelKey) ?? { ...tally(), provider, model };
      m.calls++; m.input += prompt; m.output += output; m.cache += cache; m.cacheWrite += cacheWrite;
      models.set(modelKey, m);

      const slot = buckets.get(bucketStartOf(at, bucket)) ?? buckets.get(bucketStartOf(startedAt, bucket));
      if (slot) {
        slot.calls++; slot.input += prompt; slot.output += output; slot.cache += cache; slot.cacheWrite += cacheWrite;
        slot.byModel[modelKey] = (slot.byModel[modelKey] ?? 0) + prompt;
      }
    }

    const budget = trace.context_budget?.segments;
    if (budget && typeof budget === 'object') {
      for (const [key, value] of Object.entries(budget)) {
        const n = num(value) ?? 0;
        if (key === 'history') segments.history += n;
        else if (key === 'user') segments.user += n;
        else if (FIXED_SEGMENTS.has(key)) segments.fixed += n;
      }
    }
  });

  callShares.sort((a, b) => a - b);
  return {
    range: { since, until, bucket, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    totals: {
      turns,
      ...tokens(total),
      cacheShareByCall: { p50: nearestRank(callShares, 50), p90: nearestRank(callShares, 90) },
    },
    byModel: [...models.values()]
      .map(m => ({ provider: m.provider, model: m.model, ...tokens(m) }))
      .sort((a, b) => b.inputTokens - a.inputTokens),
    bySession: [...sessions.entries()]
      .map(([sessionKey, s]) => ({ sessionKey, ...parseSessionKey(sessionKey), turns: s.turns, ...tokens(s) }))
      .sort((a, b) => b.inputTokens - a.inputTokens)
      .slice(0, USAGE_STATS_SESSION_LIMIT),
    series: [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, b]) => ({ bucketStart, ...tokens(b), byModel: b.byModel })),
    segments,
    filesRead: scan.filesRead,
    malformedLines: scan.malformed,
  };
}
