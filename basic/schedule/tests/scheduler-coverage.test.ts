import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dispatch from '../src/dispatch.js';
import { updateData } from '../src/update-data.js';
import { CalendarScheduler } from '../src/scheduler.js';
import type { JobStore, StoredJob } from '../src/store/types.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

describe('CalendarScheduler branch coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('covers pause/resume guards and get miss', () => {
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.workday('0 0 9 * * *', vi.fn(), 'daily', { id: 'guard-job' });

    expect(scheduler.get('missing')).toBeUndefined();
    expect(scheduler.pause('missing')).toBe(false);
    expect(scheduler.pause('guard-job')).toBe(true);
    expect(scheduler.pause('guard-job')).toBe(false);
    expect(scheduler.resume('missing')).toBe(false);
    expect(scheduler.resume('guard-job')).toBe(true);
    expect(scheduler.resume('guard-job')).toBe(false);

    scheduler.stop();
  });

  it('resume cancels when no next run remains', () => {
    vi.setSystemTime(at('2025-06-27T08:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.solar('0 0 9 * * *', vi.fn(), 'daily', { id: 'resume-cancel' });
    scheduler.pause('resume-cancel');

    vi.spyOn(dispatch, 'getNextRun').mockReturnValue(null);

    expect(scheduler.resume('resume-cancel')).toBe(true);
    expect(scheduler.get('resume-cancel')).toBeUndefined();
    scheduler.stop();
  });

  it('cancels expired jobs before handler runs', async () => {
    vi.setSystemTime(at('2025-06-27T10:00:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.solar('0 0 9 * * *', handler, 'daily', {
      id: 'expired-job',
      expiresAt: at('2025-06-27T09:30:00+08:00'),
    });

    const job = (scheduler as unknown as { jobs: Map<string, { nextRunAt: Date }> }).jobs.get(
      'expired-job',
    )!;
    job.nextRunAt = at('2025-06-27T09:00:00+08:00');

    await (
      scheduler as unknown as { executeJob: (job: unknown) => Promise<void> }
    ).executeJob(job);

    expect(handler).not.toHaveBeenCalled();
    expect(scheduler.get('expired-job')).toBeUndefined();
    scheduler.stop();
  });

  it('scatter misfire skip advances without calling handler', async () => {
    vi.setSystemTime(at('2024-09-23T10:05:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: TZ, misfireGraceMs: 60_000 });
    scheduler.scatter(
      {
        window: { start: '09:00', end: '12:00' },
        count: 2,
        on: 'all',
        misfire: 'skip',
      },
      handler,
      'skip-key',
      { id: 'skip-scatter' },
    );

    const jobs = scheduler as unknown as {
      jobs: Map<string, { nextRunAt: Date }>;
      executeJob: (job: unknown) => Promise<void>;
    };
    const job = jobs.jobs.get('skip-scatter')!;
    job.nextRunAt = at('2024-09-23T09:00:00+08:00');

    await jobs.executeJob(job);
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('runs inline handler without registry key', async () => {
    vi.setSystemTime(at('2025-06-27T08:59:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.solar('0 0 9 * * *', handler);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('reconcile no-ops after stop and skips cancelled due records', async () => {
    const cancelledRecord: StoredJob = {
      schemaVersion: 2,
      id: 'cancelled-due',
      handlerKey: 'daily',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: TZ },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: true,
      updatedAt: new Date().toISOString(),
    };

    const store: JobStore = {
      load: async () => [],
      upsert: async () => {},
      remove: async () => {},
      listDue: async () => [cancelledRecord],
    };

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: TZ,
      store,
      handlers: { daily: handler },
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;

    scheduler.stop();
    await (
      scheduler as unknown as { reconcile: () => Promise<void> }
    ).reconcile();
    expect(handler).not.toHaveBeenCalled();
  });

  it('recalculate persists active jobs after holiday data updates', async () => {
    vi.setSystemTime(at('2027-09-30T10:00:00+08:00'));
    const upsert = vi.fn(async () => {});
    const store: JobStore = {
      load: async () => [],
      upsert,
      remove: async () => {},
      listDue: async () => [],
    };

    const scheduler = new CalendarScheduler({ timezone: TZ, store });
    await scheduler.ready;

    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, vi.fn(), 'active-key', {
      id: 'active-job',
    });
    upsert.mockClear();

    await updateData(2027, {
      holidayRanges: [{ start: '2027-10-01', end: '2027-10-07', festival: '国庆节' }],
      workdays: [],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(upsert).toHaveBeenCalled();
    scheduler.stop();
  });

  it('recalculate skips paused jobs', async () => {
    vi.setSystemTime(at('2027-09-30T10:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, vi.fn(), 'h', {
      id: 'paused-recalc',
    });
    scheduler.pause('paused-recalc');

    await updateData(2027, {
      holidayRanges: [{ start: '2027-10-01', end: '2027-10-07', festival: '国庆节' }],
      workdays: [],
    });
    await Promise.resolve();

    expect(scheduler.get('paused-recalc')?.paused).toBe(true);
    scheduler.stop();
  });

  it('loads paused persisted jobs without scheduling them', async () => {
    vi.setSystemTime(at('2025-06-27T09:05:00+08:00'));
    const handler = vi.fn();
    const store: JobStore = {
      load: async () => [
        {
          schemaVersion: 2,
          id: 'paused-loaded',
          handlerKey: 'daily',
          resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: TZ },
          nextRunAt: '2025-06-27T01:00:00.000Z',
          cancelled: false,
          paused: true,
          updatedAt: new Date().toISOString(),
        },
      ],
      upsert: async () => {},
      remove: async () => {},
      listDue: async () => [],
    };

    const scheduler = new CalendarScheduler({
      timezone: TZ,
      store,
      handlers: { daily: handler },
    });
    await scheduler.ready;

    expect(scheduler.get('paused-loaded')?.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('swallows persist and release errors', async () => {
    vi.setSystemTime(at('2025-06-27T08:59:00+08:00'));
    const store: JobStore = {
      load: async () => [],
      upsert: async () => {
        throw new Error('persist failed');
      },
      remove: async () => {},
      listDue: async () => [],
      claim: async () => true,
      release: async () => {
        throw new Error('release failed');
      },
    };

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: TZ,
      store,
      workerId: 'worker-a',
    });
    await scheduler.ready;

    scheduler.solar('0 0 9 * * *', handler, 'daily', { id: 'persist-job' });
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('wraps non-Error handler throws in executeJob', async () => {
    vi.setSystemTime(at('2025-06-27T08:59:00+08:00'));
    const errors: unknown[] = [];
    const scheduler = new CalendarScheduler({
      timezone: TZ,
      onError: (err) => errors.push(err),
    });
    scheduler.solar('0 0 9 * * *', () => {
      throw 'plain string error';
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(errors[0]).toBeInstanceOf(Error);
    scheduler.stop();
  });

  it('resolveHandler returns undefined for missing registry key on stored job', async () => {
    vi.setSystemTime(at('2025-06-27T08:59:00+08:00'));
    const store: JobStore = {
      load: async () => [
        {
          schemaVersion: 2,
          id: 'no-handler',
          handlerKey: 'missing-key',
          resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: TZ },
          nextRunAt: '2025-06-27T01:00:00.000Z',
          cancelled: false,
          updatedAt: new Date().toISOString(),
        },
      ],
      upsert: async () => {},
      remove: async () => {},
      listDue: async () => [],
    };

    const errors: Error[] = [];
    const scheduler = new CalendarScheduler({
      timezone: TZ,
      store,
      onError: (err) => errors.push(err),
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(errors.some((err) => err.message.includes('missing-key'))).toBe(true);
    scheduler.stop();
  });

  it('ignores invalid expiresAt strings', () => {
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.solar('0 0 9 * * *', vi.fn(), 'daily', {
      id: 'bad-expiry',
      expiresAt: 'not-a-date',
    });
    expect(scheduler.get('bad-expiry')?.expiresAt).toBeNull();
    scheduler.stop();
  });
});
