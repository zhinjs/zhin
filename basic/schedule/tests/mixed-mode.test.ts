import { describe, expect, it } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';
import { getNextRun } from '../src/dispatch.js';
import {
  resolveFreeDayJob,
  resolveHolidayJob,
  resolveLunarJob,
  resolveSolarJob,
  resolveWorkdayJob,
} from '../src/resolve-job.js';

describe('mixed mode scheduler', () => {
  it('resolves different kinds independently on one scheduler', () => {
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    const solar = resolveSolarJob('0 0 9 * * *', 'Asia/Shanghai');
    const lunar = resolveLunarJob('0 0 0 1 1 *', 'Asia/Shanghai');
    const holiday = resolveHolidayJob({ cron: '0 0 9 * * *' }, 'Asia/Shanghai');
    const freeDay = resolveFreeDayJob('0 0 9 * * *', 'Asia/Shanghai');
    const workday = resolveWorkdayJob('0 0 9 * * *', 'Asia/Shanghai');

    expect(solar.kind).toBe('solar');
    expect(lunar.kind).toBe('lunar');
    expect(holiday.kind).toBe('holiday');
    expect(freeDay.kind).toBe('freeDay');
    expect(workday.kind).toBe('workday');

    const from = new Date('2025-01-01T00:00:00+08:00');
    expect(getNextRun(solar, from)).not.toBeNull();
    expect(getNextRun(lunar, from)).not.toBeNull();
    expect(getNextRun(holiday, from)).not.toBeNull();
    expect(getNextRun(freeDay, from)).not.toBeNull();
    expect(getNextRun(workday, from)).not.toBeNull();

    scheduler.stop();
  });
});
