import { describe, expect, it } from 'vitest';
import { clearZonedClockCache, getZonedClock } from '../src/utils/zoned-clock.js';

const TZ = 'Asia/Shanghai';

describe('ZonedClock', () => {
  it('reuses formatter instances per timezone', () => {
    clearZonedClockCache();
    let dtfCount = 0;
    const Orig = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (...args: unknown[]) {
      dtfCount++;
      return new (Orig as typeof Intl.DateTimeFormat)(...(args as ConstructorParameters<typeof Intl.DateTimeFormat>));
    } as typeof Intl.DateTimeFormat;

    const clock = getZonedClock(TZ);
    const date = new Date('2025-06-27T09:15:30+08:00');
    clock.partsAt(date);
    clock.cronPartsAt(date);
    clock.dateKey(date);
    clock.toUtc(2025, 6, 27, 9, 0, 0);
    getZonedClock(TZ).partsAt(date);

    expect(dtfCount).toBe(3);
  });
});
