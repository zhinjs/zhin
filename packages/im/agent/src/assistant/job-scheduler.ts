/**
 * Schedule job registration — calendar + every/at
 */
import {
  ScheduleEngine,
  getScheduleEngine,
  resolveSolarJob,
  resolveLunarJob,
  resolveWorkdayJob,
  resolveFreeDayJob,
  resolveHolidayJob,
  resolveScatterJob,
  type ResolvedJob,
} from '@zhin.js/kernel';
import type { ScheduleJob, JobSchedule } from './types.js';

const loggerName = 'schedule-job-scheduler';

export type ScheduleDispose = () => void;

function ensureEngine(): ScheduleEngine {
  let engine = getScheduleEngine();
  if (!engine) {
    engine = new ScheduleEngine();
  }
  return engine;
}

export function jobScheduleToResolved(schedule: JobSchedule, timezone = 'Asia/Shanghai'): ResolvedJob | null {
  const tz = 'tz' in schedule ? schedule.tz ?? timezone : timezone;
  switch (schedule.kind) {
    case 'solar':
      return resolveSolarJob(schedule.cron, tz);
    case 'lunar':
      return resolveLunarJob(schedule.cron, tz);
    case 'workday':
      return resolveWorkdayJob(schedule.cron, tz);
    case 'freeDay':
      return resolveFreeDayJob(schedule.cron, tz);
    case 'holiday':
      return resolveHolidayJob({
        cron: schedule.cron,
        festivals: schedule.festivals,
        everyDayOfHoliday: schedule.everyDayOfHoliday,
      }, tz);
    case 'scatter':
      return resolveScatterJob(schedule.input, tz);
    default:
      return null;
  }
}

export function isRuntimeSchedulable(job: ScheduleJob, now = Date.now()): boolean {
  if (!job.enabled) return false;
  switch (job.schedule.kind) {
    case 'solar':
    case 'lunar':
    case 'workday':
    case 'freeDay':
    case 'holiday':
      return Boolean(job.schedule.cron);
    case 'scatter':
      return Boolean(job.schedule.input);
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
  job: ScheduleJob,
  onRun: (jobId: string) => void | Promise<void>,
): ScheduleDispose | null {
  const jobId = job.id;
  const engine = ensureEngine();
  try {
    const schedule = job.schedule;
    if (schedule.kind === 'every') {
      return engine.register(jobId, 'every', async () => {
        await onRun(jobId);
      }, { everyMs: schedule.everyMs });
    }
    if (schedule.kind === 'at') {
      return engine.register(jobId, 'at', async () => {
        await onRun(jobId);
      }, { atMs: schedule.atMs });
    }
    const resolved = jobScheduleToResolved(schedule);
    if (!resolved) return null;
    return engine.registerResolved(jobId, resolved, async () => {
      await onRun(jobId);
    });
  } catch (e: unknown) {
    console.warn(`[${loggerName}] register failed for ${jobId}:`, (e as Error)?.message || String(e));
    return null;
  }
}
