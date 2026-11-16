/**
 * Instance runtime failure journal (`.zhin/runtime-failures.json`, #1270).
 *
 * Keeps the latest failure of each subject — an inference account's preparation, a model call, an
 * Endpoint start, an MCP connect — until that subject succeeds again, so the Console and the
 * attention inbox can still say why after the instance restarts. Entries loaded from the file are
 * marked `restored` (「重启前记录」) until observed again in this process.
 *
 * Only the instance writes it (atomically: temp file + rename); it never touches the gateway's
 * `.zhin/gateway.db` (ADR 0059). Messages are redacted with {@link attentionFailureReason}; no
 * entry carries a credential, an upstream body, a URL with user info or an absolute path.
 */
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RUNTIME_FAILURES_FILE,
  type ConsoleRuntimeFailure,
  type ConsoleRuntimeFailureJournal,
  type ConsoleRuntimeFailureSource,
} from '@zhin.js/console-protocol';
import { attentionFailureReason } from './attention.js';

const SOURCES: ReadonlySet<string> = new Set(['account', 'endpoint', 'mcp', 'model']);
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
/** Bound on the file: the oldest entries are dropped first. */
export const MAX_RUNTIME_FAILURES = 500;
/** How long an Endpoint / MCP subject may be missing from its list before its entry is dropped. */
export const RUNTIME_FAILURE_ABSENT_GRACE_MS = 10 * 60_000;

export interface RuntimeFailureReport {
  readonly source: ConsoleRuntimeFailureSource;
  readonly subject: string;
  readonly code: string;
  readonly category: string;
  readonly message: string;
  readonly step?: string;
  readonly reason?: string;
  readonly upstreamStatus?: number;
  readonly credentialRevision?: number;
  /**
   * Epoch ms of the observation. A report whose `at` equals the entry's `lastAt` is the same
   * observation seen again (polled sources) and changes nothing.
   */
  readonly at?: number;
}

export type RuntimeFailureEntry = ConsoleRuntimeFailure & {
  /** Loaded from the file and not observed again since this instance started (「重启前记录」). */
  readonly restored?: boolean;
};

export interface RuntimeFailureJournalOptions {
  readonly now?: () => number;
  /** Receives write failures (the journal never throws to its callers). */
  readonly warn?: (message: string) => void;
}

const key = (source: string, subject: string) => `${source}\u0000${subject}`;
const code = (value: unknown): string | undefined => typeof value === 'string' && CODE.test(value) ? value : undefined;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Validates one stored entry; anything malformed is dropped rather than trusted. */
function parseEntry(value: unknown): ConsoleRuntimeFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const source = typeof raw.source === 'string' && SOURCES.has(raw.source) ? raw.source as ConsoleRuntimeFailureSource : undefined;
  const subject = typeof raw.subject === 'string' && raw.subject && raw.subject.length <= 512 ? raw.subject : undefined;
  const entryCode = code(raw.code);
  const category = code(raw.category);
  const firstAt = count(raw.firstAt);
  const lastAt = count(raw.lastAt);
  const observations = count(raw.count);
  if (!source || !subject || !entryCode || !category || firstAt === undefined || lastAt === undefined || !observations) return undefined;
  const step = code(raw.step);
  const reason = code(raw.reason);
  const status = count(raw.upstreamStatus);
  const revision = count(raw.credentialRevision);
  return Object.freeze({
    source, subject, code: entryCode, category,
    message: attentionFailureReason(typeof raw.message === 'string' ? raw.message : entryCode),
    ...(step ? { step } : {}),
    ...(reason ? { reason } : {}),
    ...(status !== undefined && status >= 100 && status <= 599 ? { upstreamStatus: status } : {}),
    ...(revision !== undefined ? { credentialRevision: revision } : {}),
    firstAt, lastAt, count: observations,
  });
}

/** Reads `.zhin/runtime-failures.json`; a missing or unreadable file is an empty journal. */
export function readRuntimeFailureFile(file: string): readonly ConsoleRuntimeFailure[] {
  let text: string;
  try {
    // Never follow a planted link out of `.zhin/`.
    if (!lstatSync(file).isFile()) return [];
    text = readFileSync(file, 'utf8');
  } catch { return []; }
  try {
    const document = JSON.parse(text) as Partial<ConsoleRuntimeFailureJournal>;
    if (!document || document.version !== 1 || !Array.isArray(document.entries)) return [];
    return document.entries.map(parseEntry).filter((entry): entry is ConsoleRuntimeFailure => !!entry);
  } catch {
    return [];
  }
}

export class RuntimeFailureJournal {
  readonly file: string;
  readonly #entries = new Map<string, RuntimeFailureEntry>();
  /** When each entry's subject was first seen missing by {@link retain} (process-local). */
  readonly #absentSince = new Map<string, number>();
  readonly #now: () => number;
  readonly #warn: (message: string) => void;
  #writing: Promise<void> | undefined;
  #dirty = false;
  #closed = false;

