import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';
import type { JobStore, StoredJob } from '../src/store/types.js';

function at(iso: string): Date {
  return new Date(iso);
}

class ClaimableMemoryStore implements JobStore {
  private jobs = new Map<string, StoredJob>();
  private claims = new Map<string, string>();

  async load(): Promise<StoredJob[]> {
    return [...this.jobs.values()];
  }

  async upsert(job: StoredJob): Promise<void> {
    this.jobs.set(job.id, job);
  }

  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
    this.claims.delete(id);
  }

  async listDue(before: Date, limit = 100): Promise<StoredJob[]> {
    return [...this.jobs.values()]
      .filter((job) => !job.cancelled && job.nextRunAt && new Date(job.nextRunAt) <= before)
      .slice(0, limit);
  }

  async claim(id: string, owner: string, _ttlMs: number): Promise<boolean> {
    if (this.claims.has(id)) {
      return false;
    }
    this.claims.set(id, owner);
    return true;
  }

  async release(id: string, owner: string): Promise<void> {
    if (this.claims.get(id) === owner) {
      this.claims.delete(id);
    }
  }
}

describe('scheduler ops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2024-09-23T08:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handler timeout triggers onError', async () => {
    const errors: Error[] = [];
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      handlerTimeoutMs: 50,
      onError: (err) => errors.push(err),
    });

    scheduler.solar('0 0 9 * * *', () => new Promise(() => {}));

    await vi.advanceTimersByTimeAsync(3_600_000);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(errors.some((err) => err.message.includes('Handler timeout'))).toBe(true);
    scheduler.stop();
  });

  it('uses store claim before executing persisted job', async () => {
    const store = new ClaimableMemoryStore();
    await store.upsert({
      schemaVersion: 2,
      id: 'claim-1',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      handlerKey: 'daily',
      nextRunAt: '2024-09-23T01:00:00.000Z',
      cancelled: false,
      updatedAt: '2024-09-23T00:00:00.000Z',
    });

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store,
      handlers: { daily: handler },
      workerId: 'worker-a',
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(3_700_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('skips execution when store claim fails', async () => {
    class DenyClaimStore implements JobStore {
      async load(): Promise<StoredJob[]> {
        return [];
      }
      async upsert(): Promise<void> {}
      async remove(): Promise<void> {}
      async listDue(): Promise<StoredJob[]> {
        return [
          {
            schemaVersion: 2,
            id: 'deny-1',
            resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
            handlerKey: 'daily',
            nextRunAt: '2024-09-23T01:00:00.000Z',
            cancelled: false,
            updatedAt: '2024-09-23T00:00:00.000Z',
          },
        ];
      }
      async claim(): Promise<boolean> {
        return false;
      }
      async release(): Promise<void> {}
    }

    const handler = vi.fn();
    const scheduler = new CalendarScheduler({
      timezone: 'Asia/Shanghai',
      store: new DenyClaimStore(),
      handlers: { daily: handler },
      reconcileIntervalMs: 100,
      workerId: 'worker-a',
    });
    await scheduler.ready;

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
