import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentRunEvent, AgentRunIdentity } from '@zhin.js/ai/agent-stream';
import type { JournalRunSummary, JournalStore } from '@zhin.js/ai/journal-store';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import type { StoredTurnResult, TurnDeliveryRecord, TurnDeliveryStore, TurnRecoveryIdentity, TurnResultCursor, TurnResultsPage } from './turn-delivery.js';
import { omitInlineMedia } from '../trace/request-trace.js';

const EVENT_FILE_WIDTH = 16;

function encodeIdentity(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeIdentity(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function eventFileName(sequence: number): string {
  return `${String(sequence).padStart(EVENT_FILE_WIDTH, '0')}.json`;
}

export class JournalCorruptionError extends Error {
  constructor(readonly path: string, cause?: unknown) {
    super(`Corrupt Agent Journal event ${path}`, { cause });
    this.name = 'JournalCorruptionError';
  }
}

export class JournalSequenceConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`Agent Journal sequence conflict: expected previous ${expected}, actual ${actual}`);
    this.name = 'JournalSequenceConflictError';
  }
}

/** Crash-safe file store: one atomically claimed file per run sequence. */
export class FileJournalStore implements JournalStore, TurnDeliveryStore {
  constructor(private readonly root: string) {}

  async append(event: AgentRunEvent, expectedPreviousSequence: number): Promise<void> {
    const directory = this.#runDirectory(event.run);
    await mkdir(directory, { recursive: true });
    const release = await acquireRunLease(directory);
    try {
      const actual = await this.#lastSequence(directory);
      if (actual !== expectedPreviousSequence || event.sequence !== actual + 1) {
        throw new JournalSequenceConflictError(expectedPreviousSequence, actual);
      }
      const committed = join(directory, eventFileName(event.sequence));
      const temporary = join(directory, `.event-${event.sequence}-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx');
      try {
        await handle.writeFile(JSON.stringify(event), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, committed);
      // Windows cannot flush an opened directory. The file itself was synced
      // before the atomic rename; POSIX additionally persists the directory entry.
      if (process.platform !== 'win32') {
        const directoryHandle = await open(directory, 'r');
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } finally {
      await release();
    }
  }

  async replay(run: AgentRunIdentity, afterSequence = 0): Promise<readonly AgentRunEvent[]> {
    const directory = this.#runDirectory(run);
    const files = await jsonFiles(directory);
    const events: AgentRunEvent[] = [];
    let expected = 1;
    let terminalSeen = false;
    for (const name of files) {
      const file = join(directory, name);
      let event: AgentRunEvent;
      try {
        event = JSON.parse(await readFile(file, 'utf8')) as AgentRunEvent;
      } catch (error) {
        throw new JournalCorruptionError(file, error);
      }
      if (event.sequence !== expected
        || event.run?.sessionId !== run.sessionId
        || event.run?.turnId !== run.turnId
        || name !== eventFileName(event.sequence)) {
        throw new JournalCorruptionError(file, new Error('event identity or sequence mismatch'));
      }
      if (terminalSeen) {
        throw new JournalCorruptionError(file, new Error('event exists after terminal'));
      }
      expected += 1;
      terminalSeen = Boolean(event.terminal);
      if (event.sequence > afterSequence) events.push(event);
    }
    return events;
  }

  async listRuns(sessionId: string): Promise<readonly JournalRunSummary[]> {
    const sessionDirectory = join(this.root, encodeIdentity(sessionId));
    let names: string[];
    try {
      names = await readdir(sessionDirectory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const summaries: JournalRunSummary[] = [];
    for (const name of names.sort()) {
      const turnId = decodeIdentity(name);
      const events = await this.replay({ sessionId, turnId });
      if (events.length === 0) continue;
      const first = events[0]!;
      const last = events.at(-1)!;
      summaries.push({
        run: { sessionId, turnId },
        eventCount: events.length,
        startedAt: first.timestamp ?? 0,
        endedAt: last.timestamp,
        terminal: last.terminal,
      });
    }
    return summaries;
  }

  /** Projection receipts live beside the immutable journal, never after its terminal sequence. */
  async recordRecoveryIdentity(identity: TurnRecoveryIdentity): Promise<void> {
    const directory = this.#runDirectory(identity.run);
    await mkdir(directory, { recursive: true });
    const release = await acquireRunLease(directory);
    try {
      const existing = await readRecoveryIdentity(directory);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(identity)) throw new Error('Turn recovery identity conflict');
        return;
      }
      await writeSidecar(directory, 'identity.recovery', identity);
    } finally { await release(); }
  }

  async recordDelivery(record: TurnDeliveryRecord): Promise<void> {
    const directory = this.#runDirectory(record.run);
    await mkdir(directory, { recursive: true });
    // Deliberately not a .json journal event: replay must remain terminal-closed.
    await writeSidecar(directory, `${randomUUID()}.delivery`, record);
  }

  async listResults(sessionId: string, subjectId: string, conversation: ConversationRef): Promise<readonly StoredTurnResult[]> {
    const candidates = await this.#resultCandidates(sessionId, subjectId, conversation);
    return Promise.all(candidates.sort(compareResultCandidates).map(candidate => this.#readResult(candidate)));
  }

  async readResultsPage(sessionId: string, subjectId: string, conversation: ConversationRef, before?: TurnResultCursor): Promise<TurnResultsPage> {
    const candidates = (await this.#resultCandidates(sessionId, subjectId, conversation))
      .filter(candidate => !before || compareResultCandidates(candidate, before) < 0)
      .sort((a, b) => compareResultCandidates(b, a));
    const selected = candidates.slice(0, 50);
    const hasMore = candidates.length > selected.length;
    const oldest = selected.at(-1);
    return { results: await Promise.all(selected.reverse().map(candidate => this.#readResult(candidate))), hasMore,
      nextCursor: hasMore && oldest ? { completedAt: oldest.completedAt, turnId: oldest.turnId } : null };
  }

  async #resultCandidates(sessionId: string, subjectId: string, conversation: ConversationRef): Promise<ResultCandidate[]> {
    let names: string[];
    try { names = await readdir(join(this.root, encodeIdentity(sessionId))); }
    catch (error) { if (isMissing(error)) return []; throw error; }
    const candidates: ResultCandidate[] = [];
    const matches = (identity: TurnRecoveryIdentity) => identity.run.sessionId === sessionId
      && identity.subjectId === subjectId && identity.origin?.conversation
      && conversationRefKey(identity.origin.conversation) === conversationRefKey(conversation);
    for (const name of names) {
      const run = { sessionId, turnId: decodeIdentity(name) };
      const directory = this.#runDirectory(run);
      const identity = await readRecoveryIdentity(directory);
      if (identity && (!matches(identity) || identity.run.turnId !== run.turnId)) continue;
      const files = await readdir(directory);
      // A scoped identity proves eligibility without loading every historical receipt payload.
      const receipts = identity ? undefined : (await readDeliveryRecords(directory, run, files)).filter(matches);
      if (!identity && !receipts?.length) continue;
      const terminalName = files.filter(name => name.endsWith('.json')).sort().at(-1);
      if (!terminalName) continue;
      const terminalFile = join(directory, terminalName);
      let terminal: AgentRunEvent;
      try {
        terminal = JSON.parse(await readFile(terminalFile, 'utf8')) as AgentRunEvent;
        if (terminal.run.sessionId !== sessionId || terminal.run.turnId !== run.turnId
          || terminalName !== eventFileName(terminal.sequence)) throw new Error('invalid terminal identity');
      } catch (error) { throw new JournalCorruptionError(terminalFile, error); }
      if (terminal.terminal !== 'completed') continue;
      candidates.push({ run, identity, receipts, turnId: run.turnId, completedAt: terminal.timestamp ?? 0 });
    }
    return candidates;
  }

  async #readResult(candidate: ResultCandidate): Promise<StoredTurnResult> {
    // Only selected runs read their complete journal, once, preserving integrity checks.
    const events = await this.replay(candidate.run);
    const completed = [...events].reverse().find(event => event.type === 'message.completed');
    const body = completed?.data?.message;
    const attempts = new Map<string, TurnDeliveryRecord>();
    const receipts = candidate.receipts ?? (await readDeliveryRecords(this.#runDirectory(candidate.run), candidate.run))
      .filter(receipt => receipt.subjectId === candidate.identity!.subjectId && receipt.origin.conversation
        && conversationRefKey(receipt.origin.conversation) === conversationRefKey(candidate.identity!.origin.conversation!));
    for (const receipt of receipts) {
      const key = receipt.attemptId ?? randomUUID();
      const previous = attempts.get(key);
      if (!previous || receipt.phase === 'settled' || previous.phase !== 'settled') attempts.set(key, receipt);
    }
    if (!attempts.size && candidate.identity) attempts.set('unrecorded', {
      ...candidate.identity, recordedAt: candidate.completedAt, status: 'unknown', outcome: 'unrecorded', messages: [],
      resources: Array.isArray(completed?.data?.resources) ? completed.data.resources as TurnDeliveryRecord['resources'] : [],
    });
    return { turnId: candidate.turnId, completedAt: candidate.completedAt,
      message: typeof body === 'string' ? omitInlineMedia(body) : '',
      deliveries: [...attempts.values()].sort((a, b) => a.recordedAt - b.recordedAt) };
  }

  #runDirectory(run: AgentRunIdentity): string {
    return join(this.root, encodeIdentity(run.sessionId), encodeIdentity(run.turnId));
  }

  async #lastSequence(directory: string): Promise<number> {
    const files = await jsonFiles(directory);
    if (files.length === 0) return 0;
    const value = Number(files.at(-1)!.slice(0, -'.json'.length));
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new JournalCorruptionError(directory, new Error('invalid sequence filename'));
    }
    return value;
  }
}

interface ResultCandidate extends TurnResultCursor {
  readonly run: AgentRunIdentity;
  readonly identity?: TurnRecoveryIdentity;
  readonly receipts?: readonly TurnDeliveryRecord[];
}
function compareResultCandidates(a: TurnResultCursor, b: TurnResultCursor): number {
  return a.completedAt - b.completedAt || (a.turnId < b.turnId ? -1 : a.turnId > b.turnId ? 1 : 0);
}

async function readDeliveryRecords(directory: string, run: AgentRunIdentity, files?: readonly string[]): Promise<TurnDeliveryRecord[]> {
  const receipts: TurnDeliveryRecord[] = [];
  for (const name of (files ?? await readdir(directory)).filter(name => name.endsWith('.delivery')).sort()) {
    const file = join(directory, name);
    try {
      const receipt = JSON.parse(await readFile(file, 'utf8')) as TurnDeliveryRecord;
      if (receipt.run.sessionId !== run.sessionId || receipt.run.turnId !== run.turnId
        || typeof receipt.subjectId !== 'string' || receipt.origin.kind !== 'im'
        || !['sent', 'not_sent', 'unknown', 'partial'].includes(receipt.status)
        || !Array.isArray(receipt.messages) || !Array.isArray(receipt.resources)) throw new Error('invalid delivery fact');
      receipts.push(receipt);
    } catch (error) { throw new JournalCorruptionError(file, error); }
  }
  return receipts;
}

async function readRecoveryIdentity(directory: string): Promise<TurnRecoveryIdentity | undefined> {
  const file = join(directory, 'identity.recovery');
  try { return JSON.parse(await readFile(file, 'utf8')) as TurnRecoveryIdentity; }
  catch (error) { if (isMissing(error)) return undefined; throw new JournalCorruptionError(file, error); }
}

async function writeSidecar(directory: string, name: string, value: unknown): Promise<void> {
  const temporary = join(directory, `.sidecar-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, join(directory, name));
  if (process.platform !== 'win32') {
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
}

async function acquireRunLease(directory: string): Promise<() => Promise<void>> {
  const lock = join(directory, '.append-lock');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, 'owner'), String(process.pid), 'utf8');
      return () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (await lockOwnerIsDead(lock)) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`Timed out acquiring Agent Journal append lease: ${directory}`);
}

async function lockOwnerIsDead(lock: string): Promise<boolean> {
  try {
    const pid = Number(await readFile(join(lock, 'owner'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH';
    }
  } catch {
    try {
      return Date.now() - (await stat(lock)).mtimeMs > 30_000;
    } catch {
      return false;
    }
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    const files = await readdir(directory);
    return files.filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
