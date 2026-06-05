/**
 * Assistant Job 非 cron 调度（every / at）+ cron 注册（M1.5）
 */
import { Cron } from '@zhin.js/core';
import { formatCompact, Logger } from '@zhin.js/logger';
import type { AddCronFn } from '../cron-engine.js';
import type { AssistantJob } from './types.js';

const logger = new Logger(null, 'assistant-job-scheduler');

export type ScheduleDispose = () => void;

export function isRuntimeSchedulable(job: AssistantJob, now = Date.now()): boolean {
  if (!job.enabled) return false;
  switch (job.schedule.kind) {
    case 'cron':
      return Boolean(job.schedule.expr);
    case 'every':
      return job.schedule.everyMs > 0;
    case 'at':
      return job.schedule.atMs > now;
    case 'event':
      return false;
    default:
      return false;
  }
}

export function registerJobSchedule(
  job: AssistantJob,
  addCron: AddCronFn,
  onRun: (jobId: string) => void | Promise<void>,
): ScheduleDispose | null {
  const jobId = job.id;
  try {
    if (job.schedule.kind === 'cron') {
      const cron = new Cron(job.schedule.expr, async () => {
        await onRun(jobId);
      });
      cron.id = jobId;
      return addCron(cron);
    }

    if (job.schedule.kind === 'every') {
      const everyMs = job.schedule.everyMs;
      const timer = setInterval(() => {
        void onRun(jobId);
      }, everyMs);
      return () => clearInterval(timer);
    }

    if (job.schedule.kind === 'at') {
      const delay = job.schedule.atMs - Date.now();
      if (delay <= 0) return null;
      const timer = setTimeout(() => {
        void onRun(jobId);
      }, delay);
      return () => clearTimeout(timer);
    }
  } catch (e: unknown) {
    logger.warn(formatCompact({
      op: 'register_schedule_failed',
      jobId,
      error: (e as Error)?.message || String(e),
    }));
  }
  return null;
}
