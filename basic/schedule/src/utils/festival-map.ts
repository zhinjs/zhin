import type { FestivalFilter, FestivalName } from '../types.js';

const FESTIVAL_NAME_SET = new Set<FestivalName>([
  '元旦',
  '春节',
  '清明节',
  '劳动节',
  '端午节',
  '中秋节',
  '国庆节',
]);

export function isFestivalName(value: string): value is FestivalName {
  return FESTIVAL_NAME_SET.has(value as FestivalName);
}

export function matchesFestivalFilter(
  festival: string | undefined,
  filter: FestivalFilter,
): boolean {
  if (filter === 'all') {
    return festival != null;
  }
  if (!festival) {
    return false;
  }
  return filter.includes(festival as FestivalName);
}

export function normalizeFestivalKey(value: string): FestivalName | undefined {
  return isFestivalName(value) ? value : undefined;
}
