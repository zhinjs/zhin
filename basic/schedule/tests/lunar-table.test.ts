import { describe, expect, it } from 'vitest';
import { formatLunarDateText } from '../src/utils/calendar-text.js';
import {
  MAX_LUNAR_YEAR,
  MIN_LUNAR_YEAR,
  solarDateToLunar,
  solarToLunar,
} from '../src/data/lunar-table.js';

describe('lunar-table', () => {
  it('converts known solar date to lunar', () => {
    const lunar = solarToLunar(2025, 1, 29);
    expect(lunar.month).toBe(1);
    expect(lunar.day).toBe(1);
  });

  it('solarDateToLunar uses timezone parts', () => {
    const lunar = solarDateToLunar(new Date('2025-01-29T12:00:00+08:00'), 'Asia/Shanghai');
    expect(lunar.month).toBe(1);
    expect(lunar.day).toBe(1);
  });

  it('throws for out-of-range years and early 1900 dates', () => {
    expect(() => solarToLunar(MIN_LUNAR_YEAR - 1, 1, 1)).toThrow(RangeError);
    expect(() => solarToLunar(MAX_LUNAR_YEAR + 1, 1, 1)).toThrow(RangeError);
    expect(() => solarToLunar(1900, 1, 1)).toThrow(/1900-01-31/);
  });

  it('formatLunarDateText handles leap month and fallback names', () => {
    expect(formatLunarDateText({ year: 2020, month: 4, day: 1, isLeapMonth: true })).toContain(
      '闰',
    );
    expect(formatLunarDateText({ year: 2020, month: 13, day: 32, isLeapMonth: false })).toContain(
      '13',
    );
  });
});
