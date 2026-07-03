import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { isFreeDay } from '../src/resolvers/freeDay.js';
import { resolveFreeDayJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('FreeDayResolver', () => {
  it('triggers on regular weekend', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', TZ);
    const next = getNextRun(job, at('2024-09-20T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-09-21T09:00:00+08:00').toISOString());
  });

  it('triggers on statutory holiday weekday', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-10-01T09:00:00+08:00'))).toBe(true);
  });

  it('does not trigger on makeup workday Sunday', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-29T09:00:00+08:00'))).toBe(false);
    const next = getNextRun(job, at('2024-09-28T10:00:00+08:00'));
    expect(next?.toISOString()).toBe(at('2024-10-01T09:00:00+08:00').toISOString());
  });

  it('does not trigger on regular weekday', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', TZ);
    expect(isJobDue(job, at('2024-09-23T09:00:00+08:00'))).toBe(false);
  });

  it('supports step cron on rest days only', () => {
    const job = resolveFreeDayJob('0 */10 * * * *', TZ);
    expect(isJobDue(job, at('2024-09-22T10:20:00+08:00'))).toBe(true);
    expect(isJobDue(job, at('2024-09-23T10:20:00+08:00'))).toBe(false);
  });

  it('isFreeDay matches isWorkday inverse', () => {
    expect(isFreeDay(at('2024-09-22T09:00:00+08:00'), TZ)).toBe(true);
    expect(isFreeDay(at('2024-09-29T09:00:00+08:00'), TZ)).toBe(false);
    expect(isFreeDay(at('2024-09-23T09:00:00+08:00'), TZ)).toBe(false);
    expect(isFreeDay(at('2024-10-01T09:00:00+08:00'), TZ)).toBe(true);
  });
});
