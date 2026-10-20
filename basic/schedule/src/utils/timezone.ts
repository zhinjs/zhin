import { getZonedClock } from './zoned-clock.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

export function getTimezoneOffsetMs(date: Date, timezone: string): number {
  return getZonedClock(timezone).offsetMs(date);
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  return getZonedClock(timezone).toUtc(year, month, day, hour, minute, second);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * MS_PER_SECOND);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

export function startOfNextSecond(date: Date): Date {
  return addSeconds(date, 1);
}

export function formatDateKey(date: Date, timezone: string): string {
  return getZonedClock(timezone).dateKey(date);
}

export function getDatePartsInTimezone(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number; dayOfWeek: number } {
  return getZonedClock(timezone).partsAt(date);
}
