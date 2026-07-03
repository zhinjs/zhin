import {
  expandRange,
  getWorkdaySet,
  getYearData,
  iterateYears,
  type HolidayRange,
} from './data/holiday-registry.js';
import { matchesFestivalFilter, normalizeFestivalKey } from './utils/festival-map.js';
import { formatDateKey, getDatePartsInTimezone } from './utils/timezone.js';
import type { FestivalFilter, FestivalName } from './types.js';

export interface HolidayRangeInfo {
  start: string;
  end: string;
  festival: FestivalName;
}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map((v) => parseInt(v, 10));
  return { year: y, month: m, day: d };
}

function formatDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function offsetDateKey(dateKey: string, days: number): string {
  const parts = parseDateKey(dateKey);
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return formatDateKeyFromParts(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    cursor.getUTCDate(),
  );
}

function collectMatchingRanges(festivals: FestivalFilter): HolidayRange[] {
  const ranges: HolidayRange[] = [];
  iterateYears((_year, data) => {
    for (const range of data.holidayRanges) {
      if (matchesFestivalFilter(range.festival, festivals)) {
        ranges.push(range);
      }
    }
  });
  return ranges;
}

export function getHolidayRangeForDate(
  date: Date,
  timezone = 'Asia/Shanghai',
): HolidayRangeInfo | null {
  const key = formatDateKey(date, timezone);
  const parts = getDatePartsInTimezone(date, timezone);
  const data = getYearData(parts.year);
  if (!data) {
    return null;
  }

  for (const range of data.holidayRanges) {
    if (key >= range.start && key <= range.end) {
      return {
        start: range.start,
        end: range.end,
        festival: normalizeFestivalKey(range.festival)!,
      };
    }
  }
  return null;
}

export function isHolidayFirstDay(date: Date, timezone = 'Asia/Shanghai'): boolean {
  const range = getHolidayRangeForDate(date, timezone);
  if (!range) {
    return false;
  }
  return formatDateKey(date, timezone) === range.start;
}

export function isHolidayLastDay(date: Date, timezone = 'Asia/Shanghai'): boolean {
  const range = getHolidayRangeForDate(date, timezone);
  if (!range) {
    return false;
  }
  return formatDateKey(date, timezone) === range.end;
}

export function isHolidayEve(
  date: Date,
  festivals: FestivalFilter = 'all',
  daysBefore = 1,
  timezone = 'Asia/Shanghai',
): boolean {
  const key = formatDateKey(date, timezone);
  for (const range of collectMatchingRanges(festivals)) {
    const eveStart = offsetDateKey(range.start, -daysBefore);
    const eveEnd = offsetDateKey(range.start, -1);
    if (key >= eveStart && key <= eveEnd) {
      return true;
    }
  }
  return false;
}

export function isDaysAfterHoliday(
  date: Date,
  festivals: FestivalFilter,
  daysAfter: number,
  timezone = 'Asia/Shanghai',
): boolean {
  const key = formatDateKey(date, timezone);
  for (const range of collectMatchingRanges(festivals)) {
    const afterStart = offsetDateKey(range.end, 1);
    const afterEnd = offsetDateKey(range.end, daysAfter);
    if (key >= afterStart && key <= afterEnd) {
      return true;
    }
  }
  return false;
}

export function isMakeupWorkday(date: Date, timezone = 'Asia/Shanghai'): boolean {
  const parts = getDatePartsInTimezone(date, timezone);
  const workdays = getWorkdaySet(parts.year);
  if (!workdays) {
    return false;
  }
  return workdays.has(formatDateKey(date, timezone));
}

export function collectHolidayEveDates(
  festivals: FestivalFilter,
  daysBefore = 1,
): Set<string> {
  const dates = new Set<string>();
  for (const range of collectMatchingRanges(festivals)) {
    for (let i = daysBefore; i >= 1; i--) {
      dates.add(offsetDateKey(range.start, -i));
    }
  }
  return dates;
}

export function collectAfterHolidayDates(
  festivals: FestivalFilter,
  daysAfter: number,
): Set<string> {
  const dates = new Set<string>();
  for (const range of collectMatchingRanges(festivals)) {
    for (let i = 1; i <= daysAfter; i++) {
      dates.add(offsetDateKey(range.end, i));
    }
  }
  return dates;
}

/** @internal exported for tests */
export function expandHolidayRangeDates(start: string, end: string): string[] {
  return expandRange(start, end);
}
