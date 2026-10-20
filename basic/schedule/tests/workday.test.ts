import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { isWorkday } from '../src/resolvers/holiday.js';
import { resolveWorkdayJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('WorkdayResolver', () => {
  it('triggers on regular weekday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-23T09:00:00+08:00'))).toBe(true);
  });

  it('supports seconds in calendar cron', () => {
    const job = resolveWorkdayJob('30 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-23T09:00:30+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-09-23T09:00:00+08:00'))).toBe(false);
  });

  it('triggers on makeup workday Sunday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-29T09:00:00+08:00'))).toBe(true);
    expect(isWorkday(at('2024-09-29T09:00:00+08:00'), TZ)).toBe(true);
  });

  it('does not trigger on regular weekend', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-22T09:00:00+08:00'))).toBe(false);
    const next = getNextRun(job, at('2024-09-20T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-09-23T09:00:00+08:00').toISOString());
  });

  it('does not trigger on statutory holiday weekday', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-10-01T09:00:00+08:00'))).toBe(false);
    const next = getNextRun(job, at('2024-09-30T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-10-08T09:00:00+08:00').toISOString());
  });

  it('skips to next workday after holiday block', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', TZ);
    const next = getNextRun(job, at('2024-02-08T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-02-09T09:00:00+08:00').toISOString());
  });

  it('supports step cron every 10 minutes on workdays only', () => {
    const job = resolveWorkdayJob('0 */10 * * * *', TZ);
    expect(isJobDue(job, at('2024-09-23T10:20:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-09-23T10:25:00+08:00'))).toBe(false);
    expect(isJobDue(job, at('2024-09-22T10:20:00+08:00'))).toBe(false);
    const next = getNextRun(job, at('2024-09-23T10:07:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-09-23T10:10:00+08:00').toISOString());
  });
});
