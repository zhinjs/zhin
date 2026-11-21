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
import { isHashedSessionKey, parseConversationSessionKey } from '@zhin.js/console-protocol';
import { formatDateTime } from '@zhin.js/plugin-runtime';
import { PromptCacheProbe, type PromptCacheHint } from './prompt-cache.js';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const FIXED_SEGMENTS: ReadonlySet<string> = new Set(['system', 'tool_schemas', 'output_schema', 'tool_index', 'skill_catalog', 'agent_catalog', 'knowledge_index', 'memory', 'bootstrap']);

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
  /**
   * Also sum the totals of this earlier window (`compare: 'previous'`, #1250 第 58 批): the caller
   * computes it (same length in milliseconds, right before `since`; not calendar-aligned) and may cut
   * it short (e.g. at the epoch). Only its totals are computed; the `session` filter applies to it too.
   */
  readonly previous?: UsageStatsPreviousWindow;
}

export interface UsageStatsPreviousWindow {
  readonly since: number;
  readonly until: number;
  /** The window is shorter than the current one (cut short by the caller's per-window limit). */
  readonly truncated?: boolean;
}

/**
 * Resolves a recorded provider id (`services:<id>`, `accounts:<id>`, `profiles:<id>` or a
 * legacy alias) to the service it belongs to. Traces record either the service or the account
 * depending on the call path, so without this one model splits into two rows.
 */
export type UsageProviderResolver = (provider: string) => UsageResolvedService | undefined;

/** What a {@link UsageProviderResolver} returns: the service's merge key and label, plus its Driver's display name when known. */
export type UsageResolvedService = Readonly<{ key: string; label?: string; driverLabel?: string }>;

/** A model Profile id (`profiles:<id>`) → its readable name; `undefined` when the profile is unknown. */
export type UsageProfileResolver = (profileId: string) => Readonly<{ label?: string }> | undefined;

/**
 * Recorded IM platform (`origin.platform`, the conversation's client adapter) + endpoint (account)
 * of a conversation → the account's readable name.
 */
export type UsageAccountResolver = (platform: string, endpoint: string) => string | undefined;

/**
 * A schedule job id (`origin.jobId`, `schedule:<id>` sessions) → the job's label; `undefined` when the
 * job has no label or no longer exists (the id is shown then).
 */
export type UsageScheduleJobResolver = (jobId: string) => string | undefined;

export interface UsageStatsOptions {
  readonly resolveProvider?: UsageProviderResolver;
  readonly resolveProfile?: UsageProfileResolver;
  readonly resolveAccount?: UsageAccountResolver;
  /** Names `schedule:<id>` sessions after their job's label (`bySession[].sceneLabel` / `displayName`). */
  readonly resolveScheduleJob?: UsageScheduleJobResolver;
}

/** Version of the {@link UsageStats} shape; 2 adds `byAgent`, `byPurpose`, `previous`, profile / driver / account labels. */
export const USAGE_STATS_SCHEMA_VERSION = 2;

/** `byAgent[].agent` of the main assistant (a turn with a recorded model selection but no sub-agent). */
export const USAGE_MAIN_AGENT_KEY = '@main';
/** `byAgent[].agent` / `byPurpose[].purpose` of model calls whose trace recorded no model selection (older traces). */
export const USAGE_UNRECORDED_KEY = '@unrecorded';

const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  chat: '对话',
  agent: '子 Agent',
  summary: '摘要',
  ambient: '插话判断',
  'ambient-judge': '插话判断',
  perception: '媒体理解',
  intent: '意图识别',
  inference: '推理',
  discovery: '发现',
  approval: '审批',
  authorization: '授权判断',
  preparation: '准备',
  [USAGE_UNRECORDED_KEY]: '未记录',
};

/** Readable label of a model purpose (`chat` → 对话); unknown purposes show as-is. */
export function usagePurposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}

export type UsageAgentRow = UsageStatsTokens & {
  /** Sub-agent name, {@link USAGE_MAIN_AGENT_KEY} or {@link USAGE_UNRECORDED_KEY}. */
  readonly agent: string;
  readonly label: string;
  readonly kind: 'main' | 'agent' | 'unrecorded';
  /** (Sub-)turns attributed to this Agent. */
  readonly turns: number;
};

