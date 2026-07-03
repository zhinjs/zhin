import { parseCron, type CronFields } from '../parsers/cron.js';
import { solarDateToLunar, type LunarDate } from '../data/lunar-table.js';
import { getDatePartsInTimezone, zonedTimeToUtc } from '../utils/timezone.js';

const MS_PER_DAY = 86_400_000;
const MAX_SCAN_DAYS = 400;

function matchesLunarDate(fields: CronFields, lunar: LunarDate): boolean {
  const monthMatch = fields.month.length === 12 || fields.month.includes(lunar.month);
  const dayMatch = fields.dayOfMonth.length === 31 || fields.dayOfMonth.includes(lunar.day);
  if (!monthMatch || !dayMatch) {
    return false;
  }
  return !lunar.isLeapMonth;
}

export function getLunarNextRun(from: Date, cron: string, timezone: string): Date | null {
  const fields = parseCron(cron);
  const hour = fields.hour[0];
  const minute = fields.minute[0];
  const second = fields.second[0];

  let cursor = new Date(from.getTime());
  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const parts = getDatePartsInTimezone(cursor, timezone);
    const lunar = solarDateToLunar(cursor, timezone);

    if (matchesLunarDate(fields, lunar)) {
      const candidate = zonedTimeToUtc(
        parts.year,
        parts.month,
        parts.day,
        hour,
        minute,
        second,
        timezone,
      );
      if (candidate > from) {
        return candidate;
      }
    }

    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }

  return null;
}

export function isLunarDue(at: Date, cron: string, timezone: string): boolean {
  const fields = parseCron(cron);
  const lunar = solarDateToLunar(at, timezone);
  if (!matchesLunarDate(fields, lunar)) {
    return false;
  }
  const parts = getDatePartsInTimezone(at, timezone);
  return (
    parts.hour === fields.hour[0] &&
    parts.minute === fields.minute[0] &&
    parts.second === fields.second[0]
  );
}
