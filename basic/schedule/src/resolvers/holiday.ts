import { HolidayCalendar } from '../holiday-calendar.js';
import type { FestivalFilter, FestivalName, ResolvedJob } from '../types.js';
import { formatDateKey } from '../utils/timezone.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedHolidayJob = Extract<ResolvedJob, { kind: 'holiday' }>;
export type { HolidayRange, HolidayYearData } from '../holiday-calendar.js';

export function isWorkday(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  return holidays.isWorkday(date, timezone);
}

export function getFestivalForDate(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): FestivalName | undefined {
  return holidays.festivalForDate(date, timezone);
}

export function isHolidayCalendarDay(
  date: Date,
  festivals: FestivalFilter,
  everyDayOfHoliday: boolean,
  timezone: string,
  holidays = new HolidayCalendar(),
): boolean {
  return holidays.collectHolidayDates(festivals, everyDayOfHoliday).has(
    formatDateKey(date, timezone),
  );
}

export function getHolidayNextRun(
  from: Date,
  job: ResolvedHolidayJob,
  holidays = new HolidayCalendar(),
): Date | null {
  const candidates = holidays.collectHolidayDates(job.festivals, job.everyDayOfHoliday);
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    candidates.has(formatDateKey(date, job.timezone)),
  );
}

export function isHolidayDue(
  at: Date,
  job: ResolvedHolidayJob,
  holidays = new HolidayCalendar(),
): boolean {
  const candidates = holidays.collectHolidayDates(job.festivals, job.everyDayOfHoliday);
  return isCalendarCronDue(at, job.cron, job.timezone, (date) =>
    candidates.has(formatDateKey(date, job.timezone)),
  );
}
