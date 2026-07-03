import { describe, expect, it } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import type { ResolvedJob } from '../src/types.js';

const TZ = 'Asia/Shanghai';

describe('dispatch', () => {
  it('isJobDue mirrors getNextRun for solar job', () => {
    const job: ResolvedJob = { kind: 'solar', cron: '0 0 9 * * *', timezone: TZ };
    const at = new Date('2025-06-27T09:00:00+08:00');
    expect(isJobDue(job, at)).toBe(true);
    expect(getNextRun(job, new Date('2025-06-27T08:00:00+08:00'))?.getTime()).toBe(at.getTime());
  });

  it('isJobDue for lunar, holiday, freeDay, workday', () => {
    viSafeHoliday();
    expect(
      isJobDue(
        { kind: 'holiday', cron: '0 0 9 * * *', festivals: ['国庆节'], everyDayOfHoliday: false, timezone: TZ },
        new Date('2024-10-01T09:00:00+08:00'),
      ),
    ).toBe(true);

    expect(
      isJobDue({ kind: 'freeDay', cron: '0 0 9 * * *', timezone: TZ }, new Date('2025-06-28T09:00:00+08:00')),
    ).toBe(true);

    expect(
      isJobDue({ kind: 'workday', cron: '0 0 9 * * *', timezone: TZ }, new Date('2025-06-27T09:00:00+08:00')),
    ).toBe(true);

    expect(
      isJobDue({ kind: 'lunar', cron: '0 0 9 1 1 *', timezone: TZ }, new Date('2025-01-29T09:00:00+08:00')),
    ).toBe(true);
  });

  it('returns null/false for unknown kind', () => {
    const unknown = { kind: 'unknown' } as unknown as ResolvedJob;
    expect(getNextRun(unknown, new Date())).toBeNull();
    expect(isJobDue(unknown, new Date())).toBe(false);
  });
});

function viSafeHoliday() {
  // holiday due check uses bundled 2024 data — no setup needed
}
