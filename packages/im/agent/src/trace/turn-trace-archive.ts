/**
 * Persistent TurnTrace archive (#728 M1.2): one JSONL file per UTC day under
 * `data/agent-traces/`, with a retention period (default 7 days), a total
 * size cap, and a redaction pass on write. Written by the running bot; read by
 * `zhin trace` and the Console trace page, so nobody has to open bot.db.
 *
 * It implements {@link TurnTraceStore}, so it drops in where the recent-N
 * `recent.json` store was used. That legacy file is still read as a fallback.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectEnvironmentSecrets } from '../security/outbound-leak-guard.js';
import { scrubSecrets, type TurnTrace } from './turn-trace.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TRACE_MAX_BYTES } from './request-trace.js';
import { projectProviderDiagnostics } from '@zhin.js/ai';
import type { TurnTraceStore } from './turn-trace-store.js';
import type { ToolInvocationOrigin } from '@zhin.js/tool';
import { turnOriginKey, turnOriginLabelOf, withScheduleJobLabel, type TurnOriginLabel } from './turn-origin-label.js';

export const DEFAULT_TRACE_RETENTION_DAYS = 7;
export { DEFAULT_TRACE_MAX_BYTES } from './request-trace.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface TurnTraceQuery {
  /** Exact session key. */
  readonly sessionKey?: string;
  /** Epoch ms, inclusive, on `started_at`. */
  readonly since?: number;
  /** Epoch ms, exclusive, on `started_at`. */
  readonly until?: number;
  /** Newest N matching traces (returned oldest first). */
  readonly limit?: number;
}

/** At most this many chats in {@link TurnTraceSessionSummary.conversations} (most recent first). */
export const TURN_TRACE_SESSION_CONVERSATION_LIMIT = 10;

/**
 * Readable name of a session or chat in the session summary's snake_case style (#1250 b63): the
 * parts of {@link TurnOriginLabel}. All absent without a recorded origin (older traces).
 */
export interface TurnTraceSessionLabelFields {
  /** IM platform (client adapter) of the chat. */
  readonly platform?: string;
  /** `private` / `group` / `channel`; otherwise the origin kind (`schedule`, `http`, `a2a`, `mcp`, `internal`). */
  readonly scope_kind?: string;
  /** Group / channel name, the private peer's display name, else the raw id; a schedule job's label or id. */
  readonly scene_label?: string;
  /** Pre-built Chinese name: `sandbox · 私聊 · Developer`, `定时任务 · 每日早报`. */
  readonly display_name?: string;
}

/** One chat a session's turns came from (#1250 b63). */
export interface TurnTraceSessionConversation extends TurnTraceSessionLabelFields {
  /** Origin recorded by the chat's latest turn. */
  readonly origin: ToolInvocationOrigin;
  readonly turns: number;
  readonly last_started_at: number;
}

export interface TurnTraceSessionSummary extends TurnTraceSessionLabelFields {
  readonly session_key: string;
  readonly turns: number;
  readonly first_started_at: number;
  readonly last_started_at: number;
  readonly last_status: string;
  readonly total_tokens: number;
  /**
   * Origin of the session's latest turn that recorded one (#1250 b63), same shape as a trace's
   * `origin`; absent when no turn in range did (older traces).
   */
  readonly origin?: ToolInvocationOrigin;
  /**
   * Only when the session's turns came from more than one chat: each chat, most recent first, at
   * most {@link TURN_TRACE_SESSION_CONVERSATION_LIMIT}.
   */
  readonly conversations?: readonly TurnTraceSessionConversation[];
  /** Number of chats when {@link conversations} was cut to its limit. */
  readonly conversations_total?: number;
}

/** {@link TurnOriginLabel} as the session summary's snake_case fields. */
export function sessionLabelFields(label: TurnOriginLabel): TurnTraceSessionLabelFields {
  return {
    ...(label.platform ? { platform: label.platform } : {}),
    ...(label.scopeKind ? { scope_kind: label.scopeKind } : {}),
    ...(label.sceneLabel ? { scene_label: label.sceneLabel } : {}),
    ...(label.displayName ? { display_name: label.displayName } : {}),
  };
}

function labelOfSessionFields(row: TurnTraceSessionLabelFields): TurnOriginLabel {
  return {
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.scope_kind ? { scopeKind: row.scope_kind } : {}),
    ...(row.scene_label ? { sceneLabel: row.scene_label } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
  };
}

/**
 * Names schedule sessions (and their chats) after the job's label; `resolve` maps a job id to it
 * (undefined: the job is gone or unlabelled, the id stays).
 */
