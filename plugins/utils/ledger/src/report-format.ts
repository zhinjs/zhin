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

export function summarize(entries: readonly LedgerEntry[], period: LedgerPeriod, nowMs: number, timeZone: string): PeriodSummary {
  let totalCents = 0;
  for (const entry of entries) totalCents += entry.amountCents;
  return {
    period,
    range: describePeriodRange(nowMs, period, timeZone),
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

export function formatPeriodSummary(summary: PeriodSummary): LedgerReply {
  const label = periodLabel(summary.period);
  if (summary.count === 0) {
    const empty = `📒 ${label}还没有记账（${summary.range}）`;
    return { full: empty, masked: empty };
  }
  const header = `📒 ${label}消费（${summary.range}）`;
  const fullLines = [header, `合计 ${formatCents(summary.totalCents)} · ${summary.count} 笔`];
  const maskedLines = [header, `合计 ${MASKED_AMOUNT} · ${summary.count} 笔`];
  for (const category of summary.categories) {
    const share = sharePercent(category.totalCents, summary.totalCents);
    fullLines.push(`· ${category.category} ${formatCents(category.totalCents)}（${category.count} 笔，${share}%）`);
    maskedLines.push(`· ${category.category} ${MASKED_AMOUNT}（${category.count} 笔）`);
  }
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}

export function formatCategoryStatistics(summary: PeriodSummary): LedgerReply {
  const label = periodLabel(summary.period);
  if (summary.count === 0) {
    const empty = `📊 ${label}没有可统计的记账（${summary.range}）`;
    return { full: empty, masked: empty };
  }
  const header = `📊 分类统计 · ${label}（${summary.range}）`;
  const fullLines = [header];
  const maskedLines = [header];
  for (const category of summary.categories) {
    const averageCents = Math.round(category.totalCents / category.count);
    const share = sharePercent(category.totalCents, summary.totalCents);
    fullLines.push(`· ${category.category}：合计 ${formatCents(category.totalCents)}，${category.count} 笔，平均 ${formatCents(averageCents)}，最大 ${formatCents(category.largestCents)}，占比 ${share}%`);
    maskedLines.push(`· ${category.category}：${category.count} 笔，金额已隐藏`);
  }
  fullLines.push(`共 ${summary.categories.length} 个类别 · 合计 ${formatCents(summary.totalCents)}`);
  maskedLines.push(`共 ${summary.categories.length} 个类别`);
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}

export const MAX_LISTED_ENTRIES = 20;

/** Newest first, with `#id` so users can find what to delete. */
export function formatEntryList(entries: readonly LedgerEntry[], period: LedgerPeriod, nowMs: number, timeZone: string): LedgerReply {
  const label = periodLabel(period);
  const range = describePeriodRange(nowMs, period, timeZone);
  if (entries.length === 0) {
    const empty = `🧾 ${label}没有账目（${range}）`;
    return { full: empty, masked: empty };
  }
  const newestFirst = [...entries].sort((left, right) => right.createdAt - left.createdAt || right.seq - left.seq);
  const shown = newestFirst.slice(0, MAX_LISTED_ENTRIES);
  const header = `🧾 ${label}账单（${range}）`;
  const fullLines = [header];
  const maskedLines = [header];
  for (const entry of shown) {
    const date = localDateKey(entry.createdAt, timeZone).slice(5);
    const note = entry.note ? ` ${entry.note}` : '';
    fullLines.push(`#${entry.seq} ${date} ${entry.category} ${formatCents(entry.amountCents)}${note}`);
    maskedLines.push(`#${entry.seq} ${date} ${entry.category} ${MASKED_AMOUNT}`);
  }
  if (newestFirst.length > shown.length) {
    const more = `……另有 ${newestFirst.length - shown.length} 笔未显示`;
    fullLines.push(more);
    maskedLines.push(more);
  }
  return { full: fullLines.join('\n'), masked: maskedLines.join('\n') };
}
