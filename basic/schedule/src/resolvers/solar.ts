import { matchesCron, parseCron } from '../parsers/cron.js';
import {
  addMinutes,
  getDatePartsInTimezone,
  startOfNextSecond,
  zonedTimeToUtc,
} from '../utils/timezone.js';

const MAX_SCAN_MINUTES = 366 * 24 * 60;

export function getSolarNextRun(from: Date, cron: string, timezone: string): Date | null {
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

      if (candidate > from && matchesCron(fields, candidate, timezone)) {
        return candidate;
      }
    }

    cursor = addMinutes(cursor, 1);
    cursor.setSeconds(0, 0);
  }

  return null;
}

export function isSolarDue(at: Date, cron: string, timezone: string): boolean {
  const fields = parseCron(cron);
  return matchesCron(fields, at, timezone);
}
