import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentRunEvent, AgentRunIdentity } from '@zhin.js/ai/agent-stream';
import type { JournalRunSummary, JournalStore } from '@zhin.js/ai/journal-store';

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
export class FileJournalStore implements JournalStore {
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
      const directoryHandle = await open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
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
