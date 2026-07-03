import type { FestivalFilter, FestivalName, ResolvedJob } from '../types.js';
import {
  expandRange,
  getHolidaySet,
  getWorkdaySet,
  getYearData,
  iterateYears,
} from '../data/holiday-registry.js';
import { matchesFestivalFilter, normalizeFestivalKey } from '../utils/festival-map.js';
import { formatDateKey, getDatePartsInTimezone } from '../utils/timezone.js';
import { getCalendarCronNextRun, isCalendarCronDue } from './calendar-cron.js';

export type ResolvedHolidayJob = Extract<ResolvedJob, { kind: 'holiday' }>;

export type { HolidayRange, HolidayYearData } from '../data/holiday-registry.js';
export {
  MIN_HOLIDAY_YEAR,
  MAX_HOLIDAY_YEAR,
  getMinHolidayYear,
  getMaxHolidayYear,
  onHolidayDataUpdate,
} from '../data/holiday-registry.js';

function isDateInRange(key: string, start: string, end: string): boolean {
  return key >= start && key <= end;
}

export function isWorkday(date: Date, timezone = 'Asia/Shanghai'): boolean {
  const parts = getDatePartsInTimezone(date, timezone);
  const key = formatDateKey(date, timezone);

  const holidays = getHolidaySet(parts.year);
  const workdays = getWorkdaySet(parts.year);
  if (!holidays || !workdays) {
    return parts.dayOfWeek >= 1 && parts.dayOfWeek <= 5;
  }

  if (holidays.has(key)) {
    return false;
  }
  if (workdays.has(key)) {
    return true;
  }
  return parts.dayOfWeek >= 1 && parts.dayOfWeek <= 5;
}

export function getFestivalForDate(
  date: Date,
  timezone = 'Asia/Shanghai',
): FestivalName | undefined {
  const parts = getDatePartsInTimezone(date, timezone);
  const key = formatDateKey(date, timezone);
  const data = getYearData(parts.year);
  if (!data) {
    return undefined;
  }

  for (const range of data.holidayRanges) {
    if (isDateInRange(key, range.start, range.end)) {
      return normalizeFestivalKey(range.festival);
    }
  }

  return undefined;
}

function collectHolidayTriggerDates(
  festivals: FestivalFilter,
  everyDayOfHoliday: boolean,
): string[] {
  const dates = new Set<string>();

  iterateYears((_year, data) => {
    for (const range of data.holidayRanges) {
      if (!matchesFestivalFilter(range.festival, festivals)) {
        continue;
      }
      if (everyDayOfHoliday) {
        for (const date of expandRange(range.start, range.end)) {
          dates.add(date);
        }
      } else {
        dates.add(range.start);
      }
    }
  });

  return [...dates].sort();
}

export function isHolidayCalendarDay(
  date: Date,
  festivals: FestivalFilter,
  everyDayOfHoliday: boolean,
  timezone: string,
): boolean {
  const key = formatDateKey(date, timezone);
  const candidateSet = new Set(collectHolidayTriggerDates(festivals, everyDayOfHoliday));
  return candidateSet.has(key);
}

function isHolidayTriggerDay(
  at: Date,
  job: ResolvedHolidayJob,
  candidateSet: Set<string>,
): boolean {
  return candidateSet.has(formatDateKey(at, job.timezone));
}

export function getHolidayNextRun(from: Date, job: ResolvedHolidayJob): Date | null {
  const candidateSet = new Set(collectHolidayTriggerDates(job.festivals, job.everyDayOfHoliday));
  return getCalendarCronNextRun(from, job.cron, job.timezone, (date) =>
    isHolidayTriggerDay(date, job, candidateSet),
  );
}

export function isHolidayDue(at: Date, job: ResolvedHolidayJob): boolean {
  const candidateSet = new Set(collectHolidayTriggerDates(job.festivals, job.everyDayOfHoliday));
  return isCalendarCronDue(at, job.cron, job.timezone, (date) =>
    isHolidayTriggerDay(date, job, candidateSet),
  );
}
