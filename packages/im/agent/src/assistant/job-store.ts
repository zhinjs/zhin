/**
 * Schedule JobStore — schedule-jobs.json 持久化
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { type ScheduleJob, type ScheduleJobFile, type JobAction, type JobNotify, SCHEDULE_JOBS_FILENAME, SCHEDULE_JOBS_VERSION } from './types.js';
import { parseScheduleJobCreator } from './job-creator.js';
import { parseScheduleJobExecutionPlan } from './schedule-execution.js';
import { parseJobNotify, resolveEffectiveNotify } from './notification-router.js';
const logger = getLogger('schedule-job-store');

export interface ScheduleJobStoreOptions {
  dataDir: string;
  /** 读盘时合并 `{ channel: im }` 等缺 target 的 notify（与 resolveEffectiveNotify 一致） */
  defaultNotify?: JobNotify;
}

export function getScheduleJobsPath(dataDir: string): string {
  return path.join(dataDir, SCHEDULE_JOBS_FILENAME);
}

export class ScheduleJobStore {
  private dataDir: string;
  private filePath: string;
  private defaultNotify?: JobNotify;
  private cache: ScheduleJobFile | null = null;

  constructor(options: ScheduleJobStoreOptions) {
    this.dataDir = options.dataDir;
    this.filePath = getScheduleJobsPath(options.dataDir);
    this.defaultNotify = options.defaultNotify;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  private emptyStore(): ScheduleJobFile {
    return { version: SCHEDULE_JOBS_VERSION, jobs: [] };
  }

  async read(): Promise<ScheduleJobFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as ScheduleJobFile;
      if (!data || !Array.isArray(data.jobs)) {
        this.cache = this.emptyStore();
        return this.cache;
      }
      this.cache = {
        version: data.version ?? SCHEDULE_JOBS_VERSION,
        jobs: (data.jobs as unknown[]).map((j) =>
          normalizeJob(j as Record<string, unknown>, this.defaultNotify),
        ),
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

  async write(store: ScheduleJobFile): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
    this.cache = store;
  }

  async listJobs(): Promise<ScheduleJob[]> {
    const store = await this.read();
    return store.jobs;
  }

  async getJob(id: string): Promise<ScheduleJob | undefined> {
    const store = await this.read();
    return store.jobs.find((j) => j.id === id);
  }

  async upsertJob(job: ScheduleJob): Promise<void> {
    const store = await this.read();
    const idx = store.jobs.findIndex((j) => j.id === job.id);
    const now = Date.now();
    if (idx >= 0) {
      const existing = store.jobs[idx]!;
      if (isSameScheduleJobBusiness(existing, job)) {
        return;
      }
      store.jobs[idx] = { ...job, createdAt: existing.createdAt, updatedAt: now };
    } else {
      store.jobs.push({ ...job, updatedAt: now, createdAt: job.createdAt || now });
    }
    await this.write(store);
  }

  async removeJob(id: string): Promise<boolean> {
    const store = await this.read();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== id);
    if (store.jobs.length < before) {
      await this.write(store);
      return true;
    }
    return false;
  }

  async updateJobState(id: string, patch: Partial<ScheduleJob['state']>): Promise<void> {
    const job = await this.getJob(id);
    if (!job) return;
    job.state = { ...job.state, ...patch };
    job.updatedAt = Date.now();
    await this.upsertJob(job);
  }

  async findEventJobByEventId(eventId: string): Promise<ScheduleJob | undefined> {
    const jobs = await this.listJobs();
    return jobs.find((j) => j.schedule.kind === 'event' && j.schedule.eventId === eventId);
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
  }): Promise<ScheduleJob> {
    const now = Date.now();
    const job: ScheduleJob = {
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
      notify: input.notify ?? { channel: 'silent' },
      createdAt: now,
      updatedAt: now,
      state: {},
      source: 'event',
      eventPayload: input.payload,
    };
    await this.upsertJob(job);
    return job;
  }
}

/** Compare business fields; ignore timestamps that upsert always refreshes. */
function isSameScheduleJobBusiness(a: ScheduleJob, b: ScheduleJob): boolean {
  return JSON.stringify(scheduleJobBusiness(a)) === JSON.stringify(scheduleJobBusiness(b));
}

function scheduleJobBusiness(job: ScheduleJob): unknown {
  return {
    id: job.id,
    label: job.label,
    enabled: job.enabled,
    schedule: job.schedule,
    action: job.action,
    notify: job.notify,
    notifyOnFailure: job.notifyOnFailure,
    state: job.state ?? {},
    source: job.source,
    createdBy: job.createdBy,
    executionPlan: job.executionPlan,
    activityFeedback: job.activityFeedback,
    budget: job.budget,
    eventPayload: job.eventPayload,
  };
}

function normalizeJob(raw: Record<string, unknown>, defaultNotify?: JobNotify): ScheduleJob {
  const notify = parseJobNotify(
    resolveEffectiveNotify(raw.notify as JobNotify | undefined, defaultNotify),
  );
  const schedule = raw.schedule as ScheduleJob['schedule'];
  const action = raw.action as JobAction;
  if (!schedule || !action) {
    throw new Error(`schedule-jobs.json: job "${String(raw.id)}" 缺少 schedule 或 action`);
  }
  return {
    id: String(raw.id),
    label: raw.label != null ? String(raw.label) : undefined,
    enabled: raw.enabled !== false,
    schedule,
    action,
    notify,
    notifyOnFailure: raw.notifyOnFailure === true ? true : undefined,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    state: (raw.state as ScheduleJob['state']) ?? {},
    source: raw.source as ScheduleJob['source'],
    createdBy: parseScheduleJobCreator(raw.createdBy),
    executionPlan: parseScheduleJobExecutionPlan(raw.executionPlan),
    activityFeedback: raw.activityFeedback === true ? true : undefined,
    budget: raw.budget && typeof raw.budget === 'object'
      ? raw.budget as ScheduleJob['budget']
      : undefined,
    eventPayload: raw.eventPayload,
  };
}

export function createScheduleJobStoreFromConfig(
  dataDir: string,
  options?: { defaultNotify?: JobNotify },
): ScheduleJobStore {
  return new ScheduleJobStore({ dataDir, defaultNotify: options?.defaultNotify });
}
