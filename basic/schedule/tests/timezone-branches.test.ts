import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatePartsInTimezone, getTimezoneOffsetMs } from '../src/utils/timezone.js';

const TZ = 'Asia/Shanghai';

function mockDateTimeFormat(
  formatToParts: () => Intl.DateTimeFormatPart[],
  format = () => '',
): void {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
    return {
      formatToParts,
      format,
    } as Intl.DateTimeFormat;
  });
}

describe('timezone branch coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses fallbacks when formatToParts omits optional fields', () => {
    mockDateTimeFormat(() => [{ type: 'year', value: '2025' }], () => '2025-01-01');

    const parts = getDatePartsInTimezone(new Date('2025-01-01T00:00:00Z'), TZ);
    expect(parts).toMatchObject({
      year: 2025,
      month: 0,
      day: 0,
      hour: 0,
      minute: 0,
      second: 0,
      dayOfWeek: 0,
    });

    expect(getTimezoneOffsetMs(new Date('2025-01-01T00:00:00Z'), TZ)).toBeTypeOf('number');
  });

  it('maps unknown weekday labels to Sunday', () => {
    mockDateTimeFormat(() => [
      { type: 'year', value: '2025' },
      { type: 'month', value: '6' },
      { type: 'day', value: '27' },
      { type: 'hour', value: '9' },
      { type: 'minute', value: '0' },
      { type: 'second', value: '0' },
      { type: 'weekday', value: 'Unknown' },
    ]);

    expect(getDatePartsInTimezone(new Date(), TZ).dayOfWeek).toBe(0);
  });
});
