/**
 * ScheduleEngine tests
 */
import { describe, it, expect, vi } from 'vitest';
import { ScheduleEngine } from '../src/schedule-engine.js';

describe('ScheduleEngine', () => {
  it('registers every schedule and fires callback', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const engine = new ScheduleEngine();
    engine.register('job1', 'every', cb, { everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(cb).toHaveBeenCalled();
    engine.dispose();
    vi.useRealTimers();
  });

  it('unregisters on dispose', () => {
    const engine = new ScheduleEngine();
    const dispose = engine.register('job2', 'every', vi.fn(), { everyMs: 1000 });
    dispose();
    expect(engine.getStatus().length).toBe(0);
    engine.dispose();
  });
});
