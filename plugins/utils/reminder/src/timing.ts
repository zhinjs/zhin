import type { Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
export const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60;

export function parseReminderInstant(value: string, locale?: Locale): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) throw new TypeError(t(locale, 'absoluteFormat'));
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u)!.slice(1).map(item => Number(item ?? 0));
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month, 0);
  const daysInMonth = calendar.getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) throw new TypeError(t(locale, 'instantInvalid'));
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time)) throw new TypeError(t(locale, 'instantInvalid'));
  return time;
}

export function nextPeriodicTime(from: number, interval: number, now: number): number {
  return from + (Math.floor((now - from) / interval) + 1) * interval;
}
