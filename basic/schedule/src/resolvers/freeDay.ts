import type { ResolvedJob } from '../types.js';
import { HolidayCalendar } from '../holiday-calendar.js';
import { isWorkday } from './holiday.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedFreeDayJob = Extract<ResolvedJob, { kind: 'freeDay' }>;

/** Rest day: official holidays + regular weekends, excluding makeup workdays. */
export function isFreeDay(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  return !isWorkday(date, timezone, holidays);
}

export function getFreeDayNextRun(
  from: Date,
  job: ResolvedFreeDayJob,
  holidays = new HolidayCalendar(),
): Date | null {
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    isFreeDay(date, job.timezone, holidays),
  );
}

export function isFreeDayDue(
  at: Date,
  job: ResolvedFreeDayJob,
  holidays = new HolidayCalendar(),
): boolean {
  return isCalendarCronDue(at, job.cron, job.timezone, (date) =>
    isFreeDay(date, job.timezone, holidays),
  );
}
