import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

async function createTestDir(name: string): Promise<string> {
  const dir = join(TEST_TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('persist scheduler', () => {
  let tempDir: string;
  let jobsPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function setup() {
    tempDir = await createTestDir('persist');
    jobsPath = join(tempDir, 'jobs.json');
    const handler = vi.fn();
    const store = createLocalJsonStore({ path: jobsPath });
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { daily: handler },
      reconcileIntervalMs: 500,
    });
    await scheduler.ready;

    return { scheduler, handler, store };
  }

  it('persists keyed jobs and restores after restart', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));

    const { scheduler, handler } = await setup();
    scheduler.solar('0 0 9 * * *', handler, 'daily', { id: 'job-persist-1' });

    await vi.waitFor(async () => {
      const raw = await readFile(jobsPath, 'utf8');
      expect(raw).toContain('job-persist-1');
    });

    scheduler.stop();

    const handler2 = vi.fn();
    const scheduler2 = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
      handlers: { daily: handler2 },
    });
    await scheduler2.ready;

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(0);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2.mock.calls[0][0].solarText).toBe('2025年6月27日');

    scheduler2.stop();
  });

  it('anonymous handler jobs are not persisted', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const { scheduler } = await setup();
    scheduler.solar('0 0 9 * * *', vi.fn());

    await vi.advanceTimersByTimeAsync(10);
    await expect(readFile(jobsPath, 'utf8')).rejects.toThrow();

    scheduler.stop();
  });

  it('registers handler when key is provided', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: join(await createTestDir('auto-reg'), 'jobs.json') }),
    });
    await scheduler.ready;

    scheduler.solar('0 0 9 * * *', handler, 'daily', { id: 'job-auto-reg' });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.handlers.has('daily')).toBe(true);

    scheduler.stop();
  });

  it('registerHandler works with keyed schedule calls', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.registerHandler('daily', handler);
    scheduler.solar('0 0 9 * * *', handler, 'daily');

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