export type UsagePurposeRow = UsageStatsTokens & {
  /** Model purpose (`chat`, `agent`, `summary`, …; `agent:<name>` counts as `agent`) or {@link USAGE_UNRECORDED_KEY}. */
  readonly purpose: string;
  readonly label: string;
  readonly turns: number;
};

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
  /** Shape version ({@link USAGE_STATS_SCHEMA_VERSION}); absent before 2. */
  readonly schemaVersion?: number;
  readonly range: { readonly since: number; readonly until: number; readonly bucket: UsageBucket; readonly timeZone: string };
  readonly totals: UsageStatsTokens & {
    readonly turns: number;
    readonly cacheShareByCall: { readonly p50: number; readonly p90: number };
    /** `inputTokens` is the provider-reported prompt tokens of every model call (all iterations, sub-agents included). */
    readonly inputBasis: 'reported-all-calls';
    /**
     * Replies (root turns and sub-agent turns) that claimed a lookup ("查了下", "I checked") while
     * that turn made no tool call: the trace's `claim_without_tool_call` (#1250 / #1270).
     */
    readonly claimsWithoutToolCall: number;
    /** Turns that ended with a denied or failed side-effect tool and got the 「未执行」 notice (`unexecuted_tool_notice`). */
    readonly unexecutedToolNotices: number;
  };
  readonly byModel: ReadonlyArray<UsageStatsTokens & {
    /** Merge key: the resolved service id, or the recorded provider when it cannot be resolved. */
    readonly provider: string;
    readonly model: string;
    /** `服务名 · 模型`, or just the model when the recorded provider is an opaque id. */
    readonly displayName: string;
    readonly providerLabel?: string;
    /** Display name of the service's Driver ("Anthropic"), to tell services with the same label apart. */
    readonly driverLabel?: string;
    /** The model Profile every call of this row ran on: set only when all calls are attributed to the same one. */
    readonly profileId?: string;
    /** That Profile's readable name, when it has one. */
    readonly profileName?: string;
    /** Recorded provider ids merged into this row (e.g. `services:…` and `accounts:…`). */
    readonly providerIds: readonly string[];
    /** Claims without a tool call answered by this model (the turn's last model call, #1270). */
    readonly claimsWithoutToolCall: number;
  }>;
  readonly bySession: ReadonlyArray<UsageStatsTokens & {
    readonly sessionKey: string;
    readonly platform?: string;
    readonly scope?: string;
    readonly sceneId?: string;
    /** Readable conversation label from the trace origin (`平台 · 群 名称`), when recorded. */
    readonly displayName?: string;
    /** Structured parts of `displayName` (see {@link UsageSessionParts}), for localized labels. */
    readonly scopeKind?: string;
    readonly sceneLabel?: string;
    /** Short session key, as `zhin usage report` shows it ({@link shortSessionKey}), to tell same-named sessions apart. */
    readonly shortKey?: string;
    /** Recorded IM endpoint (account) of the conversation. */
    readonly endpoint?: string;
    /** The account's readable name, when the endpoint is still known. */
    readonly accountLabel?: string;
    readonly turns: number;
  }>;
  /** Sessions in range; `bySession` keeps the top {@link USAGE_STATS_SESSION_LIMIT} by input tokens. */
  readonly sessionsTotal?: number;
  /** Sums of the sessions left out of `bySession` (all zero when none were). */
  readonly othersTotals?: UsageStatsTokens & { readonly sessions: number; readonly turns: number };
  /**
   * Model calls by Agent (`model_selection.agent`, from each (sub-)turn's own selection). Token columns add
   * up to `totals`; `turns` counts (sub-)turns, so the rows' turns can add up to more than `totals.turns`.
   */
  readonly byAgent?: readonly UsageAgentRow[];
  /** Model calls by the (sub-)turn's `model_selection.purpose`; same sums as `byAgent`. */
  readonly byPurpose?: readonly UsagePurposeRow[];
  /** Totals of the previous window, with `compare: 'previous'`. */
  readonly previous?: UsageStatsPreviousWindow & { readonly truncated: boolean; readonly totals: UsageStats['totals'] };
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
  /**
   * Services that likely do not support or pass through prompt caching (#1250): a long run of
   * calls without cache reads while adjacent requests shared their prefix. Empty when none.
   */
  readonly promptCacheHints: readonly PromptCacheHint[];
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
  // The CLI's shared date format (#1250 cli-datetime-us-locale).
  return formatDateTime(ms, undefined, { part: 'date', ...(timeZone ? { timeZone } : {}) });
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

