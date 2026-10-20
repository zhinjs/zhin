import { parseCron, parseCronTime } from '../parsers/cron.js';
import { planFilteredTimeStep } from '../planning/solar-planner.js';
import { getDatePartsInTimezone } from '../utils/timezone.js';
import { getZonedClock } from '../utils/zoned-clock.js';

const MAX_SCAN_DAYS = 400;
const MS_PER_DAY = 86_400_000;

function getCalendarExactTimeNextRun(
  from: Date,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  const clock = getZonedClock(timezone);
  let cursor = from;

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = clock.partsAt(cursor);
    const candidate = clock.toUtc(parts.year, parts.month, parts.day, hour, minute, second);

    if (candidate > from && isAllowedDay(candidate)) {
      return candidate;
    }

    cursor = new Date(cursor.getTime() + MS_PER_DAY);
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
    return planFilteredTimeStep(from, cron, timezone, isAllowedDay);
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
    const parts = getZonedClock(timezone).cronPartsAt(at);
    const dow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;
    const secondMatch = fields.second.includes(parts.second);
    const minuteMatch = fields.minute.includes(parts.minute);
    const hourMatch = fields.hour.includes(parts.hour);
    return secondMatch && minuteMatch && hourMatch;
  }
}
