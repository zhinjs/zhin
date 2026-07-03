import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHandlerKey } from '../src/job.js';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

async function createTestDir(name: string): Promise<string> {
  const dir = join(TEST_TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('resolveHandlerKey', () => {
  it('uses explicit key first', () => {
    const handler = vi.fn();
    expect(resolveHandlerKey(handler, 'custom')).toBe('custom');
  });

  it('falls back to handler.name', () => {
    function dailyReport() {}
    expect(resolveHandlerKey(dailyReport)).toBe('dailyReport');
  });

  it('returns undefined for anonymous handlers without key', () => {
    expect(resolveHandlerKey(() => {})).toBeUndefined();
  });
});

describe('three-arg schedule API', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('registers named handlers by function name', async () => {
    vi.setSystemTime(new Date('2024-10-01T08:59:00+08:00'));
    const calls: string[] = [];
    function nationalDay(ctx: { festival?: string }) {
      calls.push(ctx.festival ?? '');
    }

    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, nationalDay);

    expect(scheduler.handlers.has('nationalDay')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(calls).toEqual(['国庆节']);
    scheduler.stop();
  });

  it('supports explicit key on freeDay and workday', async () => {
    vi.setSystemTime(new Date('2025-06-28T08:59:00+08:00'));
    const freeHandler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.freeDay('0 0 9 * * *', freeHandler, 'weekend');
    expect(scheduler.handlers.has('weekend')).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(freeHandler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('persists workday jobs when key is provided', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    tempDir = await createTestDir('workday-persist');
    const jobsPath = join(tempDir, 'jobs.json');
    const handler = vi.fn();

    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
    });
    await scheduler.ready;

    scheduler.workday('0 0 9 * * *', handler, 'workday', { id: 'workday-job' });

    expect(scheduler.handlers.has('workday')).toBe(true);
    await vi.waitFor(async () => {
      expect(await readFile(jobsPath, 'utf8')).toContain('workday-job');
    });

    scheduler.stop();

    const handler2 = vi.fn();
    const scheduler2 = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: createLocalJsonStore({ path: jobsPath }),
      handlers: { workday: handler2 },
    });
    await scheduler2.ready;

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(handler2).toHaveBeenCalledTimes(1);
    scheduler2.stop();
  });

  it('accepts cron string for calendar jobs', () => {
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });
    const handler = vi.fn();

    scheduler.freeDay('0 0 9 * * *', handler);
    scheduler.workday('0 0 9 * * *', handler, 'workday');
    scheduler.holiday('0 0 9 * * *', handler, 'holiday');

    scheduler.stop();
  });
});