/** Longest platform-given name kept, in code points (same bound as the Agent's trace labels). */
const SESSION_TEXT_MAX_CODE_POINTS = 128;

/**
 * C0 / C1 controls (ESC sequences, newlines, …), U+2028 / U+2029 and the bidi embedding /
 * override / isolate controls: a platform-given group or user name with one could rewrite a
 * terminal line or reorder the Console's text.
 */
const UNSAFE_SESSION_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/**
 * A recorded name made safe to show: trimmed, unsafe characters escaped as `\uXXXX`, then cut to
 * 128 code points (never inside a surrogate pair); `undefined` for a non-string or blank value.
 * Idempotent. The same rules as `sanitizeOriginText()` of `@zhin.js/agent/trace` (the gateway must
 * not depend on the Agent; a parity test keeps the two in step).
 */
export function sanitizeSessionText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const escaped = value.trim().replace(UNSAFE_SESSION_TEXT, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const cut = [...escaped].slice(0, SESSION_TEXT_MAX_CODE_POINTS).join('').trim();
  return cut || undefined;
}

/** Type words of {@link sessionDisplayNameOf}, by `scopeKind`. */
const SCOPE_TEXT: Readonly<Record<string, string>> = {
  private: '私聊', group: '群', channel: '频道',
  http: 'HTTP', schedule: '定时任务', a2a: 'A2A', mcp: 'MCP', internal: '内部',
};

/** IM platform of a trace's recorded origin (the conversation's adapter when `platform` is missing). */
function sessionPlatformOf(trace: any): string | undefined {
  const origin = trace?.origin;
  if (!origin || typeof origin !== 'object' || origin.kind !== 'im') return undefined;
  return sanitizeSessionText(origin.platform) ?? sanitizeSessionText(origin.conversation?.endpoint?.adapter);
}

/** `sandbox · 私聊 Developer`, `定时任务 每日早报`, `HTTP` from a platform and the structured parts. */
export function formatSessionDisplayName(platform: string | undefined, parts: UsageSessionParts): string | undefined {
  const scope = parts.scopeKind ? SCOPE_TEXT[parts.scopeKind] ?? parts.scopeKind : undefined;
  const scene = [scope, parts.sceneLabel].filter(Boolean).join(' ');
  const text = [platform, scene].filter(Boolean).join(' · ');
  return text || undefined;
}

/**
 * Readable label for a trace's conversation, from its recorded origin (`sandbox · 私聊 Developer`,
 * `定时任务 sched_1`, `HTTP`); `undefined` without one. Platform-given names are cleaned
 * ({@link sanitizeSessionText}).
 */
export function sessionDisplayNameOf(trace: any): string | undefined {
  return formatSessionDisplayName(sessionPlatformOf(trace), sessionPartsOf(trace));
}

/** Structured parts of {@link sessionDisplayNameOf}, for a Console that localizes the label itself. */
export interface UsageSessionParts {
  /**
   * IM: `group` / `private` / `channel` (or the recorded scope as-is); otherwise the origin kind:
   * `http`, `schedule`, `a2a`, `mcp`, `internal`.
   */
  readonly scopeKind?: string;
  /** Group / user / channel name, schedule job id or internal source — without a type word. */
  readonly sceneLabel?: string;
}

const SCOPE_KINDS: Readonly<Record<string, string>> = { private: 'private', direct: 'private', group: 'group', channel: 'channel', guild: 'channel' };

/**
 * `scopeKind` + `sceneLabel` of a trace's recorded origin; empty without one. Blank values fall
 * back (a blank `scope` to `conversation.kind`, a blank `sceneId` to `conversation.id`), as in the
 * Agent's `turnOriginLabelOf()`.
 */
