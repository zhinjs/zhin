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

  it('routes every-callback rejections to onError instead of unhandledRejection', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const engine = new ScheduleEngine({ onError });
    engine.register('boom', 'every', async () => { throw new Error('boom'); }, { everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), 'boom');
    engine.dispose();
    vi.useRealTimers();
  });

  it('does not fire at-jobs beyond the 24.8-day timer limit immediately', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const engine = new ScheduleEngine();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    engine.register('far', 'at', cb, { atMs: Date.now() + thirtyDays });
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(thirtyDays);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.getStatus().length).toBe(0);
    engine.dispose();
    vi.useRealTimers();
  });

  it('keeps a job re-registered with the same id from inside an at-callback', async () => {
    vi.useFakeTimers();
    const engine = new ScheduleEngine();
    engine.register('again', 'at', () => {
      engine.register('again', 'every', vi.fn(), { everyMs: 1000 });
    }, { atMs: Date.now() + 100 });
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.getStatus().map((s) => s.id)).toEqual(['again']);
    engine.dispose();
    vi.useRealTimers();
  });

  it('pauses and resumes every-jobs on the original period without catching up', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const engine = new ScheduleEngine();
    engine.register('tick', 'every', cb, { everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.pause('tick')).toBe(true);
    expect(engine.getStatus()[0]?.running).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.resume('tick')).toBe(true);
    expect(engine.getStatus()[0]?.running).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(cb).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cb).toHaveBeenCalledTimes(2);
    engine.dispose();
    vi.useRealTimers();
  });

  it('skips an at-job whose time passes while paused', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const engine = new ScheduleEngine();
    engine.register('once', 'at', cb, { atMs: Date.now() + 1000 });
    engine.pause('once');
    await vi.advanceTimersByTimeAsync(2000);
    engine.resume('once');
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb).not.toHaveBeenCalled();
    engine.dispose();
    vi.useRealTimers();
  });

  it('runs a paused-then-resumed at-job at its original time', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const engine = new ScheduleEngine();
    engine.register('later', 'at', cb, { atMs: Date.now() + 1000 });
    engine.pause('later');
    await vi.advanceTimersByTimeAsync(500);
    engine.resume('later');
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);
    engine.dispose();
    vi.useRealTimers();
  });
});
