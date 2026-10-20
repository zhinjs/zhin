import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalJob } from '../src/job.js';
import { TimerWheel } from '../src/timer/timer-wheel.js';

const MAX_TIMEOUT_MS = 2_147_000_000;

function job(id: string, at: Date, cancelled = false): InternalJob {
  return {
    id,
    resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
    nextRunAt: at,
    cancelled,
    ephemeral: true,
    paused: false,
    runCount: 0,
  };
}

describe('TimerWheel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires job at scheduled time', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    wheel.add(job('j1', new Date('2025-06-27T09:00:00+08:00')));
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(fired).toEqual(['j1']);
    wheel.stop();
  });

  it('ignores cancelled or null nextRunAt jobs on add', () => {
    const wheel = new TimerWheel(() => {});
    wheel.add(job('cancelled', new Date('2025-06-27T09:00:00+08:00'), true));
    wheel.add(job('null', null as unknown as Date));
    wheel.stop();
  });

  it('remove and update reschedule next job', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    const first = job('first', new Date('2025-06-27T09:00:00+08:00'));
    const second = job('second', new Date('2025-06-27T09:01:00+08:00'));
    wheel.add(first);
    wheel.add(second);
    wheel.remove('first');

    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();

    expect(fired).toEqual(['second']);
    wheel.stop();
  });

  it('update moves job in heap', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    const later = job('later', new Date('2025-06-27T10:00:00+08:00'));
    wheel.add(later);
    wheel.update({ ...later, nextRunAt: new Date('2025-06-27T09:00:00+08:00') });

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(fired).toEqual(['later']);
    wheel.stop();
  });

  it('reschedules when delay exceeds MAX_TIMEOUT_MS', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    wheel.add(job('far', new Date(Date.now() + MAX_TIMEOUT_MS + 60_000)));
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
    await Promise.resolve();
    expect(fired).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();
    expect(fired).toEqual(['far']);
    wheel.stop();
  });

  it('stop prevents further fires', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    wheel.add(job('j1', new Date('2025-06-27T09:00:00+08:00')));
    wheel.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(fired).toHaveLength(0);
  });

  it('skips cancelled jobs still present in heap', async () => {
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
    const fired: string[] = [];
    const wheel = new TimerWheel(async (j) => {
      fired.push(j.id);
    });

    const scheduled = job('j1', new Date('2025-06-27T09:00:00+08:00'));
    wheel.add(scheduled);
    scheduled.cancelled = true;

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(fired).toEqual([]);
    wheel.stop();
  });

  it('add after stop does not schedule', () => {
    const wheel = new TimerWheel(() => {});
    wheel.stop();
    wheel.add(job('j1', new Date('2025-06-27T09:00:00+08:00')));
  });
});
