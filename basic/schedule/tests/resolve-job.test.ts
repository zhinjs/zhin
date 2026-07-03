import { describe, expect, it } from 'vitest';
import {
  resolveFreeDayJob,
  resolveHolidayJob,
  resolveLunarJob,
  resolveSolarJob,
  resolveWorkdayJob,
} from '../src/resolve-job.js';
import { InvalidScheduleError } from '../src/types.js';

describe('resolveJob', () => {
  it('builds solar job from 6-field cron', () => {
    const job = resolveSolarJob('0 0 9 * * 1', 'Asia/Shanghai');
    expect(job).toEqual({
      kind: 'solar',
      cron: '0 0 9 * * 1',
      timezone: 'Asia/Shanghai',
    });
  });

  it('builds lunar job from 6-field cron', () => {
    const job = resolveLunarJob('0 0 9 15 1 *', 'Asia/Shanghai');
    expect(job.kind).toBe('lunar');
  });

  it('builds freeDay job', () => {
    const job = resolveFreeDayJob('0 0 9 * * *', 'Asia/Shanghai');
    expect(job).toEqual({
      kind: 'freeDay',
      cron: '0 0 9 * * *',
      timezone: 'Asia/Shanghai',
    });
  });

  it('builds holiday job with festivals in input', () => {
    const job = resolveHolidayJob(
      { cron: '0 0 9 * * *', festivals: ['国庆节'], everyDayOfHoliday: true },
      'Asia/Shanghai',
    );
    expect(job).toMatchObject({
      kind: 'holiday',
      cron: '0 0 9 * * *',
      festivals: ['国庆节'],
      everyDayOfHoliday: true,
    });
  });

  it('builds workday job', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', 'Asia/Shanghai');
    expect(job).toEqual({
      kind: 'workday',
      cron: '0 0 9 * * *',
      timezone: 'Asia/Shanghai',
    });
  });

  it('throws on invalid solar cron field count', () => {
    expect(() => resolveSolarJob('0 9 * * *', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
  });

  it('throws when lunar cron has wildcard in hour', () => {
    expect(() => resolveLunarJob('0 0 * 1 1 *', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
  });

  it('throws on invalid calendar cron', () => {
    expect(() => resolveHolidayJob({ cron: '9am' }, 'Asia/Shanghai')).toThrow(
      InvalidScheduleError,
    );
    expect(() => resolveFreeDayJob('9am', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
    expect(() => resolveWorkdayJob('9am', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
  });

  it('throws when calendar cron specifies day field', () => {
    expect(() => resolveWorkdayJob('0 0 9 1 * *', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
  });

  it('throws when lunar cron has wildcard in second', () => {
    expect(() => resolveLunarJob('0 * 0 1 1 *', 'Asia/Shanghai')).toThrow(InvalidScheduleError);
  });
});
