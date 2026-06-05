import { describe, it, expect, vi } from 'vitest';
import { registerJobSchedule, isRuntimeSchedulable } from '../../src/assistant/job-scheduler.js';
import type { AssistantJob } from '../../src/assistant/types.js';

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
    const onRun = vi.fn();
    const job: AssistantJob = {
      id: 'every1', enabled: true,
      schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'tick' },
      notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    };
    const dispose = registerJobSchedule(job, () => () => {}, onRun);
    expect(dispose).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onRun).toHaveBeenCalledWith('every1');
    dispose?.();
    vi.useRealTimers();
  });
});
