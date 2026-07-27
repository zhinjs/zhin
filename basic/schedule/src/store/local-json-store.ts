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

  /** 首次 load 的共享 Promise：并发 ensureLoaded 只加载一次，避免多路 load 互覆盖内存数据 */
  private loadPromise?: Promise<StoredJob[]>;

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loadPromise ??= this.load();
      await this.loadPromise;
    }
  }

  /** flush 串行化链：多路并发 flush 依次执行，避免同时写同一 tmp 文件再 rename 的竞态 */
  private flushQueue: Promise<void> = Promise.resolve();

  private flush(): Promise<void> {
    const run = this.flushQueue.then(() => this.doFlush());
    // 链本身吞掉错误并记录日志，保证后续 flush 不被前一次失败中断
    this.flushQueue = run.catch((err) => {
      console.error(`[schedule] LocalJsonJobStore flush failed:`, err);
    });
    return run;
  }

  private async doFlush(): Promise<void> {
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
