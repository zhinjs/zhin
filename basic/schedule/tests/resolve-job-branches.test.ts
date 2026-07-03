import { afterEach, describe, expect, it, vi } from 'vitest';
import * as cronParser from '../src/parsers/cron.js';
import {
  resolveFreeDayJob,
  resolveHolidayJob,
  resolveLunarJob,
  resolveSolarJob,
  resolveWorkdayJob,
} from '../src/resolve-job.js';
import { InvalidScheduleError } from '../src/types.js';

describe('resolve-job branch coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps non-Error parseCron failures for solar', () => {
    vi.spyOn(cronParser, 'parseCron').mockImplementation(() => {
      throw 'bad cron';
    });
    expect(() => resolveSolarJob('0 0 9 * * *')).toThrow(InvalidScheduleError);
    expect(() => resolveSolarJob('0 0 9 * * *')).toThrow('Invalid cron expression');
  });

  it('wraps non-Error parseCron failures for lunar', () => {
    vi.spyOn(cronParser, 'parseCron').mockImplementation(() => {
      throw 'bad lunar cron';
    });
    expect(() => resolveLunarJob('0 0 9 1 1 *')).toThrow(InvalidScheduleError);
    expect(() => resolveLunarJob('0 0 9 1 1 *')).toThrow('Invalid lunar cron expression');
  });

  it('wraps non-Error validateCalendarCron failures for holiday', () => {
    vi.spyOn(cronParser, 'validateCalendarCron').mockImplementation(() => {
      throw 'bad cron';
    });
    expect(() => resolveHolidayJob({ cron: '0 0 9 * * *' })).toThrow(InvalidScheduleError);
    expect(() => resolveHolidayJob({ cron: '0 0 9 * * *' })).toThrow('Invalid calendar cron expression');
  });

  it('wraps non-Error validateCalendarCron failures for freeDay and workday', () => {
    vi.spyOn(cronParser, 'validateCalendarCron').mockImplementation(() => {
      throw 'bad cron';
    });
    expect(() => resolveFreeDayJob('0 0 9 * * *')).toThrow('Invalid calendar cron expression');
    expect(() => resolveWorkdayJob('0 0 9 * * *')).toThrow('Invalid calendar cron expression');
  });

  it('wraps Error parseCron failures for lunar', () => {
    vi.spyOn(cronParser, 'parseCron').mockImplementation(() => {
      throw new Error('bad lunar');
    });
    expect(() => resolveLunarJob('0 0 9 1 1 *')).toThrow(InvalidScheduleError);
    expect(() => resolveLunarJob('0 0 9 1 1 *')).toThrow('bad lunar');
  });

  it('rethrows InvalidScheduleError from lunar wildcard validation', () => {
    expect(() => resolveLunarJob('0 0 * 1 1 *')).toThrow(/exact hour/);
  });
});
