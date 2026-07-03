import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { resolveLunarJob } from '../src/resolve-job.js';
import { solarToLunar } from '../src/data/lunar-table.js';
import { InvalidScheduleError } from '../src/types.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('LunarResolver', () => {
  it('maps 2025-01-29 to lunar month 1 day 1', () => {
    const lunar = solarToLunar(2025, 1, 29);
    expect(lunar).toMatchObject({ month: 1, day: 1, isLeapMonth: false });
  });

  it('finds next lunar new year from before 2025 spring festival', () => {
    const job = resolveLunarJob('0 0 0 1 1 *', TZ);
    const next = getNextRun(job, at('2025-01-01T00:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-01-29T00:00:00+08:00').toISOString());
  });

  it('finds lunar month 1 day 15 at 9:00', () => {
    const job = resolveLunarJob('0 0 9 15 1 *', TZ);
    const next = getNextRun(job, at('2025-01-01T00:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-02-12T09:00:00+08:00').toISOString());
  });

  it('finds every lunar month day 1 via month wildcard', () => {
    const job = resolveLunarJob('0 0 9 1 * *', TZ);
    const next = getNextRun(job, at('2025-02-01T00:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2025-02-28T09:00:00+08:00').toISOString());
  });

  it('finds lunar day list 1 and 15 on any month', () => {
    const job = resolveLunarJob('0 0 9 1,15 * *', TZ);
    const from = at('2025-02-13T00:00:00+08:00');
    const next = getNextRun(job, from);
    expect(next?.toISOString()).toBe(at('2025-02-28T09:00:00+08:00').toISOString());
  });

  it('isJobDue on lunar cron', () => {
    const job = resolveLunarJob('0 0 9 15 1 *', TZ);
    expect(isJobDue(job, at('2025-02-12T09:00:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2025-02-12T10:00:00+08:00'))).toBe(false);
  });

  it('rejects wildcard in hour field for lunar cron', () => {
    expect(() => resolveLunarJob('0 0 * 1 1 *', TZ)).toThrow(InvalidScheduleError);
  });

  it('rejects step interval in minute field for lunar cron', () => {
    expect(() => resolveLunarJob('0 */15 9 1 1 *', TZ)).toThrow(InvalidScheduleError);
  });
});
