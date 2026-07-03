import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { isWorkday } from '../src/resolvers/holiday.js';
import { resolveHolidayJob, resolveWorkdayJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('HolidayResolver', () => {
  it('triggers on national day 2024-10-01', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    expect(isJobDue(job, at('2024-10-01T09:00:00+08:00'))).toBe(true);
    const next = getNextRun(job, at('2024-09-30T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-10-01T09:00:00+08:00').toISOString());
  });

  it('does not trigger on regular weekend', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    expect(isJobDue(job, at('2024-09-22T09:00:00+08:00'))).toBe(false);
  });

  it('festivals national excludes other festival anchor days', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    expect(isJobDue(job, at('2024-02-10T09:00:00+08:00'))).toBe(false);
    expect(isJobDue(job, at('2024-10-01T09:00:00+08:00'))).toBe(true);
  });

  it('defaults festivals to all anchor days when omitted', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *' }, TZ);
    const from = at('2024-09-01T00:00:00+08:00');
    const next = getNextRun(job, from);
    expect(next?.toISOString()).toBe(at('2024-09-15T09:00:00+08:00').toISOString());
  });

  it('treats 2024-09-29 Sunday makeup day as workday', () => {
    expect(isWorkday(at('2024-09-29T09:00:00+08:00'), TZ)).toBe(true);
  });

  it('treats regular Sunday as non-workday', () => {
    expect(isWorkday(at('2024-09-22T09:00:00+08:00'), TZ)).toBe(false);
  });

  it('workday triggers on makeup Sunday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    const next = getNextRun(job, at('2024-09-28T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-09-29T09:00:00+08:00').toISOString());
  });

  it('workday skips regular weekend to next Monday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    const next = getNextRun(job, at('2024-09-22T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-09-23T09:00:00+08:00').toISOString());
  });

  it('everyDayOfHoliday triggers each holiday day in block', () => {
    const job = resolveHolidayJob(
      { cron: '0 0 9 * * *', festivals: ['春节'], everyDayOfHoliday: true },
      TZ,
    );
    const next = getNextRun(job, at('2025-01-28T09:30:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-01-29T09:00:00+08:00').toISOString());
  });

  it('isJobDue on holiday job', () => {
    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    expect(isJobDue(job, at('2024-10-01T09:00:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-10-01T10:00:00+08:00'))).toBe(false);
  });

  it('isJobDue on workday job on makeup Sunday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-29T09:00:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-09-22T09:00:00+08:00'))).toBe(false);
  });

  it('supports step cron on holiday trigger days', () => {
    const job = resolveHolidayJob(
      { cron: '0 */10 * * * *', festivals: ['国庆节'], everyDayOfHoliday: true },
      TZ,
    );
    expect(isJobDue(job, at('2024-10-03T10:20:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-10-08T10:20:00+08:00'))).toBe(false);
  });
});
