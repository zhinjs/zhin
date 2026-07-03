import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveScatterJob } from '../src/resolve-job.js';
import {
  getScatterNextRun,
  isScatterDayFilter,
  listScatterSlots,
  listScatterSlotsForDay,
} from '../src/resolvers/scatter.js';
import { planScatterExecution } from '../src/utils/scatter-misfire.js';
import { generateDailySlots } from '../src/utils/scatter-slots.js';
import type { ResolvedJob } from '../src/types.js';

const TZ = 'Asia/Shanghai';
type ResolvedScatterJob = Extract<ResolvedJob, { kind: 'scatter' }>;

function at(iso: string): Date {
  return new Date(iso);
}

describe('scatter v2', () => {
  it('rejects when minGap prevents filling count', () => {
    expect(() =>
      resolveScatterJob(
        {
          window: { start: '09:00', end: '09:30' },
          count: 3,
          on: 'all',
          minGapMinutes: 15,
        },
        TZ,
      ),
    ).toThrow(/minGap/);
  });

  it('respects quietHours in slot generation', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '12:00' },
        count: 2,
        on: 'all',
        quietHours: [{ start: '10:00', end: '11:00' }],
      },
      TZ,
    ) as ResolvedScatterJob;

    const slots = generateDailySlots('job', '2024-09-23', job.windowStartSec, job.windowEndSec, 2, {
      quietHours: job.quietHours,
    });
    for (const sec of slots) {
      const hour = Math.floor(sec / 3600);
      expect(hour === 10).toBe(false);
    }
  });

  it('coalesce fires once at last expired slot index', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '12:00' },
        count: 3,
        on: 'all',
        misfire: 'coalesce',
      },
      TZ,
    ) as ResolvedScatterJob;

    const slots = generateDailySlots('job-coalesce', '2024-09-23', job.windowStartSec, job.windowEndSec, 3);
    const scheduledAt = at('2024-09-23T09:00:00+08:00');
    const now = at('2024-09-23T12:00:00+08:00');
    const plan = planScatterExecution(job, 'job-coalesce', { dateKey: '', firedCount: 0 }, scheduledAt, now, 0);

    expect(plan.shouldRunHandler).toBe(true);
    expect(plan.scatterIndex).toBe(3);
    expect(plan.nextState).toEqual({ dateKey: '2024-09-23', firedCount: 3 });
    expect(plan.scheduledAt.getTime()).toBe(
      new Date(`2024-09-23T${String(Math.floor(slots[2] / 3600)).padStart(2, '0')}:${String(Math.floor((slots[2] % 3600) / 60)).padStart(2, '0')}:${String(slots[2] % 60).padStart(2, '0')}+08:00`).getTime(),
    );
  });

  it('skip plan does not run handler', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '12:00' },
        count: 2,
        on: 'all',
        misfire: 'skip',
      },
      TZ,
    ) as ResolvedScatterJob;

    const plan = planScatterExecution(
      job,
      'job-skip',
      { dateKey: '', firedCount: 0 },
      at('2024-09-23T09:00:00+08:00'),
      at('2024-09-23T10:05:00+08:00'),
      60_000,
    );

    expect(plan.shouldRunHandler).toBe(false);
    expect(plan.nextState.firedCount).toBe(1);
  });

  it('coalesce falls back to fire when no expired slots remain from firedCount', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '18:00' },
        count: 3,
        on: 'all',
        misfire: 'coalesce',
        minGapMinutes: 60,
      },
      TZ,
    ) as ResolvedScatterJob;

    const scheduledAt = at('2024-09-23T09:00:00+08:00');
    const now = at('2024-09-23T09:02:00+08:00');
    const plan = planScatterExecution(
      job,
      'job-fallback',
      { dateKey: '2024-09-23', firedCount: 2 },
      scheduledAt,
      now,
      0,
    );

    expect(plan.shouldRunHandler).toBe(true);
    expect(plan.scatterIndex).toBe(3);
    expect(plan.scheduledAt.getTime()).toBe(scheduledAt.getTime());
    expect(plan.nextState.firedCount).toBe(3);
  });

  it('returns empty slots on disallowed days and null when scan exhausts', () => {
    const job = resolveScatterJob(
      { window: { start: '09:00', end: '10:00' }, count: 1, on: 'workday' },
      TZ,
    ) as ResolvedScatterJob;

    expect(listScatterSlotsForDay(job, 'x', '2024-09-22')).toEqual([]);
    expect(listScatterSlots(job, 'x', '2024-09-22')).toEqual([]);

    const neverJob = resolveScatterJob(
      {
        window: { start: '09:00', end: '10:00' },
        count: 1,
        on: { kind: 'afterHoliday', festivals: ['__never__'], daysAfter: 1 },
      },
      TZ,
    ) as ResolvedScatterJob;
    expect(
      getScatterNextRun(at('2024-01-01T08:00:00+08:00'), neverJob, 'never'),
    ).toBeNull();
  });

  it('validates scatter day filter helper', () => {
    expect(isScatterDayFilter('workday')).toBe(true);
    expect(isScatterDayFilter({ kind: 'holidayEve' })).toBe(true);
    expect(isScatterDayFilter({ kind: 'unknown' } as never)).toBe(false);
  });

  it('supports holidayEve and afterHoliday scatter filters', () => {
    const eveJob = resolveScatterJob(
      {
        window: { start: '09:00', end: '10:00' },
        count: 1,
        on: { kind: 'holidayEve', festivals: ['国庆节'], daysBefore: 1 },
      },
      TZ,
    ) as ResolvedScatterJob;

    const afterJob = resolveScatterJob(
      {
        window: { start: '09:00', end: '10:00' },
        count: 1,
        on: { kind: 'afterHoliday', festivals: ['国庆节'], daysAfter: 1 },
      },
      TZ,
    ) as ResolvedScatterJob;

    const eveNext = getScatterNextRun(at('2024-09-29T10:00:00+08:00'), eveJob, 'eve');
    expect(eveNext).not.toBeNull();

    const afterNext = getScatterNextRun(at('2024-10-07T10:00:00+08:00'), afterJob, 'after');
    expect(afterNext).not.toBeNull();
  });
});

describe('scatter scheduler ops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2024-09-23T08:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports list/pause/resume and maxRuns', async () => {
    const { CalendarScheduler } = await import('../src/scheduler.js');
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: TZ, handlerTimeoutMs: 5000 });

    scheduler.scatter(
      { window: { start: '09:00', end: '22:00' }, count: 1, on: 'workday' },
      handler,
      'bubble',
      { id: 'ops-1', maxRuns: 1 },
    );

    expect(scheduler.list()).toHaveLength(1);
    expect(scheduler.get('ops-1')?.maxRuns).toBe(1);

    scheduler.pause('ops-1');
    expect(scheduler.get('ops-1')?.paused).toBe(true);

    scheduler.resume('ops-1');
    expect(scheduler.get('ops-1')?.paused).toBe(false);

    const job = resolveScatterJob(
      { window: { start: '09:00', end: '22:00' }, count: 1, on: 'workday' },
      TZ,
    );
    const next = (await import('../src/dispatch.js')).getNextRun(job, at('2024-09-23T08:00:00+08:00'), {
      jobId: 'ops-1',
    })!;
    await vi.advanceTimersByTimeAsync(next.getTime() - Date.now() + 1000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.get('ops-1')).toBeUndefined();

    scheduler.stop();
  });
});
