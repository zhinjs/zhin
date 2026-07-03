import { describe, expect, it } from 'vitest';
import {
  collectAfterHolidayDates,
  collectHolidayEveDates,
  expandHolidayRangeDates,
  getHolidayRangeForDate,
  isDaysAfterHoliday,
  isHolidayEve,
  isHolidayFirstDay,
  isHolidayLastDay,
  isMakeupWorkday,
  offsetDateKey,
} from '../src/calendar-helpers.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('calendar-helpers', () => {
  it('detects national day range and first/last day', () => {
    const day = at('2024-10-01T09:00:00+08:00');
    expect(getHolidayRangeForDate(day, TZ)?.festival).toBe('国庆节');
    expect(isHolidayFirstDay(day, TZ)).toBe(true);
    expect(isHolidayLastDay(at('2024-10-07T09:00:00+08:00'), TZ)).toBe(true);
  });

  it('detects holiday eve and days after holiday', () => {
    expect(isHolidayEve(at('2024-09-30T09:00:00+08:00'), ['国庆节'], 1, TZ)).toBe(true);
    expect(isDaysAfterHoliday(at('2024-10-08T09:00:00+08:00'), ['国庆节'], 1, TZ)).toBe(true);
  });

  it('detects makeup workday', () => {
    expect(isMakeupWorkday(at('2024-09-29T09:00:00+08:00'), TZ)).toBe(true);
    expect(isMakeupWorkday(at('2024-09-25T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('returns null and false for ordinary workdays', () => {
    const day = at('2024-09-25T09:00:00+08:00');
    expect(getHolidayRangeForDate(day, TZ)).toBeNull();
    expect(isHolidayFirstDay(day, TZ)).toBe(false);
    expect(isHolidayLastDay(day, TZ)).toBe(false);
  });

  it('supports multi-day eve and after-holiday windows', () => {
    expect(isHolidayEve(at('2024-09-29T09:00:00+08:00'), ['国庆节'], 2, TZ)).toBe(true);
    expect(isDaysAfterHoliday(at('2024-10-08T09:00:00+08:00'), ['国庆节'], 2, TZ)).toBe(true);
    expect(collectHolidayEveDates(['国庆节'], 1).has('2024-09-30')).toBe(true);
    expect(collectAfterHolidayDates(['国庆节'], 1).has('2024-10-08')).toBe(true);
  });

  it('offsets date keys and expands holiday ranges', () => {
    expect(offsetDateKey('2024-09-30', 1)).toBe('2024-10-01');
    expect(expandHolidayRangeDates('2024-10-01', '2024-10-03')).toEqual([
      '2024-10-01',
      '2024-10-02',
      '2024-10-03',
    ]);
  });
});
