import { matchesCron, parseCron, parseCronTime } from '../parsers/cron.js';
import {
  addMinutes,
  getDatePartsInTimezone,
  startOfNextSecond,
  zonedTimeToUtc,
} from '../utils/timezone.js';

const MAX_SCAN_DAYS = 400;
const MAX_SCAN_MINUTES = 366 * 24 * 60;
const MS_PER_DAY = 86_400_000;

function getCalendarExactTimeNextRun(
  from: Date,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  let cursor = from;

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = getDatePartsInTimezone(cursor, timezone);
    const candidate = zonedTimeToUtc(
      parts.year,
      parts.month,
      parts.day,
      hour,
      minute,
      second,
      timezone,
    );

    if (candidate > from && isAllowedDay(candidate)) {
      return candidate;
    }

    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }

  return null;
}

function getCalendarStepNextRun(
  from: Date,
  cron: string,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
): Date | null {
  const fields = parseCron(cron);
  let cursor = startOfNextSecond(from);

  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    const parts = getDatePartsInTimezone(cursor, timezone);

    for (const second of fields.second) {
      const candidate = zonedTimeToUtc(
        parts.year,
        parts.month,
        parts.day,
        parts.hour,
        parts.minute,
        second,
        timezone,
      );

      if (candidate > from && matchesCron(fields, candidate, timezone) && isAllowedDay(candidate)) {
        return candidate;
      }
    }

    cursor = addMinutes(cursor, 1);
    cursor.setSeconds(0, 0);
  }

  return null;
}

/** 在语义允许的日历日上，按 calendar cron 匹配下一触发时刻（含步进语法） */
export function getCalendarCronNextRun(
  from: Date,
  cron: string,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
): Date | null {
  try {
    const { hour, minute, second } = parseCronTime(cron);
    return getCalendarExactTimeNextRun(from, timezone, isAllowedDay, hour, minute, second);
  } catch {
    return getCalendarStepNextRun(from, cron, timezone, isAllowedDay);
  }
}

export function isCalendarCronDue(
  at: Date,
  cron: string,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
): boolean {
  if (!isAllowedDay(at)) {
    return false;
  }

  try {
    const { hour, minute, second } = parseCronTime(cron);
    const parts = getDatePartsInTimezone(at, timezone);
    return parts.hour === hour && parts.minute === minute && parts.second === second;
  } catch {
    const fields = parseCron(cron);
    return matchesCron(fields, at, timezone);
  }
}
