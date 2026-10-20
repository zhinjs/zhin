import type { CronFields } from '../parsers/cron.js';
import { matchesCron, parseCron } from '../parsers/cron.js';
import { addMinutes, startOfNextSecond } from '../utils/timezone.js';
import { getZonedClock, type ZonedClock, type ZonedDateParts } from '../utils/zoned-clock.js';

const MAX_SCAN_DAYS = 400;
const MAX_SCAN_MINUTES = 366 * 24 * 60;

function isDomWildcard(fields: CronFields): boolean {
  return fields.dayOfMonth.length === 31;
}

function isMonthWildcard(fields: CronFields): boolean {
  return fields.month.length === 12;
}

function isDowWildcard(fields: CronFields): boolean {
  return (
    fields.dayOfWeek.length === 8 ||
    (fields.dayOfWeek.length === 7 && fields.dayOfWeek.every((d) => d >= 0 && d <= 7))
  );
}

function isSingleValue(values: number[]): boolean {
  return values.length === 1;
}

function isFixedCalendarDate(fields: CronFields): boolean {
  return (
    isSingleValue(fields.month) &&
    isSingleValue(fields.dayOfMonth) &&
    isDowWildcard(fields) &&
    isSingleValue(fields.second) &&
    isSingleValue(fields.minute) &&
    isSingleValue(fields.hour)
  );
}

function isTimeStepOnly(fields: CronFields): boolean {
  return isDomWildcard(fields) && isMonthWildcard(fields) && isDowWildcard(fields);
}

function matchesDayFields(fields: CronFields, parts: ZonedDateParts): boolean {
  const dow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;
  const domWildcard = isDomWildcard(fields);
  const dowWildcard = isDowWildcard(fields);
  const domMatch = fields.dayOfMonth.includes(parts.day);
  const dowMatch = fields.dayOfWeek.includes(dow);
  const monthMatch = fields.month.includes(parts.month);

  if (!monthMatch) {
    return false;
  }

  let dayMatch: boolean;
  if (!domWildcard && !dowWildcard) {
    dayMatch = domMatch || dowMatch;
  } else if (!domWildcard) {
    dayMatch = domMatch;
  } else if (!dowWildcard) {
    dayMatch = dowMatch;
  } else {
    dayMatch = true;
  }

  return dayMatch;
}

function findNextTimeOnDay(
  fields: CronFields,
  parts: ZonedDateParts,
  from: Date,
  clock: ZonedClock,
): Date | null {
  for (const hour of fields.hour) {
    if (hour < parts.hour) {
      continue;
    }
    for (const minute of fields.minute) {
      if (hour === parts.hour && minute < parts.minute) {
        continue;
      }
      for (const second of fields.second) {
        if (hour === parts.hour && minute === parts.minute && second <= parts.second) {
          continue;
        }
        const candidate = clock.toUtc(parts.year, parts.month, parts.day, hour, minute, second);
        if (candidate > from && matchesCron(fields, candidate, clock.timezone)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function planFixedCalendarDate(from: Date, fields: CronFields, clock: ZonedClock): Date | null {
  const month = fields.month[0];
  const day = fields.dayOfMonth[0];
  const hour = fields.hour[0];
  const minute = fields.minute[0];
  const second = fields.second[0];
  const fromYear = clock.partsAt(from).year;

  for (let year = fromYear; year <= fromYear + 1; year++) {
    const candidate = clock.toUtc(year, month, day, hour, minute, second);
    if (candidate > from) {
      return candidate;
    }
  }

  return clock.toUtc(fromYear + 1, month, day, hour, minute, second);
}

function planTimeStep(from: Date, fields: CronFields, clock: ZonedClock): Date | null {
  let cursor = startOfNextSecond(from);

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = clock.partsAt(cursor);
    const candidate = findNextTimeOnDay(fields, parts, from, clock);
    if (candidate) {
      return candidate;
    }
    cursor = clock.nextLocalDayStart(cursor);
  }

  return null;
}

function planDayScan(from: Date, fields: CronFields, clock: ZonedClock): Date | null {
  let cursor = startOfNextSecond(from);

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = clock.partsAt(cursor);
    if (matchesDayFields(fields, parts)) {
      const candidate = findNextTimeOnDay(fields, parts, from, clock);
      if (candidate) {
        return candidate;
      }
    }
    cursor = clock.nextLocalDayStart(cursor);
  }

  return null;
}

function planMinuteScanFallback(from: Date, fields: CronFields, clock: ZonedClock): Date | null {
  let cursor = startOfNextSecond(from);

  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    const parts = clock.partsAt(cursor);

    for (const second of fields.second) {
      const candidate = clock.toUtc(
        parts.year,
        parts.month,
        parts.day,
        parts.hour,
        parts.minute,
        second,
      );
      if (candidate > from && matchesCron(fields, candidate, clock.timezone)) {
        return candidate;
      }
    }

    cursor = addMinutes(cursor, 1);
    cursor.setSeconds(0, 0);
  }

  return null;
}

/**
 * Solar 下一触发时刻规划器：按 cron 形态选算法，避免无脑分钟全扫。
 */
export function planSolarNextRun(from: Date, cron: string, timezone: string): Date | null {
  const fields = parseCron(cron);
  const clock = getZonedClock(timezone);

  if (isFixedCalendarDate(fields)) {
    return planFixedCalendarDate(from, fields, clock);
  }
  if (isTimeStepOnly(fields)) {
    return planTimeStep(from, fields, clock);
  }
  if (!isDomWildcard(fields) || !isMonthWildcard(fields) || !isDowWildcard(fields)) {
    const byDay = planDayScan(from, fields, clock);
    if (byDay) {
      return byDay;
    }
  }

  return planMinuteScanFallback(from, fields, clock);
}

/** calendar cron 步进语法 + 日历日过滤（workday/freeDay 等） */
export function planFilteredTimeStep(
  from: Date,
  cron: string,
  timezone: string,
  isAllowedDay: (date: Date) => boolean,
): Date | null {
  const fields = parseCron(cron);
  const clock = getZonedClock(timezone);
  let cursor = startOfNextSecond(from);

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = clock.partsAt(cursor);
    const candidate = findNextTimeOnDay(fields, parts, from, clock);
    if (candidate && isAllowedDay(candidate)) {
      return candidate;
    }
    cursor = clock.nextLocalDayStart(cursor);
  }

  return null;
}
