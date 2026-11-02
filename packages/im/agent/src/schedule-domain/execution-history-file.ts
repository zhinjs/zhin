import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { compareHistory, historyKey, historySummary, matchesHistory, type ScheduleHistoryQuery, type ScheduleHistoryRead, type ScheduleHistoryRecord, type ScheduleHistoryRepository, type StoredScheduleHistorySummary } from './execution-history-store.js';

interface IndexedFile { readonly modifiedAt: number; readonly size: number; readonly summary: StoredScheduleHistorySummary }
const historyFile = /^[a-f0-9]{64}\.history$/u;
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** One atomic run file: a small indexed header followed by its complete detail, never model request bodies. */
export class FileScheduleHistoryRepository implements ScheduleHistoryRepository {
  readonly #index = new Map<string, IndexedFile>();
  constructor(private readonly directory: string) {}

  async save(record: ScheduleHistoryRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = `${historyKey(record.runId)}.history`;
    const destination = join(this.directory, name);
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(`${JSON.stringify(historySummary(record))}\n${JSON.stringify(record)}\n`, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, destination);
      if (process.platform !== 'win32') {
        const directoryHandle = await open(this.directory, 'r');
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
      const metadata = await stat(destination);
      this.#index.set(name, { modifiedAt: metadata.mtimeMs, size: metadata.size, summary: historySummary(record) });
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  async page(query: ScheduleHistoryQuery): Promise<readonly StoredScheduleHistorySummary[]> {
    await this.#refreshIndex();
    return [...this.#index.values()].map(entry => entry.summary).filter(row => matchesHistory(row, query))
      .sort(compareHistory).slice(0, query.limit);
  }
  async read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined> {
    let raw: string;
    try { raw = await readFile(join(this.directory, `${historyKey(query.runId)}.history`), 'utf8'); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    const boundary = raw.indexOf('\n');
    if (boundary < 0) throw new Error('Schedule history file has no header');
    const record = JSON.parse(raw.slice(boundary + 1)) as ScheduleHistoryRecord;
    if (record.version !== 1 || record.runId !== query.runId || !Array.isArray(record.attempts)) throw new Error('Invalid schedule history identity');
    return query.jobId && record.jobId !== query.jobId ? undefined : record;
  }
  async prune({ cutoff, ownerStartedAt }: Readonly<{ cutoff: number; ownerStartedAt: number }>): Promise<number> {
    await this.#refreshIndex();
    let deleted = 0;
    for (const [name, { summary }] of this.#index) {
      if (summary.queuedAt >= cutoff || (summary.finishedAt === undefined && summary.ownerStartedAt === ownerStartedAt)) continue;
      try { await rm(join(this.directory, name)); }
      catch (error) { if (!missing(error)) throw error; }
      this.#index.delete(name);
      deleted += 1;
    }
    return deleted;
  }
  async #refreshIndex(): Promise<void> {
    let names: string[];
    try { names = (await readdir(this.directory)).filter(name => historyFile.test(name)); }
    catch (error) { if (missing(error)) { this.#index.clear(); return; } throw error; }
    const present = new Set(names);
    for (const name of this.#index.keys()) if (!present.has(name)) this.#index.delete(name);
    for (const name of names) {
      const file = join(this.directory, name);
      let modifiedAt: number;
      let size: number;
      try { const metadata = await stat(file); modifiedAt = metadata.mtimeMs; size = metadata.size; }
      catch (error) { if (missing(error)) { this.#index.delete(name); continue; } throw error; }
      if (this.#index.get(name)?.modifiedAt === modifiedAt && this.#index.get(name)?.size === size) continue;
      let header: string | undefined;
      try { header = await readHeader(file); }
      catch (error) { if (missing(error)) { this.#index.delete(name); continue; } throw error; }
      if (header === undefined) throw new Error('Schedule history file has no header');
      const summary = JSON.parse(header) as StoredScheduleHistorySummary;
      if (typeof summary.runId !== 'string' || `${historyKey(summary.runId)}.history` !== name
        || !Number.isFinite(summary.queuedAt) || typeof summary.jobId !== 'string') throw new Error('Invalid schedule history header');
      this.#index.set(name, { modifiedAt, size, summary });
    }
  }
}

/** Listing touches only the header; complete outputs are read solely by the detail endpoint. */
async function readHeader(file: string): Promise<string | undefined> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  let text = '';
  try {
    for await (const chunk of stream) {
      text += chunk;
      const end = text.indexOf('\n');
      if (end >= 0) return text.slice(0, end);
    }
    return undefined;
  } finally { stream.destroy(); }
}
