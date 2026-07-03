import type { ResolvedJob } from '../types.js';
import { isWorkday } from './holiday.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedFreeDayJob = Extract<ResolvedJob, { kind: 'freeDay' }>;

/** Rest day: official holidays + regular weekends, excluding makeup workdays. */
export function isFreeDay(date: Date, timezone = 'Asia/Shanghai'): boolean {
  return !isWorkday(date, timezone);
}

export function getFreeDayNextRun(from: Date, job: ResolvedFreeDayJob): Date | null {
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    isFreeDay(date, job.timezone),
  );
}

export function isFreeDayDue(at: Date, job: ResolvedFreeDayJob): boolean {
  return isCalendarCronDue(at, job.cron, job.timezone, (date) => isFreeDay(date, job.timezone));
}
