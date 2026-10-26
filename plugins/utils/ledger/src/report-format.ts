import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { formatCents, MASKED_AMOUNT } from './money.js';
import { describePeriodRange, localDateKey, periodLabel, type LedgerPeriod } from './period.js';
import type { LedgerEntry } from './store.js';

/** Total, entry count and share for one category. */
export interface CategoryTotal {
  readonly category: string;
  readonly totalCents: number;
  readonly count: number;
  readonly largestCents: number;
}

export interface PeriodSummary {
  readonly period: LedgerPeriod;
  readonly range: string;
  readonly totalCents: number;
  readonly count: number;
  readonly categories: readonly CategoryTotal[];
}

/** A reply in two versions: the full one for the owner, the masked one for public conversations. */
export interface LedgerReply {
  readonly full: string;
  readonly masked: string;
}

/** Groups entries by category, largest total first (ties by name for a stable order). */
export function totalsByCategory(entries: readonly LedgerEntry[]): CategoryTotal[] {
  const byCategory = new Map<string, { totalCents: number; count: number; largestCents: number }>();
  for (const entry of entries) {
    const current = byCategory.get(entry.category) ?? { totalCents: 0, count: 0, largestCents: 0 };
    current.totalCents += entry.amountCents;
    current.count += 1;
    current.largestCents = Math.max(current.largestCents, entry.amountCents);
    byCategory.set(entry.category, current);
  }
  const totals = [...byCategory.entries()].map(([category, value]) => ({ category, ...value }));
  totals.sort((left, right) => right.totalCents - left.totalCents || left.category.localeCompare(right.category));
  return totals;
}

export function summarize(entries: readonly LedgerEntry[], period: LedgerPeriod, nowMs: number, timeZone: string, locale?: Locale): PeriodSummary {
  let totalCents = 0;
  for (const entry of entries) totalCents += entry.amountCents;
  return {
    period,
    range: describePeriodRange(nowMs, period, timeZone, locale),
    totalCents,
    count: entries.length,
    categories: totalsByCategory(entries),
  };
}

/** Share of the total with one decimal, computed from integers. */
function sharePercent(partCents: number, totalCents: number): string {
  if (totalCents === 0) return '0';
  const tenths = Math.round((partCents * 1000) / totalCents);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function formatPeriodSummary(summary: PeriodSummary, locale?: Locale): LedgerReply {
  const label = periodLabel(summary.period, locale);
  if (summary.count === 0) {
    const empty = t(locale, 'emptySummary', { period: label, range: summary.range });
    return { full: empty, masked: empty };
  }
  const header = t(locale, 'summaryHeader', { period: label, range: summary.range });
  const fullLines = [header, t(locale, 'total', { amount: formatCents(summary.totalCents), count: summary.count })];
  const maskedLines = [header, t(locale, 'total', { amount: MASKED_AMOUNT, count: summary.count })];
  for (const category of summary.categories) {
    const share = sharePercent(category.totalCents, summary.totalCents);
    fullLines.push(t(locale, 'categoryFull', { category: category.category, amount: formatCents(category.totalCents), count: category.count, share }));
    maskedLines.push(t(locale, 'categoryMasked', { category: category.category, amount: MASKED_AMOUNT, count: category.count }));
  }
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}

export function formatCategoryStatistics(summary: PeriodSummary, locale?: Locale): LedgerReply {
  const label = periodLabel(summary.period, locale);
  if (summary.count === 0) {
    const empty = t(locale, 'emptyStats', { period: label, range: summary.range });
    return { full: empty, masked: empty };
  }
  const header = t(locale, 'statsHeader', { period: label, range: summary.range });
  const fullLines = [header];
  const maskedLines = [header];
  for (const category of summary.categories) {
    const averageCents = Math.round(category.totalCents / category.count);
    const share = sharePercent(category.totalCents, summary.totalCents);
    fullLines.push(t(locale, 'statsFull', { category: category.category, amount: formatCents(category.totalCents), count: category.count, average: formatCents(averageCents), max: formatCents(category.largestCents), share }));
    maskedLines.push(t(locale, 'statsMasked', { category: category.category, count: category.count }));
  }
  fullLines.push(t(locale, 'categoryCountTotal', { count: summary.categories.length, amount: formatCents(summary.totalCents) }));
  maskedLines.push(t(locale, 'categoryCount', { count: summary.categories.length }));
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}

export const MAX_LISTED_ENTRIES = 20;

/** Newest first, with `#id` so users can find what to delete. */
export function formatEntryList(entries: readonly LedgerEntry[], period: LedgerPeriod, nowMs: number, timeZone: string, locale?: Locale): LedgerReply {
  const label = periodLabel(period, locale);
  const range = describePeriodRange(nowMs, period, timeZone, locale);
  if (entries.length === 0) {
    const empty = t(locale, 'emptyList', { period: label, range });
    return { full: empty, masked: empty };
  }
  const newestFirst = [...entries].sort((left, right) => right.createdAt - left.createdAt || right.seq - left.seq);
  const shown = newestFirst.slice(0, MAX_LISTED_ENTRIES);
  const header = t(locale, 'listHeader', { period: label, range });
  const fullLines = [header];
  const maskedLines = [header];
  for (const entry of shown) {
    const date = localDateKey(entry.createdAt, timeZone).slice(5);
    const note = entry.note ? ` ${entry.note}` : '';
    fullLines.push(`#${entry.seq} ${date} ${entry.category} ${formatCents(entry.amountCents)}${note}`);
    maskedLines.push(`#${entry.seq} ${date} ${entry.category} ${MASKED_AMOUNT}`);
  }
  if (newestFirst.length > shown.length) {
    const more = t(locale, 'more', { count: newestFirst.length - shown.length });
    fullLines.push(more);
    maskedLines.push(more);
  }
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}
