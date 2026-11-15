/** Auto-refresh choices offered by RefreshControl, in milliseconds (0 = manual). */
export const DEFAULT_REFRESH_INTERVALS: readonly number[] = Object.freeze([0, 5_000, 15_000, 30_000]);

/** The offered intervals plus `current` when it is not one of them (kept, so a custom value is not lost). */
export function refreshIntervalOptions(current: number, intervals: readonly number[] = DEFAULT_REFRESH_INTERVALS): number[] {
  const values = [...new Set(intervals.filter(isValidInterval))];
  if (isValidInterval(current) && !values.includes(current)) values.push(current);
  return values.sort((left, right) => left - right);
}

export function isValidInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 「hh:mm:ss」 in 24-hour time; `null` when there is no valid time yet. */
export function formatRefreshTime(value: Date | number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Whole seconds shown in the 「5s 自动」 label. */
export function intervalSeconds(intervalMs: number): number {
  return Math.max(1, Math.round(intervalMs / 1000));
}
