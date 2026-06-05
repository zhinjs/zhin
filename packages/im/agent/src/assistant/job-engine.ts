/**
 * AssistantJobEngine — 基于 JobStore 的持久化调度（API 兼容 PersistentCronEngine）
 */
import { Logger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import type {
  AddCronFn,
  CronJobRecord,
} from '../cron-engine.js';
import {
  assistantToCronRecord,
  cronRecordToAssistant,
  jobPrompt,
} from './legacy-convert.js';
import { registerJobSchedule, isRuntimeSchedulable } from './job-scheduler.js';
import type { AssistantJobStore } from './job-store.js';
import type { JobWorker } from './job-worker.js';
import type { AssistantJob } from './types.js';
import type { NotificationRouter } from './notification-router.js';
import { resolveEffectiveNotify } from './notification-router.js';

const logger = new Logger(null, 'assistant-job-engine');

export interface AssistantJobEngineOptions {
  store: AssistantJobStore;
  addCron: AddCronFn;
  worker: JobWorker;
  notifyOnFailure?: boolean;
  router?: NotificationRouter;
  defaultNotify?: import('./types.js').JobNotify;
}

export class AssistantJobEngine {
  private store: AssistantJobStore;
  private addCron: AddCronFn;
  private worker: JobWorker;
  private disposes = new Map<string, () => void>();
  private notifyOnFailure: boolean;
  private router?: NotificationRouter;
  private defaultNotify?: import('./types.js').JobNotify;

  constructor(options: AssistantJobEngineOptions) {
    this.store = options.store;
    this.addCron = options.addCron;
    this.worker = options.worker;
    this.notifyOnFailure = options.notifyOnFailure === true;
    this.router = options.router;
    this.defaultNotify = options.defaultNotify;
  }

  getDataDir(): string {
    return this.store.getDataDir();
  }

  load(): void {
    this.store.migrateLegacyIfNeeded().then(() => this.store.listJobs()).then((jobs) => {
      for (const job of jobs) {
        if (isRuntimeSchedulable(job)) {
          this.registerOne(job);
        }
      }
      const count = jobs.filter((j) => isRuntimeSchedulable(j)).length;
      if (count > 0) {
        logger.debug(formatCompact({ assistant_jobs: count }));
      }
    }).catch((e) => {
      logger.warn('加载 Assistant Job 失败: ' + ((e as Error)?.message || String(e)));
    });
  }

  registerOne(job: AssistantJob): void {
    const dispose = registerJobSchedule(job, this.addCron, (jobId) => this.runJob(jobId));
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

    const result = await this.worker.run(jobId, jobPrompt(job), {
      notify: job.notify,
      label: job.label || jobId,
    });

    await this.store.updateJobState(jobId, {
      lastExecutedAt: Date.now(),
      lastStatus: result.success ? 'ok' : 'error',
      lastError: result.success ? undefined : result.error,
    });

    if (!result.success && this.router && (job.notifyOnFailure ?? this.notifyOnFailure)) {
      const notify = resolveEffectiveNotify(job.notify, this.defaultNotify);
      if (notify.channel !== 'silent' && notify.channel !== 'log') {
        const msg = `[任务失败] ${job.label || jobId}: ${result.error || 'unknown error'}`;
        await this.router.deliver({ notify, content: msg, jobId, label: job.label }).catch(() => {});
      }
    }

    if (result.success && job.schedule.kind === 'at' && job.schedule.deleteAfterRun) {
      await this.removeJob(jobId);
    }
  }

  async listJobs(): Promise<CronJobRecord[]> {
    return this.store.listCronCompatible();
  }

  async listAssistantJobs(): Promise<AssistantJob[]> {
    return this.store.listJobs();
  }

  async addJob(record: Omit<CronJobRecord, 'createdAt'> & { createdAt?: number }): Promise<CronJobRecord> {
    const assistant = cronRecordToAssistant({
      ...record,
      createdAt: record.createdAt ?? Date.now(),
      enabled: record.enabled ?? true,
    });
    assistant.source = 'manual';
    await this.store.upsertJob(assistant);
    if (isRuntimeSchedulable(assistant)) {
      this.registerOne(assistant);
    }
    const out = assistantToCronRecord(assistant);
    if (!out) throw new Error('Failed to convert assistant job to cron record');
    return out;
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
        logger.warn(`Assistant schedule dispose failed for ${id}:`, e);
      }
    }
    this.disposes.clear();
  }

  async updateJobStatus(id: string, status: 'ok' | 'error', error?: string): Promise<void> {
    await this.store.updateJobState(id, {
      lastExecutedAt: Date.now(),
      lastStatus: status,
      lastError: status === 'error' ? error : undefined,
    });
  }
}

export type { AddCronFn } from '../cron-engine.js';
