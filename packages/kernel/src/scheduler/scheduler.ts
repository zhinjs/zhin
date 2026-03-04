/**
 * 通用任务调度器
 *
 * 持久化到 JSON 文件，支持单次 at、间隔 every、cron 表达式三种调度方式。
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Cron as Croner } from 'croner';
import type {
  Schedule,
  ScheduledJob,
  JobStore,
  JobCallback,
  AddJobOptions,
  IScheduler,
} from './types.js';
import { Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'scheduler');

function nowMs(): number {
  return Date.now();
}

function computeNextRun(schedule: Schedule, currentMs: number): number | undefined {
  if (schedule.kind === 'at') {
    return schedule.atMs != null && schedule.atMs > currentMs ? schedule.atMs : undefined;
  }
  if (schedule.kind === 'every') {
    if (schedule.everyMs == null || schedule.everyMs <= 0) return undefined;
    return currentMs + schedule.everyMs;
  }
  if (schedule.kind === 'cron' && schedule.expr) {
    try {
      const job = new Croner(schedule.expr, { paused: true, timezone: schedule.tz });
      const next = job.nextRun();
      job.stop();
      return next ? next.getTime() : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createStore(): JobStore {
  return { version: 1, jobs: [] };
}

export interface SchedulerOptions {
  storePath: string;
  workspace: string;
  onJob?: JobCallback;
}

export class Scheduler implements IScheduler {
  private storePath: string;
  private workspace: string;
  private onJob: JobCallback | null = null;
  private store: JobStore | null = null;
  private timerTimeout: ReturnType<typeof setTimeout> | null = null;
  private _running = false;

  constructor(options: SchedulerOptions) {
    this.storePath = options.storePath;
    this.workspace = options.workspace;
    this.onJob = options.onJob ?? null;
  }

  private loadStore(): JobStore {
    if (this.store) return this.store;
    if (fs.existsSync(this.storePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        const jobs: ScheduledJob[] = (data.jobs || []).map((j: any) => ({
          id: j.id,
          name: j.name,
          enabled: j.enabled ?? true,
          schedule: {
            kind: j.schedule?.kind ?? 'cron',
            atMs: j.schedule?.atMs,
            everyMs: j.schedule?.everyMs,
            expr: j.schedule?.expr,
            tz: j.schedule?.tz,
          },
          payload: {
            kind: j.payload?.kind ?? 'system_event',
            message: j.payload?.message ?? '',
            deliver: j.payload?.deliver ?? false,
            target: j.payload?.target ?? (j.payload as any)?.channel,
            to: j.payload?.to,
          },
          state: {
            nextRunAtMs: j.state?.nextRunAtMs,
            lastRunAtMs: j.state?.lastRunAtMs,
            lastStatus: j.state?.lastStatus,
            lastError: j.state?.lastError,
          },
          createdAtMs: j.createdAtMs ?? 0,
          updatedAtMs: j.updatedAtMs ?? 0,
          deleteAfterRun: j.deleteAfterRun ?? false,
        }));
        this.store = { version: data.version ?? 1, jobs };
      } catch (e) {
        logger.warn('Failed to load scheduler store', e);
        this.store = createStore();
      }
    } else {
      this.store = createStore();
    }
    return this.store;
  }

  private saveStore(): void {
    if (!this.store) return;
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      version: this.store.version,
      jobs: this.store.jobs.map(j => ({
        id: j.id,
        name: j.name,
        enabled: j.enabled,
        schedule: j.schedule,
        payload: j.payload,
        state: j.state,
        createdAtMs: j.createdAtMs,
        updatedAtMs: j.updatedAtMs,
        deleteAfterRun: j.deleteAfterRun,
      })),
    };
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  async start(): Promise<void> {
    this._running = true;
    this.loadStore();
    this.recomputeNextRuns();
    this.saveStore();
    this.armTimer();
    logger.info({ jobs: this.store?.jobs.length ?? 0 }, 'Scheduler started');
  }

  stop(): void {
    this._running = false;
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }
  }

  private recomputeNextRuns(): void {
    if (!this.store) return;
    const now = nowMs();
    for (const job of this.store.jobs) {
      if (job.enabled) job.state.nextRunAtMs = computeNextRun(job.schedule, now);
    }
  }

  private getNextWakeMs(): number | undefined {
    if (!this.store) return undefined;
    const times = this.store.jobs
      .filter(j => j.enabled && j.state.nextRunAtMs != null)
      .map(j => j.state.nextRunAtMs!);
    return times.length > 0 ? Math.min(...times) : undefined;
  }

  private armTimer(): void {
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }
    const nextWake = this.getNextWakeMs();
    if (nextWake == null || !this._running) return;
    const delayMs = Math.max(0, nextWake - nowMs());
    this.timerTimeout = setTimeout(async () => {
      if (this._running) await this.onTimer();
    }, delayMs);
  }

  private async onTimer(): Promise<void> {
    if (!this.store) return;
    const now = nowMs();
    const dueJobs = this.store.jobs.filter(
      j => j.enabled && j.state.nextRunAtMs != null && now >= j.state.nextRunAtMs!
    );
    for (const job of dueJobs) await this.executeJob(job);
    this.saveStore();
    this.armTimer();
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const startMs = nowMs();
    logger.info({ jobId: job.id, name: job.name }, 'Scheduler: executing job');
    try {
      if (this.onJob) await this.onJob(job);
      job.state.lastStatus = 'ok';
      job.state.lastError = undefined;
      logger.info({ jobId: job.id, name: job.name }, 'Scheduler: job completed');
    } catch (error) {
      job.state.lastStatus = 'error';
      job.state.lastError = String(error);
      logger.error({ jobId: job.id, name: job.name, lastError: String(error) }, 'Scheduler: job failed');
    }
    job.state.lastRunAtMs = startMs;
    job.updatedAtMs = nowMs();
    if (job.schedule.kind === 'at') {
      if (job.deleteAfterRun && this.store) {
        this.store.jobs = this.store.jobs.filter(j => j.id !== job.id);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      }
    } else {
      job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
    }
  }

  listJobs(): ScheduledJob[] {
    const store = this.loadStore();
    return store.jobs
      .sort((a, b) => (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity));
  }

  addJob(options: AddJobOptions): ScheduledJob {
    const store = this.loadStore();
    const now = nowMs();
    const job: ScheduledJob = {
      id: randomUUID().slice(0, 8),
      name: options.name,
      enabled: options.enabled ?? true,
      schedule: options.schedule,
      payload: options.payload,
      state: { nextRunAtMs: computeNextRun(options.schedule, now) },
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: options.deleteAfterRun ?? false,
    };
    store.jobs.push(job);
    this.saveStore();
    this.armTimer();
    logger.info({ jobId: job.id, name: job.name }, 'Scheduler: added job');
    return job;
  }

  removeJob(jobId: string): boolean {
    const store = this.loadStore();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter(j => j.id !== jobId);
    const removed = store.jobs.length < before;
    if (removed) {
      this.saveStore();
      this.armTimer();
      logger.info({ jobId }, 'Scheduler: removed job');
    }
    return removed;
  }

  enableJob(jobId: string, enabled: boolean = true): boolean {
    const store = this.loadStore();
    const job = store.jobs.find(j => j.id === jobId);
    if (!job) return false;
    job.enabled = enabled;
    job.updatedAtMs = nowMs();
    job.state.nextRunAtMs = enabled ? computeNextRun(job.schedule, nowMs()) : undefined;
    this.saveStore();
    this.armTimer();
    return true;
  }

  async runJob(jobId: string): Promise<void> {
    const store = this.loadStore();
    const job = store.jobs.find(j => j.id === jobId);
    if (job) {
      await this.executeJob(job);
      this.saveStore();
      this.armTimer();
    }
  }

  status(): { running: boolean; jobCount: number; nextWakeAt?: number } {
    const store = this.loadStore();
    return {
      running: this._running,
      jobCount: store.jobs.length,
      nextWakeAt: this.getNextWakeMs(),
    };
  }
}