export function sessionPartsOf(trace: any): UsageSessionParts {
  const origin = trace?.origin;
  if (!origin || typeof origin !== 'object') return {};
  const label = sanitizeSessionText;
  if (origin.kind === 'im') {
    const scope = label(origin.scope) ?? label(origin.conversation?.kind);
    const kind = scope ? SCOPE_KINDS[scope] ?? scope : undefined;
    const name = label(origin.conversation?.name)
      ?? (kind === 'private' ? label(trace?.principal?.display_name) : undefined)
      ?? label(origin.sceneId) ?? label(origin.conversation?.id);
    return { ...(kind ? { scopeKind: kind } : {}), ...(name ? { sceneLabel: name } : {}) };
  }
  if (origin.kind === 'schedule') { const name = label(origin.jobId); return { scopeKind: 'schedule', ...(name ? { sceneLabel: name } : {}) }; }
  if (origin.kind === 'internal') { const name = label(origin.source); return { scopeKind: 'internal', ...(name ? { sceneLabel: name } : {}) }; }
  if (origin.kind === 'http' || origin.kind === 'a2a' || origin.kind === 'mcp') return { scopeKind: origin.kind };
  return {};
}

/** Hashed session keys (`personal-session:v1:<sha>`) shortened to `personal-session:<8 hex>`; others unchanged. */
export function shortSessionKey(key: string): string {
  const hashed = /^([a-z-]+):v\d+:([0-9a-f]{16,})$/u.exec(key);
  return hashed ? `${hashed[1]}:${hashed[2]!.slice(0, 8)}` : key;
}

/**
 * `sandbox · 私聊 Developer（personal-session:ab12cd34）` — the conversation `zhin usage report`
 * shows, with the short key to tell sessions apart; just the (short) key without a recorded origin.
 */
export function sessionLabelOf(trace: any): string | undefined {
  const key = typeof trace?.session_key === 'string' ? trace.session_key : undefined;
  const name = sessionDisplayNameOf(trace);
  if (!key) return name;
  return name ? `${name}（${shortSessionKey(key)}）` : shortSessionKey(key);
}

/**
 * Address of a usage session: `platform` / `scope` / `sceneId` from the four-segment conversation
 * session key (`@zhin.js/console-protocol` owns the parser); hashed identities carry none, and any
 * other key only names its first segment as the platform.
 */
export function sessionAddressOf(key: string): { platform?: string; scope?: string; sceneId?: string } {
  if (isHashedSessionKey(key)) return {};
  const parsed = parseConversationSessionKey(key);
  if (parsed) return { platform: parsed.adapter, scope: parsed.kind, sceneId: parsed.id };
  const platform = key.split(':', 1)[0];
  return platform ? { platform } : {};
}

interface Tally { calls: number; input: number; output: number; cache: number; cacheWrite: number }
const tally = (): Tally => ({ calls: 0, input: 0, output: 0, cache: 0, cacheWrite: 0 });

/** One reply that claimed a lookup without any tool call, with the model call that wrote it. */
export interface TraceLookupClaim {
  /** Recorded provider / model of the node's last model call; absent when it recorded none. */
  readonly provider?: string;
  readonly model?: string;
}

/**
 * Every `claim_without_tool_call` of a trace: the root turn's and each nested sub-agent's
 * (#1270). Shared by the Console usage stats and `zhin usage report`.
 */
export function lookupClaimsOf(trace: unknown): readonly TraceLookupClaim[] {
  const claims: TraceLookupClaim[] = [];
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > MAX_SUBAGENT_DEPTH) return;
    if (node.claim_without_tool_call && typeof node.claim_without_tool_call === 'object') {
      const calls = Array.isArray(node.model_calls) ? node.model_calls : [];
      const last = calls[calls.length - 1];
      claims.push({
        ...(typeof last?.provider === 'string' && last.provider ? { provider: last.provider } : {}),
        ...(typeof last?.model === 'string' && last.model ? { model: last.model } : {}),
      });
    }
    if (Array.isArray(node.subagents)) for (const child of node.subagents) visit(child, depth + 1);
  };
  visit(trace, 0);
  return claims;
}

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

/** Sub-agent nesting depth the aggregate follows; deeper (malformed) trees are cut off. */
const MAX_SUBAGENT_DEPTH = 16;

