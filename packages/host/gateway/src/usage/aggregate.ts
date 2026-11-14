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
  /** IANA zone for bucket boundaries; defaults to {@link defaultUsageTimeZone}. */
  readonly timeZone?: string;
}

/**
 * Resolves a recorded provider id (`services:<id>`, `accounts:<id>`, `profiles:<id>` or a
 * legacy alias) to the service it belongs to. Traces record either the service or the account
 * depending on the call path, so without this one model splits into two rows.
 */
export type UsageProviderResolver = (provider: string) => Readonly<{ key: string; label: string }> | undefined;

export interface UsageStatsOptions {
  readonly resolveProvider?: UsageProviderResolver;
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
  readonly totals: UsageStatsTokens & {
    readonly turns: number;
    readonly cacheShareByCall: { readonly p50: number; readonly p90: number };
    /** `inputTokens` is the provider-reported prompt tokens of every model call (all iterations, sub-agents included). */
    readonly inputBasis: 'reported-all-calls';
  };
  readonly byModel: ReadonlyArray<UsageStatsTokens & {
    /** Merge key: the resolved service id, or the recorded provider when it cannot be resolved. */
    readonly provider: string;
    readonly model: string;
    /** `服务名 · 模型`, or just the model when the recorded provider is an opaque id. */
    readonly displayName: string;
    readonly providerLabel?: string;
    /** Recorded provider ids merged into this row (e.g. `services:…` and `accounts:…`). */
    readonly providerIds: readonly string[];
  }>;
  readonly bySession: ReadonlyArray<UsageStatsTokens & {
    readonly sessionKey: string;
    readonly platform?: string;
    readonly scope?: string;
    readonly sceneId?: string;
    /** Readable conversation label from the trace origin (`平台 · 群 名称`), when recorded. */
    readonly displayName?: string;
    readonly turns: number;
  }>;
  /** `byModel` keys use `${provider}/${model}` of the merged rows; `modelLabels` maps them to display names. */
  readonly series: ReadonlyArray<UsageStatsTokens & { readonly bucketStart: number; readonly byModel: Readonly<Record<string, number>> }>;
  readonly modelLabels: Readonly<Record<string, string>>;
  /**
   * Estimated prompt composition of each turn's FIRST model request (`context_budget`), summed over
   * turns that recorded it. Not comparable to `totals.inputTokens` (actual, every call); see `inputBreakdown`.
   */
  readonly segments: { readonly history: number; readonly fixed: number; readonly user: number };
  readonly inputBreakdown: {
    readonly basis: 'first-request-estimate';
    /** Turns that carried a context budget. */
    readonly turns: number;
    readonly history: number;
    readonly fixed: number;
    readonly user: number;
    /** Segments not counted as history / fixed / user (e.g. active skills). */
    readonly other: number;
    /** history + fixed + user + other. */
    readonly estimatedTotal: number;
    /** Provider-reported prompt tokens of the same first requests, for comparison with `estimatedTotal`. */
    readonly firstRequestInputTokens: number;
  };
  readonly filesRead: number;
  readonly malformedLines: number;
}

export const USAGE_STATS_SESSION_LIMIT = 50;

/** `TZ` wins; otherwise the zone this process runs in (same rule as the instance Schedule Host). */
export function defaultUsageTimeZone(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const candidate = environment.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return isUsageTimeZone(candidate) ? candidate : 'UTC';
}

export function isUsageTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock fields of `ms` in `timeZone`. */
function wallClock(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let format = zoneFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    zoneFormatters.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(ms))) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

/** Wall clock of `ms` in `timeZone`, encoded as if it were UTC. */
function wallMs(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) + (((ms % 1000) + 1000) % 1000);
}

/** Start of the hour/day containing `ms` in `timeZone` (default: the process zone). */
export function bucketStartOf(ms: number, bucket: UsageBucket, timeZone?: string): number {
  if (!timeZone) {
    const d = new Date(ms);
    return bucket === 'day'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      : new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  }
  const wall = wallMs(ms, timeZone);
  const w = wallClock(ms, timeZone);
  const target = bucket === 'day' ? Date.UTC(w.year, w.month - 1, w.day) : Date.UTC(w.year, w.month - 1, w.day, w.hour);
  let start = ms - (wall - target);
  // A daylight-saving change between `target` and `ms` shifts the estimate; correct it once.
  for (let i = 0; i < 2; i++) {
    const drift = wallMs(start, timeZone) - target;
    if (drift === 0) break;
    start -= drift;
  }
  return start;
}

