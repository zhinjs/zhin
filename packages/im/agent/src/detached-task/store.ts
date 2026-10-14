import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DetachedTaskRecord } from './types.js';

export interface DetachedTaskStore {
  load(taskId: string): Promise<DetachedTaskRecord | undefined>;
  save(record: DetachedTaskRecord): Promise<void>;
  list(): Promise<readonly DetachedTaskRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryDetachedTaskStore implements DetachedTaskStore {
  readonly #records = new Map<string, DetachedTaskRecord>();
  async load(taskId: string) {
    const r = this.#records.get(taskId);
    return r && clone(r);
  }
  async save(record: DetachedTaskRecord) {
    this.#records.set(record.taskId, clone(record));
  }
  async list() {
    return [...this.#records.values()].map(clone);
  }
}

function fileName(taskId: string): string {
  return `${Buffer.from(taskId, 'utf8').toString('base64url')}.json`;
}

/** One JSON file per task, written atomically (temp file + rename). */
export class FileDetachedTaskStore implements DetachedTaskStore {
  constructor(private readonly root: string) {}

  async load(taskId: string): Promise<DetachedTaskRecord | undefined> {
    try {
      return JSON.parse(await readFile(join(this.root, fileName(taskId)), 'utf8')) as DetachedTaskRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(record: DetachedTaskRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const target = join(this.root, fileName(record.taskId));
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(record), 'utf8');
    await rename(temp, target);
  }

  async list(): Promise<readonly DetachedTaskRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const out: DetachedTaskRecord[] = [];
    for (const name of names.filter(n => n.endsWith('.json'))) {
      out.push(JSON.parse(await readFile(join(this.root, name), 'utf8')) as DetachedTaskRecord);
    }
    return out;
  }
}
