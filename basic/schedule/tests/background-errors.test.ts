import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';
import type { JobStore, StoredJob } from '../src/store/types.js';

function memoryStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    load: async () => [],
    upsert: async () => undefined,
    remove: async () => undefined,
    listDue: async () => [],
    ...overrides,
  };
}

const storedJob: StoredJob = {
  id: 'stored-1',
  handlerKey: 'daily',
  resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
  nextRunAt: '2025-06-28T01:00:00.000Z',
  cancelled: false,
  updatedAt: '2025-06-27T00:00:00.000Z',
};

describe('scheduler background failures', () => {
  const unhandled = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-27T09:05:00+08:00'));
    unhandled.mockClear();
    process.on('unhandledRejection', unhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    vi.useRealTimers();
  });

  it('routes a failing reconcile tick to onStoreError instead of an unhandled rejection', async () => {
    const onStoreError = vi.fn();
    const listDue = vi.fn(async () => { throw new Error('store offline'); });
    const scheduler = new CalendarScheduler({
      store: memoryStore({ listDue }), reconcileIntervalMs: 100, onStoreError,
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(250);
    scheduler.stop();
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));

    expect(listDue).toHaveBeenCalledTimes(2);
    expect(onStoreError).toHaveBeenCalledTimes(2);
    expect(onStoreError.mock.calls[0]![0]).toMatchObject({ message: 'store offline' });
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('survives a reconcile failure without an error callback, and a throwing callback', async () => {
    const listDue = vi.fn(async () => { throw new Error('store offline'); });
    const silent = new CalendarScheduler({ store: memoryStore({ listDue }), reconcileIntervalMs: 100 });
    const throwing = new CalendarScheduler({
      store: memoryStore({ listDue }), reconcileIntervalMs: 100,
      onStoreError: () => { throw new Error('callback bug'); },
    });
    await Promise.all([silent.ready, throwing.ready]);

    await vi.advanceTimersByTimeAsync(150);
    silent.stop();
    throwing.stop();
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).not.toHaveBeenCalled();
  });

  it('does not arm timers when stop() runs while the store is still loading', async () => {
    let finishLoad!: (jobs: StoredJob[]) => void;
    const listDue = vi.fn(async () => []);
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      store: memoryStore({
        load: () => new Promise<StoredJob[]>((resolve) => { finishLoad = resolve; }),
        listDue,
      }),
      handlers: { daily: handler },
      reconcileIntervalMs: 100,
    });

    scheduler.stop();
    finishLoad([storedJob]);
    await scheduler.ready;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(listDue).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(scheduler.list()).toEqual([]);
  });
});