function nearestRank(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Agent and purpose a (sub-)turn's own `model_selection` attributes its calls to; unrecorded without one. */
function attributionOf(node: any): { agent: string; kind: UsageAgentRow['kind']; purpose: string } {
  const selection = node?.model_selection;
  const purposeRaw = text(selection?.purpose);
  if (!selection || typeof selection !== 'object' || !purposeRaw) return { agent: USAGE_UNRECORDED_KEY, kind: 'unrecorded', purpose: USAGE_UNRECORDED_KEY };
  const agentPurpose = /^agent:(.+)$/u.exec(purposeRaw)?.[1]?.trim();
  const agent = text(selection.agent) ?? agentPurpose;
  return {
    agent: agent ?? USAGE_MAIN_AGENT_KEY,
    kind: agent ? 'agent' : 'main',
    purpose: agentPurpose ? 'agent' : purposeRaw,
  };
}

/**
 * Profiles this (sub-)turn recorded it ran on, in match order: the fallbacks' `to_*` (latest switch
 * first, so calls after a switch go to the new Profile even on the same account and model), then
 * the selection, then the fallbacks' `from_*`.
 */
function profileCandidatesOf(node: any): ReadonlyArray<{ profile: string; account: string; model: string }> {
  const out: { profile: string; account: string; model: string }[] = [];
  const push = (profile: unknown, account: unknown, model: unknown) => {
    const p = text(profile); const a = text(account); const m = text(model);
    if (p && a && m) out.push({ profile: p, account: a, model: m });
  };
  const fallbacks: any[] = Array.isArray(node?.model_fallbacks)
    ? node.model_fallbacks.filter((fallback: unknown) => fallback && typeof fallback === 'object')
    : [];
  for (const fallback of [...fallbacks].reverse()) push(fallback.to_profile_id, fallback.to_account_id, fallback.to_model);
  const selection = node?.model_selection;
  if (selection && typeof selection === 'object') push(selection.profile_id, selection.account_id, selection.model);
  for (const fallback of fallbacks) push(fallback.from_profile_id, fallback.from_account_id, fallback.from_model);
  return out;
}

export async function buildUsageStats(dir: string, query: UsageStatsQuery, options: UsageStatsOptions = {}): Promise<UsageStats> {
  const current = await aggregateUsage(dir, query, options);
  if (!query.previous) return current;
  const window = query.previous;
  // Only the totals of the previous window: no series buckets, rows or prompt-cache probe.
  const prior = window.since < window.until
    ? await aggregateUsage(dir, { since: window.since, until: window.until, bucket: query.bucket, ...(query.session ? { session: query.session } : {}), ...(query.timeZone ? { timeZone: query.timeZone } : {}) }, options, { totalsOnly: true })
    : undefined;
  const totals = prior?.totals ?? emptyTotals();
  return { ...current, previous: { since: window.since, until: window.until, truncated: window.truncated === true, totals } };
}

function emptyTotals(): UsageStats['totals'] {
  return {
    turns: 0,
    ...tokens(tally()),
    cacheShareByCall: { p50: 0, p90: 0 },
    inputBasis: 'reported-all-calls',
    claimsWithoutToolCall: 0,
    unexecutedToolNotices: 0,
  };
}

async function aggregateUsage(
  dir: string, query: UsageStatsQuery, options: UsageStatsOptions, mode: Readonly<{ totalsOnly?: boolean }> = {},
): Promise<UsageStats> {
  const { since, until, bucket } = query;
  const totalsOnly = mode.totalsOnly === true;
  const timeZone = query.timeZone && isUsageTimeZone(query.timeZone) ? query.timeZone : defaultUsageTimeZone();
  const total = tally();
  let turns = 0;
  const callShares: number[] = [];
  const segments = { history: 0, fixed: 0, user: 0 };
  const breakdown = { turns: 0, other: 0, firstRequestInputTokens: 0 };
  const models = new Map<string, Tally & { provider: string; model: string; label?: string; driverLabel?: string; providerIds: Set<string>; profiles: Set<string>; unprofiled: number }>();
  const resolved = new Map<string, UsageResolvedService | undefined>();
  const sessions = new Map<string, Tally & { turns: number; labelled?: boolean; displayName?: string; parts?: UsageSessionParts; platform?: string; endpoint?: string; jobId?: string }>();
  const agents = new Map<string, Tally & { turns: number; kind: UsageAgentRow['kind'] }>();
  const purposes = new Map<string, Tally & { turns: number }>();
  const buckets = new Map<number, Tally & { byModel: Record<string, number> }>();
  for (let t = bucketStartOf(since, bucket, timeZone); !totalsOnly && t < until; t = nextBucket(t, bucket, timeZone)) {
    buckets.set(t, { ...tally(), byModel: {} });
  }
  let claimsWithoutToolCall = 0;
  let unexecutedToolNotices = 0;
  const claimsByGroup = new Map<string, number>();
  const groupKeyOf = (recorded: string, model: string) => {
    const service = resolve(recorded);
    return service ? `${service.key}\n${model}` : isOpaqueProviderId(recorded) ? `\n${model}` : `${recorded}\n${model}`;
  };
  const resolve = (provider: string) => {
    if (!options.resolveProvider) return undefined;
    if (!resolved.has(provider)) {
      let value: UsageResolvedService | undefined;
      try { value = options.resolveProvider(provider); } catch { value = undefined; }
      resolved.set(provider, value);
    }
    return resolved.get(provider);
  };
  const profileLabels = new Map<string, string | undefined>();
  const profileLabel = (id: string) => {
    if (!options.resolveProfile) return undefined;
    if (!profileLabels.has(id)) {
      let label: string | undefined;
      try { label = text(options.resolveProfile(id)?.label); } catch { label = undefined; }
      profileLabels.set(id, label);
    }
    return profileLabels.get(id);
  };
  const isKnownProfile = (id: string) => {
    if (!options.resolveProfile) return false;
    try { return options.resolveProfile(id) !== undefined; } catch { return false; }
  };
  /** The profile a call ran on: a recorded `profiles:` provider, else the node's selection / fallback with that account and model. */
  const profileOfCall = (recorded: string, model: string, candidates: ReadonlyArray<{ profile: string; account: string; model: string }>) => {
    if (/^profiles:/u.test(recorded) && (isKnownProfile(recorded) || candidates.some(c => c.profile === recorded))) return recorded;
    const service = resolve(recorded)?.key;
    for (const candidate of candidates) {
      if (candidate.model !== model) continue;
      if (candidate.account === recorded || candidate.profile === recorded) return candidate.profile;
      if (service !== undefined && resolve(candidate.account)?.key === service) return candidate.profile;
    }
    return undefined;
  };

  const cacheProbe = new PromptCacheProbe({ resolveProvider: resolve });
  const scan = await scanTraces(dir, { since, until, session: query.session }, (trace, startedAt) => {
    turns++;
    if (!totalsOnly) cacheProbe.visit(trace);
    const session = sessions.get(trace.session_key) ?? { ...tally(), turns: 0 };
    session.turns++;
    if (!totalsOnly) {
      // `displayName` and its parts come from the same trace: the session's first one with a recorded origin.
      // A later trace without an origin keeps them.
      if (!session.labelled) {
        const displayName = sessionDisplayNameOf(trace);
        const parts = sessionPartsOf(trace);
        if (displayName || parts.scopeKind || parts.sceneLabel) {
          session.labelled = true;
          if (displayName) session.displayName = displayName;
          session.parts = parts;
        }
      }
      if (trace.origin?.kind === 'im') {
        session.platform ??= sanitizeSessionText(trace.origin.platform);
        session.endpoint ??= sanitizeSessionText(trace.origin.endpoint);
      }
      if (trace.origin?.kind === 'schedule') session.jobId ??= text(trace.origin.jobId);
      sessions.set(trace.session_key, session);
    }

    // Every model call of the turn: the root's, then each sub-agent's (nested, up to MAX_SUBAGENT_DEPTH). A
    // sub-agent trace's own `model_calls` are not repeated in its parent's, so nothing counts twice;
    // its calls count toward the root turn's session. `firstPrompt` is the root's first request.
    // Each (sub-)turn's calls count toward the Agent / purpose of its own `model_selection`.
    const nodes: any[] = [];
    const collect = (node: any, depth: number) => {
      if (!node || typeof node !== 'object' || depth > MAX_SUBAGENT_DEPTH) return;
      nodes.push(node);
      if (Array.isArray(node.subagents)) for (const child of node.subagents) collect(child, depth + 1);
    };
    collect(trace, 0);
    let firstPrompt: number | undefined;
    for (const [nodeIndex, node] of nodes.entries()) {
      const attribution = attributionOf(node);
      const agentRow = agents.get(attribution.agent) ?? { ...tally(), turns: 0, kind: attribution.kind };
      agentRow.turns++;
      agents.set(attribution.agent, agentRow);
      const purposeRow = purposes.get(attribution.purpose) ?? { ...tally(), turns: 0 };
      purposeRow.turns++;
      purposes.set(attribution.purpose, purposeRow);
      const candidates = profileCandidatesOf(node);
      const calls: unknown[] = Array.isArray(node.model_calls) ? node.model_calls : [];
      for (const raw of calls) {
        const call = raw as any;
        const prompt = num(call?.prompt_tokens);
        if (prompt === undefined) continue;
        if (nodeIndex === 0) firstPrompt ??= prompt;
        const output = num(call?.completion_tokens) ?? 0;
        const cache = num(call?.cache_read_tokens) ?? 0;
        const cacheWrite = num(call?.cache_write_tokens) ?? 0;
        if (prompt > 0) callShares.push(Math.min(1, cache / prompt));
        const recorded = typeof call?.provider === 'string' && call.provider ? call.provider : 'unknown';
        const model = typeof call?.model === 'string' && call.model ? call.model : 'unknown';
        const at = num(call?.started_at) ?? num(call?.at) ?? startedAt;

        for (const t of [total, session, agentRow, purposeRow]) { t.calls++; t.input += prompt; t.output += output; t.cache += cache; t.cacheWrite += cacheWrite; }
        if (totalsOnly) continue;
        // One row per (service, model): `services:` and `accounts:` ids of the same service merge.
        const service = resolve(recorded);
        const groupKey = service ? `${service.key}\n${model}` : isOpaqueProviderId(recorded) ? `\n${model}` : `${recorded}\n${model}`;
        const m = models.get(groupKey) ?? {
          ...tally(), provider: service?.key ?? recorded, model,
          ...(service?.label ? { label: service.label } : {}),
          ...(service?.driverLabel ? { driverLabel: service.driverLabel } : {}),
          providerIds: new Set<string>(), profiles: new Set<string>(), unprofiled: 0,
        };
        m.calls++; m.input += prompt; m.output += output; m.cache += cache; m.cacheWrite += cacheWrite;
        m.providerIds.add(recorded);
        const profile = profileOfCall(recorded, model, candidates);
        if (profile) m.profiles.add(profile); else m.unprofiled++;
        models.set(groupKey, m);
        const modelKey = `${m.provider}/${m.model}`;

        const slot = buckets.get(bucketStartOf(at, bucket, timeZone)) ?? buckets.get(bucketStartOf(startedAt, bucket, timeZone));
        if (slot) {
          slot.calls++; slot.input += prompt; slot.output += output; slot.cache += cache; slot.cacheWrite += cacheWrite;
          slot.byModel[modelKey] = (slot.byModel[modelKey] ?? 0) + prompt;
        }
      }
    }

    for (const claim of lookupClaimsOf(trace)) {
      claimsWithoutToolCall++;
      if (totalsOnly) continue;
      const key = groupKeyOf(claim.provider ?? 'unknown', claim.model ?? 'unknown');
      claimsByGroup.set(key, (claimsByGroup.get(key) ?? 0) + 1);
    }
    if (trace.unexecuted_tool_notice && typeof trace.unexecuted_tool_notice === 'object') unexecutedToolNotices++;

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
  const byModel = [...models.entries()]
    .map(([group, m]) => {
      // A row names its Profile only when every one of its calls is attributed to the same Profile:
      // a single call that cannot be attributed (`unprofiled`) leaves the row without one.
      const profileId = m.profiles.size === 1 && m.unprofiled === 0 ? [...m.profiles][0]! : undefined;
      const profileName = profileId ? profileLabel(profileId) : undefined;
      return {
        provider: m.provider,
        model: m.model,
        displayName: usageModelDisplayName(m.provider, m.model, m.label),
        ...(m.label ? { providerLabel: m.label } : {}),
        ...(m.driverLabel ? { driverLabel: m.driverLabel } : {}),
        ...(profileId ? { profileId } : {}),
        ...(profileName ? { profileName } : {}),
        providerIds: [...m.providerIds].sort(),
        claimsWithoutToolCall: claimsByGroup.get(group) ?? 0,
        ...tokens(m),
      };
    })
    .sort((a, b) => b.inputTokens - a.inputTokens);
  const accountLabel = (platform: string | undefined, endpoint: string | undefined) => {
    if (!options.resolveAccount || !platform || !endpoint) return undefined;
    let label: string | undefined;
    try { label = text(options.resolveAccount(platform, endpoint)); } catch { return undefined; }
    // An account whose name is just its raw endpoint id adds nothing next to `endpoint`.
    return label && label !== endpoint ? label : undefined;
  };
  const scheduleLabel = (jobId: string | undefined) => {
    if (!options.resolveScheduleJob || !jobId) return undefined;
    try { return sanitizeSessionText(options.resolveScheduleJob(jobId)); } catch { return undefined; }
  };
  const rankedSessions = [...sessions.entries()].sort(([, a], [, b]) => b.input - a.input);
  const others = { ...tally(), sessions: 0, turns: 0 };
  for (const [, s] of rankedSessions.slice(USAGE_STATS_SESSION_LIMIT)) {
    others.sessions++; others.turns += s.turns;
    others.calls += s.calls; others.input += s.input; others.output += s.output; others.cache += s.cache; others.cacheWrite += s.cacheWrite;
  }
  const byInput = <T extends { inputTokens: number; calls: number }>(a: T, b: T) => b.inputTokens - a.inputTokens || b.calls - a.calls;
  return {
    schemaVersion: USAGE_STATS_SCHEMA_VERSION,
    range: { since, until, bucket, timeZone },
    totals: {
      turns,
      ...tokens(total),
      cacheShareByCall: { p50: nearestRank(callShares, 50), p90: nearestRank(callShares, 90) },
      inputBasis: 'reported-all-calls',
      claimsWithoutToolCall,
      unexecutedToolNotices,
    },
    byModel,
    bySession: rankedSessions
      .slice(0, USAGE_STATS_SESSION_LIMIT)
      .map(([sessionKey, s]) => {
        const parsed = sessionAddressOf(sessionKey);
        const label = accountLabel(s.platform ?? parsed.platform, s.endpoint);
        // A scheduled job's session is named after the job's label when the instance still knows it (#1250 b63).
        const jobLabel = s.parts?.scopeKind === 'schedule' ? scheduleLabel(s.jobId) : undefined;
        const displayName = jobLabel ? formatSessionDisplayName(undefined, { scopeKind: 'schedule', sceneLabel: jobLabel }) : s.displayName;
        const sceneLabel = jobLabel ?? s.parts?.sceneLabel;
        return {
          sessionKey, ...parsed,
          // Hashed keys (`personal-session:v1:…`) carry no address: take the platform from the recorded origin.
          ...(!parsed.platform && s.platform ? { platform: s.platform } : {}),
          ...(displayName ? { displayName } : {}),
          ...(s.parts?.scopeKind ? { scopeKind: s.parts.scopeKind } : {}),
          ...(sceneLabel ? { sceneLabel } : {}),
          shortKey: shortSessionKey(sessionKey),
          ...(s.endpoint ? { endpoint: s.endpoint } : {}),
          ...(label ? { accountLabel: label } : {}),
          turns: s.turns, ...tokens(s),
        };
      }),
    sessionsTotal: sessions.size,
    othersTotals: { sessions: others.sessions, turns: others.turns, ...tokens(others) },
    byAgent: [...agents.entries()]
      .map(([agent, a]) => ({
        agent,
        label: agent === USAGE_MAIN_AGENT_KEY ? '主助手' : agent === USAGE_UNRECORDED_KEY ? '未记录' : agent,
        kind: a.kind, turns: a.turns, ...tokens(a),
      }))
      .sort(byInput),
    byPurpose: [...purposes.entries()]
      .map(([purpose, p]) => ({ purpose, label: usagePurposeLabel(purpose), turns: p.turns, ...tokens(p) }))
      .sort(byInput),
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
    promptCacheHints: cacheProbe.hints(),
  };
}
