import {
  expandHolidayRange,
  HolidayCalendar,
  offsetDateKey,
  type HolidayRangeInfo,
} from './holiday-calendar.js';
import { formatDateKey } from './utils/timezone.js';
import type { FestivalFilter } from './types.js';

export type { HolidayRangeInfo } from './holiday-calendar.js';
export { offsetDateKey } from './holiday-calendar.js';

export function getHolidayRangeForDate(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): HolidayRangeInfo | null {
  return holidays.holidayRangeForDate(date, timezone);
}

export function isHolidayFirstDay(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  const range = holidays.holidayRangeForDate(date, timezone);
  return range != null && formatDateKey(date, timezone) === range.start;
}

export function isHolidayLastDay(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  const range = holidays.holidayRangeForDate(date, timezone);
  return range != null && formatDateKey(date, timezone) === range.end;
}

export function isHolidayEve(
  date: Date,
  festivals: FestivalFilter = 'all',
  daysBefore = 1,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  return holidays.collectHolidayEveDates(festivals, daysBefore).has(
    formatDateKey(date, timezone),
  );
}

export function isDaysAfterHoliday(
  date: Date,
  festivals: FestivalFilter,
  daysAfter: number,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  return holidays.collectAfterHolidayDates(festivals, daysAfter).has(
    formatDateKey(date, timezone),
  );
}

export function isMakeupWorkday(
  date: Date,
  timezone = 'Asia/Shanghai',
  holidays = new HolidayCalendar(),
): boolean {
  return holidays.isMakeupWorkday(date, timezone);
}

export function collectHolidayEveDates(
  festivals: FestivalFilter,
  daysBefore = 1,
  holidays = new HolidayCalendar(),
): ReadonlySet<string> {
  return holidays.collectHolidayEveDates(festivals, daysBefore);
}

export function collectAfterHolidayDates(
  festivals: FestivalFilter,
  daysAfter: number,
  holidays = new HolidayCalendar(),
): ReadonlySet<string> {
  return holidays.collectAfterHolidayDates(festivals, daysAfter);
}

/** @internal exported for tests */
export function expandHolidayRangeDates(start: string, end: string): string[] {
  return expandHolidayRange(start, end);
}
