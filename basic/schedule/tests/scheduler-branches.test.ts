import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dispatch from '../src/dispatch.js';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';
import type { JobStore, StoredJob } from '../src/store/types.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('CalendarScheduler branch coverage', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      const { rm } = await import('node:fs/promises');
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      tempDir = '';
    }
  });

  it('uses default timezone when omitted', () => {
    const scheduler = new CalendarScheduler();
    scheduler.solar('0 0 9 * * *', vi.fn());
    scheduler.stop();
  });

  it('start is idempotent when store is configured', async () => {
    tempDir = join(TEST_TMP_ROOT, `start-idempotent-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const scheduler = new CalendarScheduler({
      store: createLocalJsonStore({ path: join(tempDir, 'jobs.json') }),
    });
    await scheduler.ready;
    await scheduler.start();
    await scheduler.ready;
    scheduler.stop();
  });

  it('skips cancelled records when loading from store', async () => {
    tempDir = join(TEST_TMP_ROOT, `load-cancelled-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    await writeFile(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: 'cancelled-job',
            handlerKey: 'daily',
            resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
            nextRunAt: '2025-06-27T01:00:00.000Z',
            cancelled: true,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
      handlers: { daily: vi.fn() },
    });
    await scheduler.ready;
    expect(scheduler.cancel('cancelled-job')).toBe(false);
    scheduler.stop();
  });

  it('silently skips missing handler when onError is not configured', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    tempDir = join(TEST_TMP_ROOT, `no-onerror-${Date.now()}`);
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

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
    });
    await scheduler.ready;
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    scheduler.stop();
  });

  it('wraps non-Error handler throws for onError', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const errors: unknown[] = [];
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      onError: (err) => errors.push(err),
    });

    scheduler.solar('0 0 9 * * *', () => {
      throw 'plain failure';
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(errors[0]).toBeInstanceOf(Error);
    expect(String((errors[0] as Error).message)).toBe('plain failure');
    scheduler.stop();
  });

  it('uses inline handler when key is omitted', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.solar('0 0 9 * * *', handler);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('reconcile loads due jobs that were added to store after start', async () => {
    tempDir = join(TEST_TMP_ROOT, `reconcile-late-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));

    const handler = vi.fn();
    const store = createLocalJsonStore({ path: jobsPath });
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { daily: handler },
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;

    await store.upsert({
      id: 'late-job',
      handlerKey: 'daily',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    });

    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('swallows handler throws when onError is not configured', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.solar('0 0 9 * * *', () => {
      throw new Error('silent');
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    scheduler.stop();
  });

  it('removes persisted job from store when no next run remains', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    tempDir = join(TEST_TMP_ROOT, `no-next-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    const handler = vi.fn();
    let getNextRunCalls = 0;

    vi.spyOn(dispatch, 'getNextRun').mockImplementation(() => {
      getNextRunCalls += 1;
      if (getNextRunCalls === 1) {
        return new Date('2025-06-27T01:00:00.000Z');
      }
      return null;
    });

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
    });
    await scheduler.ready;

    scheduler.solar('0 0 9 * * *', handler, 'daily', { id: 'exhausted-job' });
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    await vi.waitFor(async () => {
      const raw = await (await import('node:fs/promises')).readFile(jobsPath, 'utf8');
      expect(raw).not.toContain('exhausted-job');
    });

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('fromStoredJob accepts null nextRunAt without scheduling', async () => {
    tempDir = join(TEST_TMP_ROOT, `null-next-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');
    await writeFile(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: 'null-run',
            handlerKey: 'daily',
            resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
            nextRunAt: null,
            cancelled: false,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
      handlers: { daily: vi.fn() },
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    scheduler.stop();
  });

  it('reconcile skips paused jobs and does nothing after stop', async () => {
    tempDir = join(TEST_TMP_ROOT, `reconcile-paused-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    vi.setSystemTime(new Date('2025-06-27T09:05:00+08:00'));

    const handler = vi.fn();
    const store = createLocalJsonStore({ path: join(tempDir, 'jobs.json') });
    await store.upsert({
      id: 'paused-job',
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
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;
    scheduler.pause('paused-job');

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
  });

  it('reconcile reschedules when in-memory nextRunAt is in the future', async () => {
    vi.setSystemTime(new Date('2025-06-27T09:05:00+08:00'));

    const handler = vi.fn();
    const dueRecord: StoredJob = {
      schemaVersion: 2,
      id: 'future-job',
      handlerKey: 'daily',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      nextRunAt: '2025-06-27T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    };
    const futureRecord: StoredJob = {
      ...dueRecord,
      nextRunAt: '2025-06-27T02:00:00.000Z',
    };

    const store: JobStore = {
      load: async () => [futureRecord],
      upsert: async () => {},
      remove: async () => {},
      listDue: async () => [dueRecord],
    };

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { daily: handler },
      reconcileIntervalMs: 100,
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
