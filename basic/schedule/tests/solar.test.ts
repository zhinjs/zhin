import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { isSolarDue } from '../src/resolvers/solar.js';
import { resolveSolarJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('SolarResolver', () => {
  it('computes next Monday 9:00 from Friday 2025-06-27', () => {
    const job = resolveSolarJob('0 0 9 * * 1', TZ);
    const next = getNextRun(job, at('2025-06-27T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-30T09:00:00+08:00').toISOString());
  });

  it('computes next run for every 15 minutes (*/15)', () => {
    const job = resolveSolarJob('0 */15 * * * *', TZ);
    const next = getNextRun(job, at('2025-06-27T10:07:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-27T10:15:00+08:00').toISOString());
  });

  it('computes next run for every 30 seconds (*/30)', () => {
    const job = resolveSolarJob('*/30 * * * * *', TZ);
    const next = getNextRun(job, at('2025-06-27T10:00:10+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-27T10:00:30+08:00').toISOString());
  });

  it('computes next run for hour range 9-11', () => {
    const job = resolveSolarJob('0 0 9-11 * * *', TZ);
    const next = getNextRun(job, at('2025-06-27T11:30:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-28T09:00:00+08:00').toISOString());
  });

  it('computes next run for hour list 9,12', () => {
    const job = resolveSolarJob('0 0 9,12 * * *', TZ);
    const next = getNextRun(job, at('2025-06-27T09:30:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-27T12:00:00+08:00').toISOString());
  });

  it('computes next run for day-of-month step 1-30/15', () => {
    const job = resolveSolarJob('0 0 9 1-30/15 * *', TZ);
    const next = getNextRun(job, at('2025-06-27T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-07-01T09:00:00+08:00').toISOString());
  });

  it('computes next run for weekday range Mon-Fri', () => {
    const job = resolveSolarJob('0 0 9 * * 1-5', TZ);
    const next = getNextRun(job, at('2025-06-27T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-06-30T09:00:00+08:00').toISOString());
  });

  it('isSolarDue matches step cron at boundary', () => {
    const cron = '0 */15 * * * *';
    expect(isSolarDue(at('2025-06-27T10:30:00+08:00'), cron, TZ)).toBe(true);
    expect(isSolarDue(at('2025-06-27T10:31:00+08:00'), cron, TZ)).toBe(false);
  });

  it('isJobDue delegates to solar resolver', () => {
    const job = resolveSolarJob('0 */15 * * * *', TZ);
    expect(isJobDue(job, at('2025-06-27T10:45:00+08:00'))).toBe(true);
  });
});