  /** Loads the project's journal synchronously (instance start-up). */
  static open(projectRoot: string, options: RuntimeFailureJournalOptions = {}): RuntimeFailureJournal {
    return new RuntimeFailureJournal(join(projectRoot, RUNTIME_FAILURES_FILE), options);
  }

  constructor(file: string, options: RuntimeFailureJournalOptions = {}) {
    this.file = file;
    this.#now = options.now ?? Date.now;
    this.#warn = options.warn ?? (() => undefined);
    for (const entry of readRuntimeFailureFile(file)) {
      this.#entries.set(key(entry.source, entry.subject), Object.freeze({ ...entry, restored: true }));
    }
  }

  /** Records one failure observation; never throws. */
  record(report: RuntimeFailureReport): void {
    if (this.#closed || !SOURCES.has(report.source) || !report.subject) return;
    const entryCode = code(report.code) ?? 'unknown';
    const at = count(report.at) ?? this.#now();
    const id = key(report.source, report.subject);
    const previous = this.#entries.get(id);
    // Polled sources report the same failed attempt again and again: no `at`, or the same one, with the same code.
    if (previous && previous.code === entryCode && !previous.restored
      && (report.at === undefined ? report.source === 'endpoint' || report.source === 'mcp' : previous.lastAt === at)) return;
    const step = code(report.step);
    const reason = code(report.reason);
    const status = count(report.upstreamStatus);
    const revision = count(report.credentialRevision);
    // A different failure (code / revision) of the same subject starts a new run of observations.
    const same = previous && previous.code === entryCode && previous.credentialRevision === revision;
    const entry: RuntimeFailureEntry = Object.freeze({
      source: report.source,
      subject: report.subject.slice(0, 512),
      code: entryCode,
      category: code(report.category) ?? 'unknown',
      message: attentionFailureReason(report.message || entryCode),
      ...(step ? { step } : {}),
      ...(reason ? { reason } : {}),
      ...(status !== undefined && status >= 100 && status <= 599 ? { upstreamStatus: status } : {}),
      ...(revision !== undefined ? { credentialRevision: revision } : {}),
      firstAt: same ? previous.firstAt : at,
      lastAt: at,
      count: same ? previous.count + 1 : 1,
    });
    this.#entries.delete(id);
    this.#entries.set(id, entry);
    while (this.#entries.size > MAX_RUNTIME_FAILURES) this.#entries.delete(this.#entries.keys().next().value!);
    this.#schedule();
  }

  /** Forgets the subject's failure after a success; never throws. */
  clear(source: ConsoleRuntimeFailureSource, subject: string): void {
    this.#absentSince.delete(key(source, subject));
    if (this.#entries.delete(key(source, subject))) this.#schedule();
  }

  /**
   * Forgets entries of `source` whose subject `keep` rejects. With `graceMs` (default
   * {@link RUNTIME_FAILURE_ABSENT_GRACE_MS}) an entry goes only after its subject has been missing
   * for that long without interruption, so a subject that briefly drops out of its list (a hot
   * reload, an Agent generation switch) keeps its reason, 「重启前记录」 included. `graceMs: 0`
   * forgets at once (a subject known to be removed, e.g. an account deleted from the graph).
   */
  retain(source: ConsoleRuntimeFailureSource, keep: (subject: string) => boolean, options: Readonly<{ graceMs?: number }> = {}): void {
    const grace = options.graceMs ?? RUNTIME_FAILURE_ABSENT_GRACE_MS;
    const now = this.#now();
    let changed = false;
    for (const [id, entry] of this.#entries) {
      if (entry.source !== source) continue;
      if (keep(entry.subject)) { this.#absentSince.delete(id); continue; }
      const since = this.#absentSince.get(id) ?? now;
      if (grace > 0 && now - since < grace) { this.#absentSince.set(id, since); continue; }
      this.#entries.delete(id);
      this.#absentSince.delete(id);
      changed = true;
    }
    if (changed) this.#schedule();
  }

  get(source: ConsoleRuntimeFailureSource, subject: string): RuntimeFailureEntry | undefined {
    return this.#entries.get(key(source, subject));
  }

  list(source?: ConsoleRuntimeFailureSource): readonly RuntimeFailureEntry[] {
    const entries = [...this.#entries.values()];
    return Object.freeze(source ? entries.filter(entry => entry.source === source) : entries);
  }

  /** Resolves once every change so far is on disk. */
  async flush(): Promise<void> {
    while (this.#writing) await this.#writing;
  }

  /** Writes pending changes and stops accepting new ones. */
  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#writing) return;
    this.#writing = (async () => {
      try {
        while (this.#dirty) {
          this.#dirty = false;
          await this.#write();
        }
      } finally {
        this.#writing = undefined;
      }
    })();
  }

  async #write(): Promise<void> {
    const entries = [...this.#entries.values()].map(({ restored: _restored, ...entry }) => entry);
    const document: ConsoleRuntimeFailureJournal = { version: 1, entries };
    // Unpredictable name, created exclusively (`wx`): a pre-placed file or link is never written through.
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await assertNotLink(this.file);
      if (!entries.length) {
        await rm(this.file, { force: true });
        return;
      }
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      this.#warn(`runtime failure journal not written: ${attentionFailureReason(error)}`);
    }
  }
}

/** Refuses a journal path that is a symbolic link (or anything but a regular file); a missing file is fine. */
async function assertNotLink(file: string): Promise<void> {
  let info;
  try { info = await lstat(file); } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return;
    throw error;
  }
  if (!info.isFile()) throw new Error(`${RUNTIME_FAILURES_FILE} is not a regular file (symbolic link refused)`);
}

// ---------------------------------------------------------------- polled sources

/** One Endpoint row as the sync needs it (`im.endpoints.list()`). */
export interface RuntimeFailureEndpointRow {
  readonly adapter: string;
  readonly name: string;
  readonly connected: boolean;
  readonly lastError?: Readonly<{ category: string; message: string; at?: number }>;
}

/** One MCP status row as the sync needs it (`listMcpServerStatus`). */
export interface RuntimeFailureMcpRow {
  readonly name: string;
  readonly connected: boolean;
  readonly lastError?: Readonly<{ category: string; message: string; at?: number; exitCode?: number }>;
}

/** `<adapter>/<name>`: the Endpoint subject of the journal. */
export const endpointFailureSubject = (adapter: string, name: string) => `${adapter}/${name}`;

/**
 * Mirrors the Endpoint start failures into the journal: a failed row records (once per failed
 * attempt), a connected row clears, a row missing from the list for longer than the grace period is forgotten. A row that is merely
 * offline without a new failure keeps its entry (its reason is still the latest one).
 */
export function syncEndpointFailures(journal: RuntimeFailureJournal, rows: readonly RuntimeFailureEndpointRow[]): void {
  const present = new Set<string>();
  for (const row of rows) {
    const subject = endpointFailureSubject(row.adapter, row.name);
    present.add(subject);
    if (row.connected) journal.clear('endpoint', subject);
    else if (row.lastError) {
      journal.record({ source: 'endpoint', subject, code: 'start-failed', category: row.lastError.category,
        message: row.lastError.message, ...(row.lastError.at === undefined ? {} : { at: row.lastError.at }) });
    }
  }
  journal.retain('endpoint', subject => present.has(subject));
}

/** Mirrors MCP connect failures into the journal, like {@link syncEndpointFailures}. */
export function syncMcpFailures(journal: RuntimeFailureJournal, rows: readonly RuntimeFailureMcpRow[]): void {
  const present = new Set<string>();
  for (const row of rows) {
    present.add(row.name);
    if (row.connected) journal.clear('mcp', row.name);
    else if (row.lastError) {
      journal.record({ source: 'mcp', subject: row.name, code: 'connect-failed', category: row.lastError.category,
        message: row.lastError.message, ...(row.lastError.at === undefined ? {} : { at: row.lastError.at }) });
    }
  }
  journal.retain('mcp', subject => present.has(subject));
}

export interface RuntimeFailureSyncOptions {
  readonly journal: RuntimeFailureJournal;
  /** Current Endpoint rows; may throw while the runtime is not ready (the round is skipped). */
  readonly endpoints?: () => readonly RuntimeFailureEndpointRow[];
  /** Current MCP rows; may throw while the runtime is not ready (the round is skipped). */
  readonly mcpServers?: () => readonly RuntimeFailureMcpRow[];
  /** Drops journaled account / model failures that are no longer current (`HostInference.pruneFailureJournal`). */
  readonly prune?: () => Promise<void>;
  /** Default 30 s. */
  readonly intervalMs?: number;
}

/** One sync round of the polled sources; a source that cannot be read is skipped. */
export function syncRuntimeFailures(options: Omit<RuntimeFailureSyncOptions, 'intervalMs'>): void {
  if (options.endpoints) {
    try { syncEndpointFailures(options.journal, options.endpoints()); } catch { /* not ready */ }
  }
  if (options.mcpServers) {
    try { syncMcpFailures(options.journal, options.mcpServers()); } catch { /* not ready */ }
  }
  if (options.prune) void options.prune().catch(() => undefined);
}

/** Mirrors the polled sources into the journal every `intervalMs` (unref'd); returns the stop function. */
export function startRuntimeFailureSync(options: RuntimeFailureSyncOptions): () => void {
  const timer = setInterval(() => syncRuntimeFailures(options), options.intervalMs ?? 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
