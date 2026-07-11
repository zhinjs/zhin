import { describe, expect, it } from 'vitest';
import { clearZonedClockCache } from '../src/utils/zoned-clock.js';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { isSolarDue } from '../src/resolvers/solar.js';
import { resolveSolarJob, resolveWorkdayJob } from '../src/resolve-job.js';

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

  it('computes next run for fixed month/day without minute scan (perf)', () => {
    clearZonedClockCache();
    const job = resolveSolarJob('0 0 19 9 7 *', TZ);
    const from = at('2026-07-11T08:12:00+08:00');
    let dtfCount = 0;
    const Orig = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (...args: unknown[]) {
      dtfCount++;
      return new (Orig as typeof Intl.DateTimeFormat)(...(args as ConstructorParameters<typeof Intl.DateTimeFormat>));
    } as typeof Intl.DateTimeFormat;

    const t0 = Date.now();
    const next = getNextRun(job, from);
    const ms = Date.now() - t0;

    expect(next?.toISOString()).toBe(at('2027-07-09T19:00:00+08:00').toISOString());
    expect(ms).toBeLessThan(200);
    expect(dtfCount).toBeLessThan(20);
  });

  it('startup mix stays bounded for test-bot style crons', () => {
    clearZonedClockCache();
    let dtfCount = 0;
    const Orig = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (...args: unknown[]) {
      dtfCount++;
      return new (Orig as typeof Intl.DateTimeFormat)(...(args as ConstructorParameters<typeof Intl.DateTimeFormat>));
    } as typeof Intl.DateTimeFormat;

    const from = at('2026-07-11T08:12:00+08:00');
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      getNextRun(resolveSolarJob('0 0 19 9 7 *', TZ), from);
    }
    for (let i = 0; i < 7; i++) {
      getNextRun(resolveSolarJob('0 */15 * * * *', TZ), from);
    }
    getNextRun(resolveWorkdayJob('0 0 9 * * *', TZ), from);
    const ms = Date.now() - t0;

    expect(ms).toBeLessThan(500);
    expect(dtfCount).toBeLessThan(200);
  });
});