function nextBucket(start: number, bucket: UsageBucket, timeZone?: string): number {
  if (!timeZone) {
    const d = new Date(start);
    return bucket === 'day'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
      : start + HOUR_MS;
  }
  // 26 h always lands inside the next local day (days are 23–25 h long).
  return bucket === 'day' ? bucketStartOf(start + 26 * HOUR_MS, 'day', timeZone) : bucketStartOf(start + HOUR_MS + 1, 'hour', timeZone);
}

/** `YYYY-MM-DD` of `ms` in `timeZone` (default: the process zone). */
export function dayKeyOf(ms: number, timeZone?: string): string {
  if (!timeZone) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const w = wallClock(ms, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Ids minted by the provider graph (`services:<uuid>` …) carry no meaning for a reader. */
export function isOpaqueProviderId(provider: string): boolean {
  return /^(services|accounts|profiles):/u.test(provider);
}

/** `服务名 · 模型`; an unresolved opaque id shows the model alone instead of a UUID. */
export function usageModelDisplayName(provider: string, model: string, label?: string): string {
  if (label) return `${label} · ${model}`;
  if (!provider || provider === 'unknown' || isOpaqueProviderId(provider)) return model;
  return `${provider} · ${model}`;
}

const SCOPE_LABELS: Readonly<Record<string, string>> = { private: '私聊', direct: '私聊', group: '群', channel: '频道', guild: '频道' };

/** Readable label for a trace's conversation, from its recorded IM origin; `undefined` otherwise. */
export function sessionDisplayNameOf(trace: any): string | undefined {
  const origin = trace?.origin;
  if (!origin || typeof origin !== 'object') return undefined;
  if (origin.kind === 'im') {
    const platform = typeof origin.platform === 'string' ? origin.platform : '';
    const scope = typeof origin.scope === 'string' ? origin.scope : typeof origin.conversation?.kind === 'string' ? origin.conversation.kind : '';
    const conversationName = typeof origin.conversation?.name === 'string' && origin.conversation.name.trim() ? origin.conversation.name.trim() : undefined;
    const principalName = typeof trace?.principal?.display_name === 'string' && trace.principal.display_name.trim() ? trace.principal.display_name.trim() : undefined;
    const sceneId = typeof origin.sceneId === 'string' ? origin.sceneId : typeof origin.conversation?.id === 'string' ? origin.conversation.id : '';
    const name = conversationName ?? ((scope === 'private' || scope === 'direct') ? principalName : undefined) ?? sceneId;
    const parts = [platform, `${SCOPE_LABELS[scope] ?? scope}${name ? ` ${name}` : ''}`.trim()].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  }
  if (origin.kind === 'http') return 'HTTP';
  if (origin.kind === 'schedule') return `定时任务 ${String(origin.jobId ?? '')}`.trim();
  if (origin.kind === 'a2a') return 'A2A';
  if (origin.kind === 'mcp') return 'MCP';
  if (origin.kind === 'internal') return `内部 ${String(origin.source ?? '')}`.trim();
  return undefined;
}

/** `platform:endpoint:scope:sceneId`; other shapes keep whatever parts they have. */
export function parseSessionKey(key: string): { platform?: string; scope?: string; sceneId?: string } {
  // Hashed identities (`personal-session:v1:<sha>`, `scene-task:v1:<sha>`) carry no address.
  if (/^[a-z-]+:v\d+:[0-9a-f]{16,}$/u.test(key)) return {};
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

export async function buildUsageStats(dir: string, query: UsageStatsQuery, options: UsageStatsOptions = {}): Promise<UsageStats> {
  const { since, until, bucket } = query;
  const timeZone = query.timeZone && isUsageTimeZone(query.timeZone) ? query.timeZone : defaultUsageTimeZone();
  const total = tally();
  let turns = 0;
  const callShares: number[] = [];
  const segments = { history: 0, fixed: 0, user: 0 };
  const breakdown = { turns: 0, other: 0, firstRequestInputTokens: 0 };
  const models = new Map<string, Tally & { provider: string; model: string; label?: string; providerIds: Set<string> }>();
  const resolved = new Map<string, Readonly<{ key: string; label: string }> | undefined>();
  const sessions = new Map<string, Tally & { turns: number; displayName?: string }>();
  const buckets = new Map<number, Tally & { byModel: Record<string, number> }>();
  for (let t = bucketStartOf(since, bucket, timeZone); t < until; t = nextBucket(t, bucket, timeZone)) {
    buckets.set(t, { ...tally(), byModel: {} });
  }
  const resolve = (provider: string) => {
    if (!options.resolveProvider) return undefined;
    if (!resolved.has(provider)) {
      let value: Readonly<{ key: string; label: string }> | undefined;
      try { value = options.resolveProvider(provider); } catch { value = undefined; }
      resolved.set(provider, value);
    }
    return resolved.get(provider);
  };

  const scan = await scanTraces(dir, { since, until, session: query.session }, (trace, startedAt) => {
    turns++;
    const session = sessions.get(trace.session_key) ?? { ...tally(), turns: 0 };
    session.turns++;
    session.displayName ??= sessionDisplayNameOf(trace);
    sessions.set(trace.session_key, session);

    const calls: unknown[] = Array.isArray(trace.model_calls) ? trace.model_calls : [];
    let firstPrompt: number | undefined;
    for (const raw of calls) {
      const call = raw as any;
      const prompt = num(call?.prompt_tokens);
      if (prompt === undefined) continue;
      firstPrompt ??= prompt;
      const output = num(call?.completion_tokens) ?? 0;
      const cache = num(call?.cache_read_tokens) ?? 0;
      const cacheWrite = num(call?.cache_write_tokens) ?? 0;
      if (prompt > 0) callShares.push(Math.min(1, cache / prompt));
      const recorded = typeof call?.provider === 'string' && call.provider ? call.provider : 'unknown';
      const model = typeof call?.model === 'string' && call.model ? call.model : 'unknown';
      const at = num(call?.started_at) ?? num(call?.at) ?? startedAt;

      for (const t of [total, session]) { t.calls++; t.input += prompt; t.output += output; t.cache += cache; t.cacheWrite += cacheWrite; }
      // One row per (service, model): `services:` and `accounts:` ids of the same service merge.
      const service = resolve(recorded);
      const groupKey = service ? `${service.key}\n${model}` : isOpaqueProviderId(recorded) ? `\n${model}` : `${recorded}\n${model}`;
      const m = models.get(groupKey) ?? { ...tally(), provider: service?.key ?? recorded, model, ...(service ? { label: service.label } : {}), providerIds: new Set<string>() };
      m.calls++; m.input += prompt; m.output += output; m.cache += cache; m.cacheWrite += cacheWrite;
      m.providerIds.add(recorded);
      models.set(groupKey, m);
      const modelKey = `${m.provider}/${m.model}`;

      const slot = buckets.get(bucketStartOf(at, bucket, timeZone)) ?? buckets.get(bucketStartOf(startedAt, bucket, timeZone));
      if (slot) {
        slot.calls++; slot.input += prompt; slot.output += output; slot.cache += cache; slot.cacheWrite += cacheWrite;
        slot.byModel[modelKey] = (slot.byModel[modelKey] ?? 0) + prompt;
      }
    }

    const budget = trace.context_budget?.segments;
    if (budget && typeof budget === 'object') {
      breakdown.turns++;
      breakdown.firstRequestInputTokens += firstPrompt ?? 0;
      for (const [key, value] of Object.entries(budget)) {
        const n = num(value) ?? 0;
        if (key === 'history') segments.history += n;
        else if (key === 'user') segments.user += n;
        else if (FIXED_SEGMENTS.has(key)) segments.fixed += n;
        else breakdown.other += n;
      }
    }
  });

  callShares.sort((a, b) => a - b);
  const byModel = [...models.values()]
    .map(m => ({
      provider: m.provider,
      model: m.model,
      displayName: usageModelDisplayName(m.provider, m.model, m.label),
      ...(m.label ? { providerLabel: m.label } : {}),
      providerIds: [...m.providerIds].sort(),
      ...tokens(m),
    }))
    .sort((a, b) => b.inputTokens - a.inputTokens);
  return {
    range: { since, until, bucket, timeZone },
    totals: {
      turns,
      ...tokens(total),
      cacheShareByCall: { p50: nearestRank(callShares, 50), p90: nearestRank(callShares, 90) },
      inputBasis: 'reported-all-calls',
    },
    byModel,
    bySession: [...sessions.entries()]
      .map(([sessionKey, s]) => ({ sessionKey, ...parseSessionKey(sessionKey), ...(s.displayName ? { displayName: s.displayName } : {}), turns: s.turns, ...tokens(s) }))
      .sort((a, b) => b.inputTokens - a.inputTokens)
      .slice(0, USAGE_STATS_SESSION_LIMIT),
    series: [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, b]) => ({ bucketStart, ...tokens(b), byModel: b.byModel })),
    modelLabels: Object.fromEntries(byModel.map(m => [`${m.provider}/${m.model}`, m.displayName])),
    segments,
    inputBreakdown: {
      basis: 'first-request-estimate',
      turns: breakdown.turns,
      ...segments,
      other: breakdown.other,
      estimatedTotal: segments.history + segments.fixed + segments.user + breakdown.other,
      firstRequestInputTokens: breakdown.firstRequestInputTokens,
    },
    filesRead: scan.filesRead,
    malformedLines: scan.malformed,
  };
}