export function withSessionScheduleLabels(
  sessions: readonly TurnTraceSessionSummary[], resolve: (jobId: string) => string | undefined,
): TurnTraceSessionSummary[] {
  const relabel = <T extends TurnTraceSessionLabelFields & { readonly origin?: ToolInvocationOrigin }>(row: T): T => {
    if (row.scope_kind !== 'schedule') return row;
    const { platform: _p, scope_kind: _k, scene_label: _s, display_name: _d, ...rest } = row;
    return { ...rest, ...sessionLabelFields(withScheduleJobLabel(labelOfSessionFields(row), row.origin, resolve)) } as T;
  };
  return sessions.map(session => {
    const named = relabel(session);
    return session.conversations ? { ...named, conversations: session.conversations.map(relabel) } : named;
  });
}

export interface TurnTraceArchive extends TurnTraceStore {
  query(query?: TurnTraceQuery): Promise<readonly TurnTrace[]>;
  sessions(query?: Omit<TurnTraceQuery, 'sessionKey'>): Promise<readonly TurnTraceSessionSummary[]>;
  /** Delete expired records, then oldest complete records until under the hard size cap. */
  prune(): Promise<readonly string[]>;
}

export interface TurnTraceArchiveOptions {
  readonly retentionDays?: number;
  readonly maxBytes?: number;
  /** Exact values masked on write (default: secret-looking environment variables). */
  readonly secrets?: readonly string[];
  readonly now?: () => number;
  /** Legacy recent-N file read as a fallback (traces not yet in the archive). */
  readonly legacyFile?: string;
}

export function defaultTurnTraceDir(projectRoot: string): string {
  return join(projectRoot, 'data', 'agent-traces');
}

