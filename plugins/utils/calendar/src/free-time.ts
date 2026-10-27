import { CalendarError } from './errors.js';
/**
 * Finds free slots inside work hours between `from` and `to`, given busy events.
 */
import {
  formatInZone,
  parseDateTimeInZone,
  zonedParts,
  zonedTimeToUtc,
} from "./time.js";
import type { CalendarEvent, FreeSlot } from "./types.js";

export interface FreeTimeOptions {
  readonly from: Date;
  readonly to: Date;
  readonly durationMinutes: number;
  readonly workDayStart: string;
  readonly workDayEnd: string;
  readonly timezone: string;
  readonly events: readonly CalendarEvent[];
}

function parseHm(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new CalendarError('workTime', { value });
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Advance `instant` by one calendar day in `timeZone` (noon-based to avoid DST edges). */
function nextCalendarDay(instant: Date, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  return zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + 1,
      hour: 12,
      minute: 0,
    },
    timeZone
  );
}

/** Returns free slots of at least `durationMinutes`, clipped to work hours. */
export function findFreeSlots(options: FreeTimeOptions): FreeSlot[] {
  const startHm = parseHm(options.workDayStart);
  const endHm = parseHm(options.workDayEnd);
  const durationMs = options.durationMinutes * 60000;
  if (durationMs <= 0) throw new CalendarError('positiveDuration');

  const busy = options.events
    .map((event) => ({
      start: parseDateTimeInZone(event.start, options.timezone).getTime(),
      end: parseDateTimeInZone(event.end, options.timezone).getTime(),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.start) && Number.isFinite(interval.end)
    )
    .sort((a, b) => a.start - b.start);

  const slots: FreeSlot[] = [];
  // Walk calendar days via noon anchors so dayEnd+1min cannot stall the loop.
  let cursorNoon = zonedTimeToUtc(
    (() => {
      const parts = zonedParts(options.from, options.timezone);
      return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: 12,
        minute: 0,
      };
    })(),
    options.timezone
  );
  const toMs = options.to.getTime();
  let guard = 0;
  while (cursorNoon.getTime() < toMs + 24 * 3600 * 1000 && guard < 400) {
    guard += 1;
    const parts = zonedParts(cursorNoon, options.timezone);
    const dayStart = zonedTimeToUtc(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: startHm.hour,
        minute: startHm.minute,
      },
      options.timezone
    ).getTime();
    const dayEnd = zonedTimeToUtc(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: endHm.hour,
        minute: endHm.minute,
      },
      options.timezone
    ).getTime();
    if (dayEnd <= options.from.getTime()) {
      cursorNoon = nextCalendarDay(cursorNoon, options.timezone);
      continue;
    }
    if (dayStart >= toMs) break;

    let freeStart = Math.max(dayStart, options.from.getTime());
    const freeEndLimit = Math.min(dayEnd, toMs);
    for (const interval of busy) {
      if (interval.end <= freeStart || interval.start >= freeEndLimit) continue;
      if (interval.start - freeStart >= durationMs) {
        slots.push({
          start: formatInZone(new Date(freeStart), options.timezone),
          end: formatInZone(new Date(interval.start), options.timezone),
        });
      }
      freeStart = Math.max(freeStart, interval.end);
    }
    if (freeEndLimit - freeStart >= durationMs) {
      slots.push({
        start: formatInZone(new Date(freeStart), options.timezone),
        end: formatInZone(new Date(freeEndLimit), options.timezone),
      });
    }
    cursorNoon = nextCalendarDay(cursorNoon, options.timezone);
  }
  return slots;
}
