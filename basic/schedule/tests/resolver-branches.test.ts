import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { getFestivalForDate, isWorkday } from '../src/resolvers/holiday.js';
import { isLunarDue } from '../src/resolvers/lunar.js';
import { resolveFreeDayJob, resolveHolidayJob, resolveLunarJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('resolver branch coverage', () => {
  it('isWorkday falls back to weekday when year has no holiday data', () => {
    expect(isWorkday(at('2099-06-23T09:00:00+08:00'), TZ)).toBe(true);
    expect(isWorkday(at('2099-06-21T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('getFestivalForDate returns undefined when year has no holiday data', () => {
    expect(getFestivalForDate(at('2099-01-01T09:00:00+08:00'), TZ)).toBeUndefined();
  });

  it('isHolidayDue returns false on wrong clock time', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    expect(isJobDue(job, at('2024-10-01T10:00:00+08:00'))).toBe(false);
  });

  it('holiday everyDayOfHoliday scans full ranges', () => {
    const job = resolveHolidayJob(
      { cron: '0 0 9 * * *', festivals: ['国庆节'], everyDayOfHoliday: true },
      TZ,
    );
    expect(isJobDue(job, at('2024-10-03T09:00:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-10-07T09:00:00+08:00'))).toBe(true);
  });

  it('isFreeDayDue returns false on wrong clock time', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-21T10:00:00+08:00'))).toBe(false);
  });

  it('isLunarDue returns false when lunar date matches but clock does not', () => {
    const job = resolveLunarJob('0 0 9 1 1 *', TZ);
    if (job.kind !== 'lunar') {
      throw new Error('expected lunar job');
    }
    expect(isLunarDue(at('2025-01-29T10:00:00+08:00'), job.cron, TZ)).toBe(false);
  });

  it('getLunarNextRun skips leap month when cron targets regular month day', () => {
    const job = resolveLunarJob('0 0 9 1 4 *', TZ);
    const next = getNextRun(job, at('2020-04-01T00:00:00+08:00'));
    expect(next).not.toBeNull();
  });
});
