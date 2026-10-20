import { describe, it, expect, vi } from 'vitest';
import { registerJobSchedule, isRuntimeSchedulable } from '../../src/assistant/job-scheduler.js';
import { ScheduleEngine } from '@zhin.js/kernel';
import type { ScheduleJob } from '../../src/assistant/types.js';

describe('assistant job-scheduler', () => {
  it('isRuntimeSchedulable 识别 every/at/cron', () => {
    expect(isRuntimeSchedulable({
      id: 'a', enabled: true, schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'x' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    })).toBe(true);
    expect(isRuntimeSchedulable({
      id: 'b', enabled: true, schedule: { kind: 'at', atMs: Date.now() + 60_000 },
      action: { kind: 'agent', prompt: 'x' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    })).toBe(true);
  });

  it('every 调度触发 onRun', async () => {
    vi.useFakeTimers();
    const engine = new ScheduleEngine();
    const onRun = vi.fn();
    const job: ScheduleJob = {
      id: 'every1', enabled: true,
      schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'tick' },
      notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    };
    const dispose = registerJobSchedule(engine, job, onRun);
    expect(dispose).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onRun).toHaveBeenCalledWith('every1');
    dispose?.();
    engine.dispose();
    vi.useRealTimers();
  });

  it('isolates identical job ids between scheduler owners', async () => {
    vi.useFakeTimers();
    const first = new ScheduleEngine();
    const second = new ScheduleEngine();
    const firstRun = vi.fn();
    const secondRun = vi.fn();
    const job: ScheduleJob = {
      id: 'shared-id',
      enabled: true,
      schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'tick' },
      notify: { channel: 'silent' },
      createdAt: 1,
      updatedAt: 1,
      state: {},
    };

    registerJobSchedule(first, job, firstRun);
    registerJobSchedule(second, job, secondRun);
    await vi.advanceTimersByTimeAsync(1000);

    expect(firstRun).toHaveBeenCalledWith('shared-id');
    expect(secondRun).toHaveBeenCalledWith('shared-id');
    first.dispose();
    second.dispose();
    vi.useRealTimers();
  });
});
