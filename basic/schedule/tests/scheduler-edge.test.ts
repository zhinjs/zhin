import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateData } from '../src/update-data.js';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('CalendarScheduler edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      tempDir = '';
    }
  });

  it('CalendarScheduler.create awaits ready', async () => {
    tempDir = join(TEST_TMP_ROOT, `create-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const handler = vi.fn();
    const scheduler = await CalendarScheduler.create({
      timezone: 'Asia/Shanghai',
      storePath: join(tempDir, 'jobs.json'),
      handlers: { daily: handler },
    });
    scheduler.solar('0 0 9 * * *', handler, 'daily');
    scheduler.stop();
  });

  it('onError when persisted handler key is missing', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    tempDir = join(TEST_TMP_ROOT, `missing-handler-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const store = createLocalJsonStore({ path: join(tempDir, 'jobs.json') });
    await store.upsert({
      id: 'orphan',
      handlerKey: 'missing',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    });

    const errors: Error[] = [];
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      onError: (err) => errors.push(err),
    });
    await scheduler.ready;
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(errors.some((e) => e.message.includes('missing'))).toBe(true);
    scheduler.stop();
  });

  it('onError when handler throws', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const errors: Error[] = [];
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      onError: (err) => errors.push(err),
    });

    scheduler.solar('0 0 9 * * *', () => {
      throw new Error('boom');
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(errors[0]?.message).toBe('boom');
    scheduler.stop();
  });

  it('passes payload to registered handler', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.solar('0 0 9 * * *', handler, 'with-payload', { payload: { n: 1 } });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith(expect.any(Object), { n: 1 });
    scheduler.stop();
  });

  it('throws when registering after stop', () => {
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.stop();
    expect(() => scheduler.solar('0 0 9 * * *', () => {})).toThrow(/stopped/);
  });

  it('cancel removes persisted job from store', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    tempDir = join(TEST_TMP_ROOT, `cancel-persist-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
    });
    await scheduler.ready;

    const job = scheduler.solar('0 0 9 * * *', handler, 'daily', { id: 'to-cancel' });
    await vi.waitFor(async () => {
      expect(await readFile(jobsPath, 'utf8')).toContain('to-cancel');
    });

    job.cancel();
    await vi.waitFor(async () => {
      const raw = await readFile(jobsPath, 'utf8');
      expect(raw).not.toContain('to-cancel');
    });

    scheduler.stop();
  });

  it('recalculates jobs when holiday data updates', async () => {
    vi.setSystemTime(new Date('2027-09-30T10:00:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, handler);

    await updateData(2027, {
      holidayRanges: [{ start: '2027-10-01', end: '2027-10-07', festival: '国庆节' }],
      workdays: [],
    });
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(new Date('2027-10-01T09:00:00+08:00').getTime() - Date.now());
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].festival).toBe('国庆节');
    scheduler.stop();
  });

  it('cancel returns false for unknown or already cancelled job', () => {
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    expect(scheduler.cancel('missing')).toBe(false);
    const job = scheduler.solar('0 0 9 * * *', vi.fn());
    job.cancel();
    expect(scheduler.cancel(job.id)).toBe(false);
    scheduler.stop();
  });

  it('reconcile refreshes timer for future persisted jobs', async () => {
    tempDir = join(TEST_TMP_ROOT, `reconcile-future-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    vi.setSystemTime(new Date('2025-06-27T08:00:00+08:00'));

    const handler = vi.fn();
    const store = createLocalJsonStore({ path: jobsPath });
    await store.upsert({
      id: 'future-job',
      handlerKey: 'daily',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    });

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { daily: handler },
      reconcileIntervalMs: 200,
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('recalculate removes jobs with no future run after data change', async () => {
    vi.setSystemTime(new Date('2036-12-31T10:00:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    await updateData(2036, {
      holidayRanges: [{ start: '2036-01-01', end: '2036-01-01', festival: '元旦' }],
      workdays: [],
    });

    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['元旦'] }, handler);
    await updateData(2036, { holidayRanges: [], workdays: [] });
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(365 * 24 * 3600 * 1000);
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('recalculate removes persisted job when next run disappears', async () => {
    vi.setSystemTime(new Date('2036-12-31T10:00:00+08:00'));
    tempDir = join(TEST_TMP_ROOT, `recalc-remove-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');

    await updateData(2036, {
      holidayRanges: [{ start: '2036-01-01', end: '2036-01-01', festival: '元旦' }],
      workdays: [],
    });

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
    });
    await scheduler.ready;

    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['元旦'] }, handler, 'h', { id: 'vanish-job' });
    await vi.waitFor(async () => {
      expect(await readFile(jobsPath, 'utf8')).toContain('vanish-job');
    });

    await updateData(2036, { holidayRanges: [], workdays: [] });
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(async () => {
      expect(await readFile(jobsPath, 'utf8')).not.toContain('vanish-job');
    });

    scheduler.stop();
  });

  it('reconcile skips jobs that are already executing', async () => {
    tempDir = join(TEST_TMP_ROOT, `reconcile-exec-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await gate;
    });

    const store = createLocalJsonStore({ path: jobsPath });
    await store.upsert({
      id: 'slow-job',
      handlerKey: 'slow',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    });

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { slow: handler },
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    scheduler.stop();
  });

  it('does not refire anchor-only holiday job on following days', async () => {
    vi.setSystemTime(new Date('2024-10-01T08:00:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.holiday(
      { cron: '0 0 9 * * *', festivals: ['国庆节'], everyDayOfHoliday: false },
      handler,
    );

    await vi.advanceTimersByTimeAsync(3_600_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2024-10-02T09:00:00+08:00'));
    await vi.advanceTimersByTimeAsync(86_400_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });
});
