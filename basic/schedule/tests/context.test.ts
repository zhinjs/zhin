import { describe, expect, it } from 'vitest';
import { buildJobContext } from '../src/context.js';
import { getFestivalForDate } from '../src/resolvers/holiday.js';
import { formatLunarText, formatSolarText } from '../src/utils/calendar-text.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('calendar text', () => {
  it('formats solar text', () => {
    expect(formatSolarText(at('2024-10-01T09:00:00+08:00'), TZ)).toBe('2024年10月1日');
  });

  it('formats lunar text for national day', () => {
    expect(formatLunarText(at('2024-10-01T09:00:00+08:00'), TZ)).toBe('甲辰年八月廿九');
  });
});

describe('getFestivalForDate', () => {
  it('returns national on Oct 1', () => {
    expect(getFestivalForDate(at('2024-10-01T09:00:00+08:00'), TZ)).toBe('国庆节');
  });

  it('returns national for other days in golden week block', () => {
    expect(getFestivalForDate(at('2024-10-03T09:00:00+08:00'), TZ)).toBe('国庆节');
  });

  it('returns undefined on regular weekend', () => {
    expect(getFestivalForDate(at('2024-09-22T09:00:00+08:00'), TZ)).toBeUndefined();
  });

  it('returns undefined on regular weekday', () => {
    expect(getFestivalForDate(at('2024-09-23T09:00:00+08:00'), TZ)).toBeUndefined();
  });
});

describe('buildJobContext', () => {
  it('includes solar, lunar and festival on statutory holiday', () => {
    const ctx = buildJobContext('job-1', 'holiday', at('2024-10-01T09:00:00+08:00'), TZ);
    expect(ctx).toMatchObject({
      jobId: 'job-1',
      kind: 'holiday',
      solarText: '2024年10月1日',
      lunarText: '甲辰年八月廿九',
      festival: '国庆节',
    });
  });

  it('omits festival on regular weekend', () => {
    const ctx = buildJobContext('job-2', 'freeDay', at('2024-09-22T09:00:00+08:00'), TZ);
    expect(ctx.solarText).toBe('2024年9月22日');
    expect(ctx.lunarText).toBeTruthy();
    expect(ctx.festival).toBeUndefined();
  });
});
