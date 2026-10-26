/**
 * ScheduleJobEngine — schedule-jobs.json 持久化调度
 */
import { createMessages } from '@zhin.js/plugin-runtime';
import { getLogger, formatCompact } from '@zhin.js/logger';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScheduleEngine, isHeartbeatEmpty } from '@zhin.js/kernel';
import { registerJobSchedule, isRuntimeSchedulable } from './job-scheduler.js';
import type { ScheduleJobStore } from './job-store.js';
import type { JobWorker } from './job-worker.js';
import type { ScheduleJob } from './types.js';
import { jobPrompt } from './job-utils.js';
import { DEFAULT_HEARTBEAT_PROMPT } from './profile-types.js';
import { type NotificationRouter, resolveEffectiveNotify } from './notification-router.js';
const logger = getLogger('schedule-job-engine');
const messages = createMessages({ failed: { 'zh-CN': '[任务失败] {label}: {error}', en: '[Task failed] {label}: {error}' } });

export interface ScheduleJobEngineOptions {
  store: ScheduleJobStore;
  worker: JobWorker;
  notifyOnFailure?: boolean;
  router: NotificationRouter;
  defaultNotify?: import('./types.js').JobNotify;
  /** Workspace holding HEARTBEAT.md; a default-prompt heartbeat is skipped while that file has no task. */
  workspaceDir?: string;
}

export class ScheduleJobEngine {
  readonly #scheduler = new ScheduleEngine();
  private store: ScheduleJobStore;
  private worker: JobWorker;
  private disposes = new Map<string, () => void>();
  private notifyOnFailure: boolean;
  private router: NotificationRouter;
  private defaultNotify?: import('./types.js').JobNotify;
  private workspaceDir?: string;

  constructor(options: ScheduleJobEngineOptions) {
    this.store = options.store;
    this.worker = options.worker;
    this.notifyOnFailure = options.notifyOnFailure === true;
    this.router = options.router;
    this.defaultNotify = options.defaultNotify;
    this.workspaceDir = options.workspaceDir;
  }

  getDataDir(): string {
    return this.store.getDataDir();
  }

  async load(): Promise<void> {
    const jobs = await this.store.listJobs();
    for (const job of jobs) {
      if (isRuntimeSchedulable(job)) {
        this.registerOne(job);
      }
    }
    const count = jobs.filter((j) => isRuntimeSchedulable(j)).length;
    if (count > 0) {
      logger.debug(formatCompact({ schedule_jobs: count }));
    }
  }

  registerOne(job: ScheduleJob): void {
    const dispose = registerJobSchedule(this.#scheduler, job, (jobId) => this.runJob(jobId));
    if (dispose) {
      this.disposes.set(job.id, dispose);
    }
  }

  async runJobNow(jobId: string): Promise<void> {
    await this.runJob(jobId);
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job || !job.enabled) return;
    if (job.action.kind !== 'agent' && job.action.kind !== 'heartbeat') return;
    if (await this.isIdleHeartbeat(job)) {
      logger.debug(formatCompact({ op: 'heartbeat_skipped', job: jobId, reason: 'no_heartbeat_tasks' }));
      return;
    }

    const result = await this.worker.run(job);

    await this.store.updateJobState(jobId, {
      lastExecutedAt: Date.now(),
      lastStatus: result.success ? 'ok' : 'error',
      lastError: result.success ? undefined : result.error,
    });

    if (!result.success && (job.notifyOnFailure ?? this.notifyOnFailure)) {
      const notify = resolveEffectiveNotify(job.notify, this.defaultNotify);
      if (notify.channel !== 'silent' && notify.channel !== 'log') {
        const msg = messages(job.locale, 'failed', { label: job.label || jobId, error: result.error || 'unknown error' });
        await this.router.deliver({ notify, content: msg, jobId, label: job.label }).catch(() => {});
      }
    }

    if (result.success && job.schedule.kind === 'at' && job.schedule.deleteAfterRun) {
      await this.removeJob(jobId);
    }
  }

  /** The default heartbeat prompt only reads HEARTBEAT.md: without a task there, a model turn is wasted. */
  private async isIdleHeartbeat(job: ScheduleJob): Promise<boolean> {
    if (job.action.kind !== 'heartbeat' || !this.workspaceDir) return false;
    if (jobPrompt(job).trim() !== DEFAULT_HEARTBEAT_PROMPT) return false;
    const content = await readFile(join(this.workspaceDir, 'HEARTBEAT.md'), 'utf8').catch(() => null);
    return isHeartbeatEmpty(content);
  }

  async listJobs(): Promise<ScheduleJob[]> {
    return this.store.listJobs();
  }

  async addJob(job: Omit<ScheduleJob, 'createdAt' | 'updatedAt' | 'state'> & {
    createdAt?: number;
    updatedAt?: number;
    state?: ScheduleJob['state'];
  }): Promise<ScheduleJob> {
    const now = Date.now();
    const full: ScheduleJob = {
      ...job,
      createdAt: job.createdAt ?? now,
      updatedAt: job.updatedAt ?? now,
      state: job.state ?? {},
      enabled: job.enabled ?? true,
    };
    full.source = job.source ?? 'manual';
    await this.store.upsertJob(full);
    if (isRuntimeSchedulable(full)) {
      this.registerOne(full);
    }
    return full;
  }

  async removeJob(id: string): Promise<boolean> {
    const ok = await this.store.removeJob(id);
    if (!ok) return false;
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  async pauseJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = false;
    await this.store.upsertJob(job);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  async resumeJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = true;
    await this.store.upsertJob(job);
    if (isRuntimeSchedulable(job)) {
      this.registerOne(job);
    }
    return true;
  }

  unload(): void {
    for (const [id, dispose] of this.disposes) {
      try {
        dispose();
      } catch (e) {
        logger.warn(`Schedule dispose failed for ${id}:`, e);
      }
    }
    this.disposes.clear();
    this.#scheduler.dispose();
  }
}
