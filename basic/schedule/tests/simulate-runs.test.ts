import { describe, expect, it } from 'vitest';
import { simulateNextRuns } from '../src/planning/simulate-runs.js';
import { resolveScatterJob, resolveWorkdayJob } from '../src/resolve-job.js';

describe('simulateNextRuns', () => {
  it('simulates scatter runs with advancing state', () => {
    const job = resolveScatterJob(
      { window: { start: '09:00', end: '22:00' }, count: 3, on: 'workday' },
      'Asia/Shanghai',
    );
    const runs = simulateNextRuns(job, 3, {
      jobId: 'sim-1',
      from: new Date('2024-09-23T08:00:00+08:00'),
    });
    expect(runs).toHaveLength(3);
    expect(runs[0].getTime()).toBeLessThan(runs[1].getTime());
  });

  it('simulates workday cron runs', () => {
    const job = resolveWorkdayJob('0 0 9 * * *', 'Asia/Shanghai');
    const runs = simulateNextRuns(job, 2, { from: new Date('2024-09-20T10:00:00+08:00') });
    expect(runs.length).toBeGreaterThan(0);
  });

  it('stops when next run is unavailable', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '10:00' },
        count: 1,
        on: { kind: 'afterHoliday', festivals: ['__never__'], daysAfter: 1 },
      },
      'Asia/Shanghai',
    );
    expect(
      simulateNextRuns(job, 5, {
        jobId: 'sim-stop',
        from: new Date('2024-01-01T08:00:00+08:00'),
      }),
    ).toEqual([]);
  });
});
