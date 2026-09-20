import type { ResolvedJob } from '../types.js';
import { HolidayCalendar } from '../holiday-calendar.js';
import { isWorkday } from './holiday.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedWorkdayJob = Extract<ResolvedJob, { kind: 'workday' }>;

export function getWorkdayNextRun(
  from: Date,
  job: ResolvedWorkdayJob,
  holidays = new HolidayCalendar(),
): Date | null {
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    isWorkday(date, job.timezone, holidays),
  );
}

export function isWorkdayDue(
  at: Date,
  job: ResolvedWorkdayJob,
  holidays = new HolidayCalendar(),
): boolean {
  return isCalendarCronDue(at, job.cron, job.timezone, (date) =>
    isWorkday(date, job.timezone, holidays),
  );
}
