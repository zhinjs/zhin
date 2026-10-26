import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/**
 * Calendar periods evaluated in the configured IANA timezone. Entries are compared by their
 * local calendar date (YYYY-MM-DD), so daylight-saving shifts never move an entry into another day.
 */

export type LedgerPeriod = 'today' | 'week' | 'month' | 'all';

const DAY_MS = 86_400_000;

export function periodLabel(period: LedgerPeriod, locale?: Locale): string { return t(locale, `period.${period}`); }

/** Maps a user-typed period word to a period; undefined when the word is not recognised. */
export function parsePeriodWord(word: string | undefined, fallback: LedgerPeriod, locale?: Locale): LedgerPeriod | undefined {
  if (word === undefined || word.trim() === '') return fallback;
  const normalized = word.trim();
  if (resolveLocale(locale) === 'en') return ['today', 'week', 'month', 'all'].includes(normalized.toLowerCase()) ? normalized.toLowerCase() as LedgerPeriod : undefined;
  if (normalized === '今日' || normalized === '今天') return 'today';
  if (normalized === '本周' || normalized === '这周') return 'week';
  if (normalized === '本月' || normalized === '这个月') return 'month';
  if (normalized === '全部' || normalized === '所有') return 'all';
  return undefined;
}

function partsIn(instantMs: number, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instantMs)) parts[part.type] = part.value;
  return parts;
}

/** Local calendar date `YYYY-MM-DD` of an instant in a timezone. */
export function localDateKey(instantMs: number, timeZone: string): string {
  const parts = partsIn(instantMs, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Local wall-clock time `HH:MM` of an instant in a timezone. */
export function localTimeKey(instantMs: number, timeZone: string): string {
  const parts = partsIn(instantMs, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function dateKeyToUtcMs(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function utcMsToDateKey(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing a local date. */
export function weekStartKey(dateKey: string): string {
  const utcMs = dateKeyToUtcMs(dateKey);
  const dayOfWeek = new Date(utcMs).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return utcMsToDateKey(utcMs - daysSinceMonday * DAY_MS);
}

/** Sunday that ends the ISO week starting on `weekStart`. */
export function weekEndKey(weekStart: string): string {
  return utcMsToDateKey(dateKeyToUtcMs(weekStart) + 6 * DAY_MS);
}

/** Whether an entry made at `entryMs` falls in `period` as seen at `nowMs`. */
export function isInPeriod(entryMs: number, nowMs: number, period: LedgerPeriod, timeZone: string): boolean {
  if (period === 'all') return true;
  const entryDate = localDateKey(entryMs, timeZone);
  const today = localDateKey(nowMs, timeZone);
  if (period === 'today') return entryDate === today;
  if (period === 'month') return entryDate.slice(0, 7) === today.slice(0, 7);
  return weekStartKey(entryDate) === weekStartKey(today);
}

/** Human-readable range for a period header, e.g. `2026-10-19 ~ 2026-10-25`. */
export function describePeriodRange(nowMs: number, period: LedgerPeriod, timeZone: string, locale?: Locale): string {
  const today = localDateKey(nowMs, timeZone);
  if (period === 'today') return today;
  if (period === 'month') return today.slice(0, 7);
  if (period === 'week') {
    const start = weekStartKey(today);
    return `${start} ~ ${weekEndKey(start)}`;
  }
  return t(locale, 'allRecords');
}
