import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('reconcile loop', () => {
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

  it('fires overdue persisted jobs loaded on start', async () => {
    tempDir = join(TEST_TMP_ROOT, `reconcile-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const jobsPath = join(tempDir, 'jobs.json');

    vi.setSystemTime(new Date('2025-06-27T09:05:00+08:00'));

    const handler = vi.fn();
    const store = createLocalJsonStore({ path: jobsPath });
    await store.upsert({
      id: 'job-reconcile-1',
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

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);

    scheduler.stop();
    await Promise.resolve();
    await Promise.resolve();
  });
});
