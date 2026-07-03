import type { JobStore, LocalJsonStoreOptions, StoredJob } from './types.js';
import { DEFAULT_JOBS_PATH } from './types.js';
import { migrateStoredJob } from './migrate.js';

interface JobsFilePayload {
  jobs: StoredJob[];
}

export class LocalJsonJobStore implements JobStore {
  private readonly path: string;
  private jobs: StoredJob[] = [];
  private loaded = false;

  constructor(options: LocalJsonStoreOptions = {}) {
    this.path = options.path ?? DEFAULT_JOBS_PATH;
  }

  async load(): Promise<StoredJob[]> {
    const fs = await import('node:fs/promises');
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as JobsFilePayload;
      this.jobs = (parsed.jobs ?? []).map((job) => migrateStoredJob(job));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      this.jobs = [];
    }
    this.loaded = true;
    return [...this.jobs];
  }

  async upsert(job: StoredJob): Promise<void> {
    await this.ensureLoaded();
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index === -1) {
      this.jobs.push(job);
    } else {
      this.jobs[index] = job;
    }
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.jobs = this.jobs.filter((item) => item.id !== id);
    await this.flush();
  }

  async listDue(before: Date, limit = 100): Promise<StoredJob[]> {
    await this.ensureLoaded();
    const beforeMs = before.getTime();
    return this.jobs
      .filter((job) => {
        if (job.cancelled || job.nextRunAt == null) {
          return false;
        }
        return new Date(job.nextRunAt).getTime() <= beforeMs;
      })
      .sort((a, b) => {
        const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
        const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
        return aTime - bTime;
      })
      .slice(0, limit);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  private async flush(): Promise<void> {
    const fs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    const dir = nodePath.dirname(this.path);
    await fs.mkdir(dir, { recursive: true });
    const payload: JobsFilePayload = { jobs: this.jobs };
    const tempPath = `${this.path}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.path);
  }
}

export function createLocalJsonStore(options?: LocalJsonStoreOptions): LocalJsonJobStore {
  return new LocalJsonJobStore(options);
}