export function createTurnTraceArchive(dir: string, options: TurnTraceArchiveOptions = {}): TurnTraceArchive {
  const retentionDays = positive(options.retentionDays, DEFAULT_TRACE_RETENTION_DAYS);
  const maxBytes = positive(options.maxBytes, DEFAULT_TRACE_MAX_BYTES);
  const now = options.now ?? Date.now;
  const secrets = [...(options.secrets ?? collectEnvironmentSecrets())].filter(Boolean).sort((a, b) => b.length - a.length);
  let tail: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };

  const dayFiles = async (): Promise<string[]> => {
    try {
      return (await readdir(dir)).filter((name) => DAY_FILE.test(name)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };

  const readDay = async (name: string): Promise<TurnTrace[]> => {
    let raw: string;
    try {
      raw = await readFile(join(dir, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const traces: TurnTrace[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as TurnTrace;
        if (parsed && typeof parsed.turn_id === 'string') traces.push(parsed);
      } catch {
        // A torn last line (crash mid-append) must not hide the rest of the day.
      }
    }
    return traces;
  };

  const readLegacy = async (): Promise<TurnTrace[]> => {
    if (!options.legacyFile) return [];
    let raw: string;
    try { raw = await readFile(options.legacyFile, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const parsed = JSON.parse(raw) as { traces?: TurnTrace[] };
    if (!Array.isArray(parsed.traces)) throw new Error('Invalid legacy trace archive');
    return parsed.traces;
  };

  const writeDay = async (name: string, traces: readonly TurnTrace[]): Promise<void> => {
    if (!traces.length) { await rm(join(dir, name), { force: true }); return; }
    const path = join(dir, name);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, traces.map(trace => JSON.stringify(trace)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  };

  // One composition-root writer owns this archive across generations. API/CLI instances only read.
  // Import legacy records before enforcing capacity, so removed records cannot reappear via fallback.
  const migrateLegacy = async (): Promise<void> => {
    const legacy = await readLegacy();
    if (!options.legacyFile) return;
    const byDay = new Map<string, TurnTrace[]>();
    for (const trace of legacy) {
      const name = `${dayKey(trace.started_at)}.jsonl`;
      const rows = byDay.get(name) ?? [];
      rows.push(redactStrings(trace, secrets));
      byDay.set(name, rows);
    }
    await mkdir(dir, { recursive: true });
    for (const [name, rows] of byDay) {
      const all = new Map(rows.map(trace => [trace.turn_id, trace]));
      for (const trace of await readDay(name)) all.set(trace.turn_id, trace);
      await writeDay(name, [...all.values()].sort((a, b) => a.started_at - b.started_at));
    }
    // All canonical writes succeeded. A failure above preserves the only remaining source.
    await rm(options.legacyFile, { force: true });
  };

  /** All traces oldest first; a re-saved turn keeps its latest record. */
  const readAll = async (days?: readonly string[]): Promise<TurnTrace[]> => {
    const byId = new Map<string, TurnTrace>();
    for (const trace of await readLegacy()) byId.set(trace.turn_id, trace);
    for (const name of days ?? await dayFiles()) {
      for (const trace of await readDay(name)) {
        byId.delete(trace.turn_id);
        byId.set(trace.turn_id, trace);
      }
    }
    return [...byId.values()].sort((a, b) => a.started_at - b.started_at);
  };

  const query = async (q: TurnTraceQuery = {}): Promise<readonly TurnTrace[]> => {
    const sinceDay = q.since === undefined ? undefined : dayKey(q.since);
    const untilDay = q.until === undefined ? undefined : dayKey(q.until);
    const days = (await dayFiles()).filter((name) => {
      const day = name.slice(0, 10);
      return (sinceDay === undefined || day >= sinceDay) && (untilDay === undefined || day <= untilDay);
    });
    const cutoff = now() - retentionDays * DAY_MS;
    const matching = (await readAll(days)).filter((trace) => trace.started_at >= cutoff
      && (q.sessionKey === undefined || trace.session_key === q.sessionKey)
      && (q.since === undefined || trace.started_at >= q.since)
      && (q.until === undefined || trace.started_at < q.until));
    const limit = positive(q.limit, Number.POSITIVE_INFINITY);
    return Number.isFinite(limit) ? matching.slice(-limit) : matching;
  };

  const pruneToFit = async (reservedBytes = 0, reservedStartedAt = Number.POSITIVE_INFINITY): Promise<{ deleted: readonly string[]; accepted: boolean }> => {
    let accepted = true;
    const deleted: string[] = [];
    const cutoff = now() - retentionDays * DAY_MS;
    const cutoffDay = dayKey(cutoff);
    const kept: Array<{ name: string; size: number }> = [];
    for (const name of await dayFiles()) {
      if (name.slice(0, 10) < cutoffDay) {
        await rm(join(dir, name));
        deleted.push(name);
        continue;
      }
      if (name.startsWith(cutoffDay)) {
        const original = await readDay(name);
        const live = original.filter(trace => trace.started_at >= cutoff);
        if (live.length !== original.length) await writeDay(name, live);
        if (!live.length) { deleted.push(name); continue; }
      }
      kept.push({ name, size: (await stat(join(dir, name))).size });
    }
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    for (const file of kept) {
      if (total + reservedBytes <= maxBytes) break;
      const traces = await readDay(file.name);
      const retained = traces.sort((a, b) => a.started_at - b.started_at);
      let size = retained.reduce((sum, trace) => sum + lineBytes(trace), 0);
      while (retained.length && total - file.size + size + reservedBytes > maxBytes) {
        if (reservedBytes && retained[0]!.started_at > reservedStartedAt) {
          // A turn that completes late is still older than later-started turns already archived.
          reservedBytes = 0;
          accepted = false;
        } else size -= lineBytes(retained.shift()!);
      }
      await writeDay(file.name, retained);
      total += size - file.size;
      if (!retained.length) deleted.push(file.name);
    }
    return { deleted, accepted };
  };
  const prune = (): Promise<readonly string[]> => serialize(async () => {
    await migrateLegacy();
    return (await pruneToFit()).deleted;
  });

  return Object.freeze({
    maxBytes,
    save(trace: TurnTrace): Promise<void> {
      return serialize(async () => {
        await mkdir(dir, { recursive: true });
        await migrateLegacy();
        const record = fitTrace(redactStrings(trace, secrets), maxBytes - 1);
        const bytes = lineBytes(record) + 1;
        if (bytes > maxBytes) throw new Error('Trace metadata exceeds archive capacity');
        if (record.started_at < now() - retentionDays * DAY_MS) { await pruneToFit(); return; }
        if (!(await pruneToFit(bytes, record.started_at)).accepted) return;
        // Leading newline isolates this complete record from a possible crash-torn last line.
        await appendFile(join(dir, `${dayKey(record.started_at || now())}.jsonl`), `\n${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      });
    },
    list: () => query(),
    async latest() {
      return (await query()).at(-1);
    },
    async find(turnId: string) {
      const traces = await query();
      const exact = traces.find((trace) => trace.turn_id === turnId);
      if (exact) return exact;
      const matches = traces.filter((trace) => trace.turn_id.startsWith(turnId));
      return matches.length === 1 ? matches[0] : undefined;
    },
    query,
    async sessions(q = {}) {
      return summarizeTraceSessions(await query(q));
    },
    prune,
  });
}

type MutableSessionConversation = { origin: ToolInvocationOrigin; label: TurnOriginLabel; turns: number; last_started_at: number };
type MutableSessionSummary = {
  -readonly [K in keyof Omit<TurnTraceSessionSummary, 'conversations' | 'conversations_total' | keyof TurnTraceSessionLabelFields>]: TurnTraceSessionSummary[K]
} & { label?: TurnOriginLabel; chats: Map<string, MutableSessionConversation> };

/** Per-session summaries of traces (oldest first), newest session first. */
export function summarizeTraceSessions(traces: Iterable<TurnTrace>): TurnTraceSessionSummary[] {
  const bySession = new Map<string, MutableSessionSummary>();
  for (const trace of traces) {
    const summary: MutableSessionSummary = bySession.get(trace.session_key) ?? {
      session_key: trace.session_key, turns: 0, first_started_at: trace.started_at,
      last_started_at: trace.started_at, last_status: 'unknown', total_tokens: 0, chats: new Map(),
    };
    summary.turns++;
    summary.last_started_at = trace.started_at;
    summary.last_status = trace.termination?.status ?? 'unknown';
    summary.total_tokens += trace.usage?.total_tokens ?? 0;
    const key = turnOriginKey(trace.origin);
    if (trace.origin && key) {
      const label = turnOriginLabelOf(trace.origin, trace.principal?.display_name);
      // A later trace without an origin keeps the last recorded one.
      summary.origin = trace.origin;
      summary.label = label;
      const chat = summary.chats.get(key);
      summary.chats.delete(key);
      summary.chats.set(key, { origin: trace.origin, label, turns: (chat?.turns ?? 0) + 1, last_started_at: trace.started_at });
    }
    bySession.set(trace.session_key, summary);
  }
  return [...bySession.values()].map(({ chats, label, ...rest }) => {
    const summary: TurnTraceSessionSummary = { ...rest, ...(label ? sessionLabelFields(label) : {}) };
    if (chats.size <= 1) return summary;
    const conversations = [...chats.values()].reverse()
      .map(({ label: chatLabel, ...chat }) => ({ ...chat, ...sessionLabelFields(chatLabel) }));
    return {
      ...summary,
      conversations: conversations.slice(0, TURN_TRACE_SESSION_CONVERSATION_LIMIT),
      ...(conversations.length > TURN_TRACE_SESSION_CONVERSATION_LIMIT ? { conversations_total: conversations.length } : {}),
    };
  }).sort((a, b) => b.last_started_at - a.last_started_at);
}

function lineBytes(trace: TurnTrace): number { return Buffer.byteLength(JSON.stringify(trace)) + 1; }

/** Keep complete request bodies where they fit; never present truncated text as a captured request. */
function fitTrace(trace: TurnTrace, maxBytes: number): TurnTrace {
  if (lineBytes(trace) <= maxBytes) return trace;
  const bodies: Array<{ id: string; bytes: number }> = [];
  const visit = (turn: TurnTrace) => {
    for (const request of turn.requests ?? []) if (request.body) bodies.push({ id: request.request_id, bytes: Buffer.byteLength(JSON.stringify(request.body)) });
    turn.subagents.forEach(visit);
  };
  visit(trace);
  const removed = new Set<string>();
  const project = (turn: TurnTrace): TurnTrace => ({ ...turn,
    ...(turn.requests ? { requests: turn.requests.map(request => {
      if (!removed.has(request.request_id)) return request;
      const { body: _body, ...rest } = request;
      return { ...rest, body_status: 'too_large' as const };
    }) } : {}),
    subagents: turn.subagents.map(project),
  });
  let result = trace;
  for (const body of bodies.sort((a, b) => b.bytes - a.bytes)) {
    removed.add(body.id);
    result = project(trace);
    if (lineBytes(result) <= maxBytes) break;
  }
  return result;
}

/** UTC day key `YYYY-MM-DD` for an epoch ms. */
export function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Second redaction pass on write: inline credential patterns and exact secret values in every string. */
export function redactStrings<T>(value: T, secrets: readonly string[] = []): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      let text = scrubSecrets(item);
      for (const secret of secrets) if (text.includes(secret)) text = text.split(secret).join('[redacted]');
      return text;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)]));
    }
    return item;
  };
  return visit(projectProviderDiagnostics(value)) as T;
}

/**
 * Retention / size overrides from the environment:
 * `ZHIN_TRACE_RETENTION_DAYS` and `ZHIN_TRACE_MAX_MB`.
 */
export function resolveTraceArchiveOptions(env: Readonly<Record<string, string | undefined>> = process.env): Pick<TurnTraceArchiveOptions, 'retentionDays' | 'maxBytes'> {
  const days = Number(env.ZHIN_TRACE_RETENTION_DAYS);
  const mb = Number(env.ZHIN_TRACE_MAX_MB);
  return {
    ...(Number.isFinite(days) && days > 0 ? { retentionDays: days } : {}),
    ...(Number.isFinite(mb) && mb > 0 ? { maxBytes: Math.round(mb * 1024 * 1024) } : {}),
  };
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
