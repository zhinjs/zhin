import { describe, expect, it } from 'vitest';
import { validateCalendarCron } from '../src/parsers/cron.js';
import { at, buildCron, calendar, cron, everyHours, everyMinutes, everySeconds } from '../src/parsers/cron-helpers.js';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { resolveSolarJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

describe('cron helpers', () => {
  it('at builds calendar cron by default', () => {
    expect(at(9)).toBe('0 0 9 * * *');
    expect(at(9, 30)).toBe('0 30 9 * * *');
    expect(at(9, 0, 30)).toBe('30 0 9 * * *');
    expect(calendar(9)).toBe('0 0 9 * * *');
    expect(cron.at(9, 0)).toBe('0 0 9 * * *');
  });

  it('at accepts solar/lunar day fields via options', () => {
    expect(at(9, 0, { dayOfWeek: 1 })).toBe('0 0 9 * * 1');
    expect(at(9, 0, 30, { day: 1, month: 1 })).toBe('30 0 9 1 1 *');
  });

  it('calendar output passes validateCalendarCron', () => {
    expect(() => validateCalendarCron(calendar(9, 15, 45))).not.toThrow();
  });

  it('everyMinutes/everySeconds/everyHours build step cron', () => {
    expect(everyMinutes(10)).toBe('0 */10 * * * *');
    expect(everySeconds(10)).toBe('*/10 * * * * *');
    expect(everyHours(2)).toBe('0 0 */2 * * *');
    expect(cron.everyMinutes(10)).toBe('0 */10 * * * *');
  });

  it('buildCron assembles explicit fields', () => {
    expect(buildCron({ hour: 9, minute: 30, second: 15 })).toBe('15 30 9 * * *');
  });

  it('throws on invalid ranges', () => {
    expect(() => at(24)).toThrow(RangeError);
    expect(() => everyMinutes(0)).toThrow(RangeError);
    expect(() => at(9, 0, { dayOfWeek: 8 })).toThrow(RangeError);
  });
});

describe('*/10 step cron end-to-end', () => {
  function atIso(iso: string): Date {
    return new Date(iso);
  }

  it('computes next run every 10 minutes', () => {
    const job = resolveSolarJob(everyMinutes(10), TZ);
    const next = getNextRun(job, atIso('2025-06-27T10:07:00+08:00'));
    expect(next?.toISOString()).toBe(atIso('2025-06-27T10:10:00+08:00').toISOString());
  });

  it('matches every 10 minutes and rejects off-grid times', () => {
    const job = resolveSolarJob(everyMinutes(10), TZ);
    expect(isJobDue(job, atIso('2025-06-27T10:20:00+08:00'))).toBe(true);
    expect(isJobDue(job, atIso('2025-06-27T10:25:00+08:00'))).toBe(false);
  });

  it('computes next run every 10 seconds', () => {
    const job = resolveSolarJob(everySeconds(10), TZ);
    const next = getNextRun(job, atIso('2025-06-27T10:00:05+08:00'));
    expect(next?.toISOString()).toBe(atIso('2025-06-27T10:00:10+08:00').toISOString());
  });
});
