/**
 * Persistent TurnTrace archive (#728 M1.2): one JSONL file per UTC day under
 * `data/agent-traces/`, with a retention period (default 7 days), a total
 * size cap, and a redaction pass on write. Written by the running bot; read by
 * `zhin trace` and the Console trace page, so nobody has to open bot.db.
 *
 * It implements {@link TurnTraceStore}, so it drops in where the recent-N
 * `recent.json` store was used. That legacy file is still read as a fallback.
 */
import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectEnvironmentSecrets } from '../security/outbound-leak-guard.js';
import { scrubSecrets, type TurnTrace } from './turn-trace.js';
import type { TurnTraceStore } from './turn-trace-store.js';

export const DEFAULT_TRACE_RETENTION_DAYS = 7;
export const DEFAULT_TRACE_MAX_BYTES = 64 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
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

export interface TurnTraceSessionSummary {
  readonly session_key: string;
  readonly turns: number;
  readonly first_started_at: number;
  readonly last_started_at: number;
  readonly last_status: string;
  readonly total_tokens: number;
}

export interface TurnTraceArchive extends TurnTraceStore {
  query(query?: TurnTraceQuery): Promise<readonly TurnTrace[]>;
  sessions(query?: Omit<TurnTraceQuery, 'sessionKey'>): Promise<readonly TurnTraceSessionSummary[]>;
  /** Delete day files past retention, then oldest days until under the size cap. Returns deleted file names. */
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
  let lastPrune = Number.NEGATIVE_INFINITY;

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
    } catch {
      return [];
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
    try {
      const parsed = JSON.parse(await readFile(options.legacyFile, 'utf8')) as { traces?: TurnTrace[] };
      return Array.isArray(parsed.traces) ? parsed.traces : [];
    } catch {
      return [];
    }
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
    const matching = (await readAll(days)).filter((trace) =>
      (q.sessionKey === undefined || trace.session_key === q.sessionKey)
      && (q.since === undefined || trace.started_at >= q.since)
      && (q.until === undefined || trace.started_at < q.until));
    const limit = positive(q.limit, Number.POSITIVE_INFINITY);
    return Number.isFinite(limit) ? matching.slice(-limit) : matching;
  };

  const prune = (): Promise<readonly string[]> => serialize(async () => {
    lastPrune = now();
    const deleted: string[] = [];
    const cutoff = dayKey(now() - retentionDays * DAY_MS);
    const files = await dayFiles();
    const kept: Array<{ name: string; size: number }> = [];
    for (const name of files) {
      if (name.slice(0, 10) < cutoff) {
        await rm(join(dir, name), { force: true });
        deleted.push(name);
      } else {
        kept.push({ name, size: (await stat(join(dir, name)).catch(() => ({ size: 0 }))).size });
      }
    }
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    // Never delete today's file for size: it is the one being written.
    while (total > maxBytes && kept.length > 1) {
      const oldest = kept.shift()!;
      await rm(join(dir, oldest.name), { force: true });
      deleted.push(oldest.name);
      total -= oldest.size;
    }
    return deleted;
  });

  return Object.freeze({
    async save(trace: TurnTrace): Promise<void> {
      await serialize(async () => {
        await mkdir(dir, { recursive: true });
        const line = JSON.stringify(redactStrings(trace, secrets));
        await appendFile(join(dir, `${dayKey(trace.started_at || now())}.jsonl`), `${line}\n`, 'utf8');
      });
      if (now() - lastPrune >= PRUNE_INTERVAL_MS) await prune();
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
      const bySession = new Map<string, TurnTraceSessionSummary>();
      for (const trace of await query(q)) {
        const previous = bySession.get(trace.session_key);
        bySession.set(trace.session_key, {
          session_key: trace.session_key,
          turns: (previous?.turns ?? 0) + 1,
          first_started_at: previous?.first_started_at ?? trace.started_at,
          last_started_at: trace.started_at,
          last_status: trace.termination?.status ?? 'unknown',
          total_tokens: (previous?.total_tokens ?? 0) + (trace.usage?.total_tokens ?? 0),
        });
      }
      return [...bySession.values()].sort((a, b) => b.last_started_at - a.last_started_at);
    },
    prune,
  });
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
  return visit(value) as T;
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
