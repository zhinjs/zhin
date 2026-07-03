import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  addSeconds,
  formatDateKey,
  getDatePartsInTimezone,
  startOfNextSecond,
  zonedTimeToUtc,
} from '../src/utils/timezone.js';

const TZ = 'Asia/Shanghai';

describe('timezone utils', () => {
  it('zonedTimeToUtc converts local wall time', () => {
    const utc = zonedTimeToUtc(2025, 6, 27, 9, 0, 0, TZ);
    expect(getDatePartsInTimezone(utc, TZ)).toMatchObject({
      year: 2025,
      month: 6,
      day: 27,
      hour: 9,
      minute: 0,
    });
  });

  it('addSeconds/addMinutes/startOfNextSecond adjust dates', () => {
    const base = new Date('2025-06-27T09:00:00+08:00');
    expect(addSeconds(base, 30).getTime()).toBe(base.getTime() + 30_000);
    expect(addMinutes(base, 2).getTime()).toBe(base.getTime() + 120_000);
    expect(startOfNextSecond(base).getTime()).toBe(base.getTime() + 1_000);
  });

  it('formatDateKey returns YYYY-MM-DD in timezone', () => {
    expect(formatDateKey(new Date('2025-06-27T23:00:00+08:00'), TZ)).toBe('2025-06-27');
  });
});
