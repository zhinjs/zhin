import type { ResolvedJob } from '../types.js';
import { isWorkday } from './holiday.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedWorkdayJob = Extract<ResolvedJob, { kind: 'workday' }>;

export function getWorkdayNextRun(from: Date, job: ResolvedWorkdayJob): Date | null {
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    isWorkday(date, job.timezone),
  );
}

export function isWorkdayDue(at: Date, job: ResolvedWorkdayJob): boolean {
  return isCalendarCronDue(at, job.cron, job.timezone, (date) => isWorkday(date, job.timezone));
}
