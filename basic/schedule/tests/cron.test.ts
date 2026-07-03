import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCronDateParts, matchesCron, parseCron, parseCronTime, validateCalendarCron } from '../src/parsers/cron.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('parseCron', () => {
  it('parses wildcard * for each field', () => {
    const fields = parseCron('0 0 0 * * *');
    expect(fields.second).toEqual([0]);
    expect(fields.minute).toEqual([0]);
    expect(fields.hour).toEqual([0]);
    expect(fields.dayOfMonth).toHaveLength(31);
    expect(fields.month).toHaveLength(12);
    expect(fields.dayOfWeek.length).toBeGreaterThanOrEqual(7);
  });

  it('parses step interval */10 on minutes', () => {
    const fields = parseCron('0 */10 * * * *');
    expect(fields.minute).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('parses step interval */15 on minutes', () => {
    const fields = parseCron('0 */15 * * * *');
    expect(fields.minute).toEqual([0, 15, 30, 45]);
  });

  it('parses step interval */30 on seconds', () => {
    const fields = parseCron('*/30 * * * * *');
    expect(fields.second).toEqual([0, 30]);
  });

  it('parses range 1-5 on day-of-month', () => {
    const fields = parseCron('0 0 0 1-5 * *');
    expect(fields.dayOfMonth).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses list 1,3,5 on months', () => {
    const fields = parseCron('0 0 0 * 1,3,5 *');
    expect(fields.month).toEqual([1, 3, 5]);
  });

  it('parses range with step 10-20/5 on minutes', () => {
    const fields = parseCron('0 10-20/5 * * * *');
    expect(fields.minute).toEqual([10, 15, 20]);
  });

  it('parses step on bounded range 1-30/15 on day-of-month', () => {
    const fields = parseCron('0 0 0 1-30/15 * *');
    expect(fields.dayOfMonth).toEqual([1, 16]);
  });

  it('parses day-of-week 0 and 7 as Sunday', () => {
    const fields = parseCron('0 0 0 * * 0');
    expect(fields.dayOfWeek).toContain(7);
    const fields7 = parseCron('0 0 0 * * 7');
    expect(fields7.dayOfWeek).toContain(7);
  });

  it('parses weekday range 1-5', () => {
    const fields = parseCron('0 0 0 * * 1-5');
    expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses combined list and range on hours', () => {
    const fields = parseCron('0 0 9,12,15-17 * * *');
    expect(fields.hour).toEqual([9, 12, 15, 16, 17]);
  });

  it('throws when field count is not 6', () => {
    expect(() => parseCron('0 0 9 * *')).toThrow(/6 fields/);
  });

  it('throws on invalid step', () => {
    expect(() => parseCron('0 */0 * * * *')).toThrow(/step/);
  });

  it('throws on invalid range and empty segment', () => {
    expect(() => parseCron('0 0 0 a-b * *')).toThrow(/range/);
    expect(() => parseCron('0 , * * * *')).toThrow(/Invalid cron field/);
    expect(() => parseCron('0 0 0 32 * *')).toThrow(/Empty cron field/);
    expect(() => parseCron('0 0 0 abc * *')).toThrow(/Invalid cron value/);
  });

  it('parses step starting at single value on day-of-month', () => {
    const fields = parseCron('0 0 0 15/10 * *');
    expect(fields.dayOfMonth).toEqual([15, 25]);
  });

  it('parses step with omitted left operand as wildcard', () => {
    const fields = parseCron('0 /15 * * * *');
    expect(fields.minute).toEqual([0, 15, 30, 45]);
  });

  it('matches when only day-of-week is constrained', () => {
    const fields = parseCron('0 0 9 * * 5');
    expect(matchesCron(fields, at('2025-06-27T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-26T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('matches when only day-of-month is constrained', () => {
    const fields = parseCron('0 0 9 15 * *');
    expect(matchesCron(fields, at('2025-06-15T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-16T09:00:00+08:00'), TZ)).toBe(false);
  });
});

describe('matchesCron', () => {
  it('matches exact datetime', () => {
    const fields = parseCron('30 15 9 27 6 5');
    const date = at('2025-06-27T09:15:30+08:00');
    expect(matchesCron(fields, date, TZ)).toBe(true);
  });

  it('matches every 10 minutes via */10', () => {
    const fields = parseCron('0 */10 * * * *');
    expect(matchesCron(fields, at('2025-06-27T10:20:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T10:25:00+08:00'), TZ)).toBe(false);
  });

  it('matches every 15 minutes via */15', () => {
    const fields = parseCron('0 */15 * * * *');
    expect(matchesCron(fields, at('2025-06-27T10:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T10:15:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T10:07:00+08:00'), TZ)).toBe(false);
  });

  it('matches every 30 seconds via */30', () => {
    const fields = parseCron('*/30 * * * * *');
    expect(matchesCron(fields, at('2025-06-27T10:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T10:00:30+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T10:00:15+08:00'), TZ)).toBe(false);
  });

  it('matches Monday via day-of-week', () => {
    const fields = parseCron('0 0 9 * * 1');
    expect(matchesCron(fields, at('2025-06-30T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-27T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('uses OR logic when both day-of-month and day-of-week are set', () => {
    const fields = parseCron('0 0 9 27 6 1');
    expect(matchesCron(fields, at('2025-06-27T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-30T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-06-28T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('matches month list filter', () => {
    const fields = parseCron('0 0 9 * 6,12 *');
    expect(matchesCron(fields, at('2025-06-15T09:00:00+08:00'), TZ)).toBe(true);
    expect(matchesCron(fields, at('2025-07-15T09:00:00+08:00'), TZ)).toBe(false);
  });
});

describe('validateCalendarCron', () => {
  it('accepts exact time with wildcard day/month/dow', () => {
    const fields = validateCalendarCron('0 0 9 * * *');
    expect(fields.hour).toEqual([9]);
    expect(fields.dayOfMonth).toHaveLength(31);
  });

  it('accepts step syntax in time fields', () => {
    const fields = validateCalendarCron('0 */10 * * * *');
    expect(fields.minute).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('rejects non-wildcard day/month/dow fields', () => {
    expect(() => validateCalendarCron('0 0 9 1 * *')).toThrow(/day, month, and weekday/);
    expect(() => validateCalendarCron('0 0 9 * 1 *')).toThrow(/day, month, and weekday/);
    expect(() => validateCalendarCron('0 0 9 * * 1')).toThrow(/day, month, and weekday/);
  });
});

describe('parseCronTime', () => {
  it('extracts hour minute second from exact calendar cron', () => {
    expect(parseCronTime('30 15 9 * * *')).toEqual({ hour: 9, minute: 15, second: 30 });
  });

  it('rejects step expressions', () => {
    expect(() => parseCronTime('0 */10 * * * *')).toThrow(/exact minute/);
  });
});

describe('getCronDateParts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts second in timezone', () => {
    const parts = getCronDateParts(at('2025-06-27T09:15:30+08:00'), TZ);
    expect(parts).toMatchObject({
      second: 30,
      minute: 15,
      hour: 9,
      day: 27,
      month: 6,
    });
  });

  it('uses fallbacks when weekday parts are missing', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
      return {
        formatToParts: () =>
          [
            { type: 'second', value: '0' },
            { type: 'minute', value: '0' },
            { type: 'hour', value: '9' },
            { type: 'day', value: '1' },
            { type: 'month', value: '1' },
          ] as Intl.DateTimeFormatPart[],
      } as Intl.DateTimeFormat;
    });

    const parts = getCronDateParts(at('2025-01-01T09:00:00+08:00'), TZ);
    expect(parts.dayOfWeek).toBe(0);
  });
});
