/**
 * Assistant JobStore — assistant-jobs.json 持久化
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatCompact, Logger } from '@zhin.js/logger';
import {
  CRON_JOBS_FILENAME,
  readCronJobsFile,
  writeCronJobsFile,
  type CronJobRecord,
} from '../cron-engine.js';
import {
  assistantCronJobs,
  assistantToCronRecord,
  cronRecordToAssistant,
  schedulerRecordToAssistant,
  type LegacySchedulerJob,
} from './legacy-convert.js';
import type { AssistantConfig } from './config.js';
import type { AssistantJob, AssistantJobFile, JobAction, JobNotify } from './types.js';
import { ASSISTANT_JOBS_FILENAME, ASSISTANT_JOBS_VERSION } from './types.js';
import { parseJobNotify } from './notification-router.js';

const logger = new Logger(null, 'assistant-job-store');

const SCHEDULER_JOBS_FILENAME = 'scheduler-jobs.json';

export interface AssistantJobStoreOptions {
  dataDir: string;
  legacyDualWrite?: boolean;
  jobsFile?: string;
}

export interface MigrationResult {
  migrated: number;
  fromCron: number;
  fromScheduler: number;
  backupPaths: string[];
}

export function getAssistantJobsPath(dataDir: string, jobsFile = ASSISTANT_JOBS_FILENAME): string {
  return path.join(dataDir, jobsFile);
}

export class AssistantJobStore {
  private dataDir: string;
  private filePath: string;
  private legacyDualWrite: boolean;
  private cache: AssistantJobFile | null = null;

  constructor(options: AssistantJobStoreOptions) {
    this.dataDir = options.dataDir;
    this.filePath = getAssistantJobsPath(options.dataDir, options.jobsFile);
    this.legacyDualWrite = options.legacyDualWrite === true;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  private emptyStore(): AssistantJobFile {
    return { version: ASSISTANT_JOBS_VERSION, jobs: [] };
  }

  async read(): Promise<AssistantJobFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as AssistantJobFile;
      if (!data || !Array.isArray(data.jobs)) {
        this.cache = this.emptyStore();
        return this.cache;
      }
      this.cache = {
        version: data.version ?? ASSISTANT_JOBS_VERSION,
        jobs: data.jobs.map(normalizeJob),
      };
      return this.cache;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        this.cache = this.emptyStore();
        return this.cache;
      }
      throw e;
    }
  }

  private invalidateCache(): void {
    this.cache = null;
  }

  async write(store: AssistantJobFile): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
    this.cache = store;
    if (this.legacyDualWrite) {
      await this.dualWriteLegacyCron(store.jobs);
    }
  }

  async listJobs(): Promise<AssistantJob[]> {
    const store = await this.read();
    return [...store.jobs];
  }

  async listCronCompatible(): Promise<CronJobRecord[]> {
    const jobs = await this.listJobs();
    return assistantCronJobs(jobs);
  }

  async getJob(id: string): Promise<AssistantJob | undefined> {
    const jobs = await this.listJobs();
    return jobs.find((j) => j.id === id);
  }

  async upsertJob(job: AssistantJob): Promise<AssistantJob> {
    const store = await this.read();
    const idx = store.jobs.findIndex((j) => j.id === job.id);
    const full: AssistantJob = {
      ...job,
      updatedAt: Date.now(),
      state: job.state ?? {},
    };
    if (idx >= 0) {
      store.jobs[idx] = full;
    } else {
      store.jobs.push(full);
    }
    await this.write(store);
    return full;
  }

  async removeJob(id: string): Promise<boolean> {
    const store = await this.read();
    const next = store.jobs.filter((j) => j.id !== id);
    if (next.length === store.jobs.length) return false;
    store.jobs = next;
    await this.write(store);
    return true;
  }

  async findEventJobByEventId(eventId: string): Promise<AssistantJob | undefined> {
    const jobs = await this.listJobs();
    return jobs.find((j) =>
      j.schedule.kind === 'event'
      && j.schedule.eventId === eventId,
    );
  }

  async createEventJob(input: {
    id: string;
    label?: string;
    action: JobAction;
    notify?: JobNotify;
    source: string;
    eventType?: string;
    eventId?: string;
    payload?: unknown;
  }): Promise<AssistantJob> {
    const now = Date.now();
    const notify: JobNotify = input.notify ?? { channel: 'silent' };
    const job: AssistantJob = {
      id: input.id,
      label: input.label,
      enabled: true,
      schedule: {
        kind: 'event',
        eventId: input.eventId,
        source: input.source,
        eventType: input.eventType,
      },
      action: input.action,
      notify,
      createdAt: now,
      updatedAt: now,
      state: {},
      source: 'event',
      eventPayload: input.payload,
    };
    return this.upsertJob(job);
  }

  async updateJobState(
    id: string,
    patch: Partial<AssistantJob['state']>,
  ): Promise<void> {
    const store = await this.read();
    const job = store.jobs.find((j) => j.id === id);
    if (!job) return;
    job.state = { ...job.state, ...patch };
    job.updatedAt = Date.now();
    await this.write(store);
  }

  /**
   * 若 assistant-jobs 不存在或为空，从 legacy 文件导入。
   */
  async migrateLegacyIfNeeded(): Promise<MigrationResult> {
    const result: MigrationResult = {
      migrated: 0,
      fromCron: 0,
      fromScheduler: 0,
      backupPaths: [],
    };

    const existing = await this.read();
    if (existing.jobs.length > 0) return result;

    const merged = new Map<string, AssistantJob>();

    const cronJobs = await readCronJobsFile(this.dataDir);
    if (cronJobs.length > 0) {
      const backup = await backupFile(this.dataDir, CRON_JOBS_FILENAME);
      if (backup) result.backupPaths.push(backup);
      for (const record of cronJobs) {
        merged.set(record.id, cronRecordToAssistant(record));
        result.fromCron++;
      }
    }

    const schedulerJobs = await readSchedulerJobsFile(this.dataDir);
    if (schedulerJobs.length > 0) {
      const backup = await backupFile(this.dataDir, SCHEDULER_JOBS_FILENAME);
      if (backup) result.backupPaths.push(backup);
      for (const record of schedulerJobs) {
        const converted = schedulerRecordToAssistant(record);
        if (!converted) continue;
        if (!merged.has(converted.id)) {
          merged.set(converted.id, converted);
          result.fromScheduler++;
        }
      }
    }

    if (merged.size === 0) return result;

    const store: AssistantJobFile = {
      version: ASSISTANT_JOBS_VERSION,
      jobs: Array.from(merged.values()),
    };
    await this.write(store);
    result.migrated = store.jobs.length;
    logger.info(formatCompact({
      op: 'migrate_legacy_jobs',
      migrated: result.migrated,
      fromCron: result.fromCron,
      fromScheduler: result.fromScheduler,
    }));
    return result;
  }

  /**
   * 将 scheduler-jobs.json 中尚未入库的任务合并进 JobStore（assistant.enabled 时全量迁入）。
   */
  async syncSchedulerJobsFromLegacy(): Promise<number> {
    const schedulerJobs = await readSchedulerJobsFile(this.dataDir);
    if (schedulerJobs.length === 0) return 0;

    const store = await this.read();
    let added = 0;
    for (const record of schedulerJobs) {
      const converted = schedulerRecordToAssistant(record);
      if (!converted) continue;
      if (store.jobs.some((j) => j.id === converted.id)) continue;
      store.jobs.push(converted);
      added++;
    }
    if (added > 0) {
      await this.write(store);
      logger.info(formatCompact({ op: 'sync_scheduler_jobs', added }));
    }
    return added;
  }

  private async dualWriteLegacyCron(jobs: AssistantJob[]): Promise<void> {
    const cronRecords = jobs
      .map(assistantToCronRecord)
      .filter((j): j is CronJobRecord => j != null);
    try {
      await writeCronJobsFile(this.dataDir, cronRecords);
    } catch (e: unknown) {
      logger.warn('双写 cron-jobs.json 失败: ' + ((e as Error)?.message || String(e)));
    }
  }
}

function normalizeJob(raw: AssistantJob): AssistantJob {
  return {
    ...raw,
    notify: parseJobNotify(raw.notify),
    state: raw.state ?? {},
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
  };
}

async function backupFile(dataDir: string, filename: string): Promise<string | null> {
  const src = path.join(dataDir, filename);
  try {
    await fs.promises.access(src);
  } catch {
    return null;
  }
  const backup = `${src}.bak.${Date.now()}`;
  await fs.promises.copyFile(src, backup);
  return backup;
}

async function readSchedulerJobsFile(dataDir: string): Promise<LegacySchedulerJob[]> {
  const filePath = path.join(dataDir, SCHEDULER_JOBS_FILENAME);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as { jobs?: LegacySchedulerJob[] };
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return [];
    logger.warn('读取 scheduler-jobs 失败: ' + (err?.message || String(e)));
    return [];
  }
}

export function createAssistantJobStore(
  dataDir: string,
  config?: AssistantConfig,
): AssistantJobStore {
  return new AssistantJobStore({
    dataDir,
    legacyDualWrite: config?.legacyDualWrite,
    jobsFile: config?.jobsFile,
  });
}
