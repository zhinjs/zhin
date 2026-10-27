import { CalendarError } from './errors.js';
/**
 * Timezone helpers built on Intl (no dependencies).
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Throws a readable error for unknown IANA zones. */
export function assertTimeZone(timeZone: string): void {
  try {
    formatterFor(timeZone);
  } catch {
    throw new CalendarError('timezone', { value: timeZone });
  }
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date))
    parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at instant `date`. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to a UTC instant. */
export function zonedTimeToUtc(
  wall: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string
): Date {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0
  );
  const first = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  const second = guess - timeZoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** Formats an instant as `YYYY-MM-DD HH:mm` in `timeZone`. */
export function formatInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(
    p.minute
  )}`;
}

/**
 * Parses an ISO-8601 date-time. Without an explicit offset/`Z`, the value is
 * interpreted as wall-clock time in `timeZone`.
 */
export function parseDateTimeInZone(value: string, timeZone: string): Date {
  const text = value.trim();
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new CalendarError('datetime', { value });
    return date;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!match)
    throw new CalendarError('datetimeFormat', { value });
  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? 0),
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    },
    timeZone
  );
}

/** Parses durations like `10m`, `2h30m`, `1d`, `90s`. */
export function parseDuration(value: string): number {
  const text = value.trim().toLowerCase();
  const pattern = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let consumed = "";
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2]!;
    total +=
      amount *
      { d: 86400000, h: 3600000, m: 60000, s: 1000 }[
        unit as "d" | "h" | "m" | "s"
      ];
    consumed += match[0];
  }
  if (total <= 0 || consumed.replace(/\s/g, "") !== text.replace(/\s/g, "")) {
    throw new CalendarError('duration', { value });
  }
  return total;
}
