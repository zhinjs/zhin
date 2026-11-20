import { formatDateTime } from 'zhin.js';

/**
 * Calendar day (`YYYY-MM-DD`) of a report or prediction in the process time zone (`TZ`, else the
 * system zone; the plugin has no time-zone setting). #1250: `toISOString().slice(0, 10)` took the
 * UTC day, so in Asia/Shanghai a report made between 00:00 and 08:00 was filed under the day before.
 */
export function lotteryDateKey(date: Date = new Date()): string {
  return formatDateTime(date, undefined, { part: 'date' });
}
