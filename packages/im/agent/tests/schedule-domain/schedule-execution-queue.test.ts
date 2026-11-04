import { describe, expect, it, vi } from 'vitest';
import { ScheduleExecutionQueue } from '../../src/schedule-domain/schedule-execution-queue.js';

function queue(maxConcurrency = 1): ScheduleExecutionQueue {
  return new ScheduleExecutionQueue({
    maxConcurrency,
    defaultMaxRetries: 0,
    defaultTimeoutMs: 5_000,
  });
}

describe('ScheduleExecutionQueue', () => {
  it('records timeout stop even when an in-flight operation returns a late value', async () => {
    const subject = queue();
    const decisions = vi.fn();
    const execute = vi.fn((signal: AbortSignal) => new Promise<string>(resolve => {
      signal.addEventListener('abort', () => resolve('Already completed'), { once: true });
    }));
    await expect(subject.enqueueAndWait({ name: 'late', timeoutMs: 5, maxRetries: 1,
      canRetry: () => true, onRetryDecision: decisions, execute })).rejects.toThrow('timed out');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(decisions).toHaveBeenCalledExactlyOnceWith({ retry: false, reason: 'timeout' });
    await subject.dispose();
  });
  it('does not replay an unclassified failure merely because a retry budget remains', async () => {
    const subject = queue();
    const failure = new Error('Unclassified operation failure');
    const execute = vi.fn(async () => { throw failure; });
    const decisions = vi.fn();
    await expect(subject.enqueueAndWait({ name: 'unknown', maxRetries: 2, execute, onRetryDecision: decisions })).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(decisions).toHaveBeenCalledExactlyOnceWith({ retry: false, reason: 'not_retryable' });
    await subject.dispose();
  });

  it('isolates a retry observer failure from the actual safe retry and original result', async () => {
    const subject = queue();
    const execute = vi.fn().mockRejectedValueOnce(new Error('Transient read failure')).mockResolvedValueOnce('Read recovered');
    await expect(subject.enqueueAndWait({ name: 'safe', maxRetries: 1, execute, canRetry: () => true,
      onRetryDecision: () => { throw new Error('Observation unavailable'); } })).resolves.toBe('Read recovered');
    expect(execute).toHaveBeenCalledTimes(2);
    await subject.dispose();
  });
  it('limits actual concurrent operations', async () => {
    const subject = queue(1);
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const execute = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      return 'ok';
    });

    const first = subject.enqueueAndWait({ name: 'first', execute });
    const second = subject.enqueueAndWait({ name: 'second', execute });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    releases.shift()?.();

    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
    expect(maxActive).toBe(1);
    await subject.dispose();
  });

  it('retries failures inside the same concurrency slot', async () => {
    const subject = queue();
    let attempts = 0;

    const result = subject.enqueueAndWait({
      name: 'retry',
      maxRetries: 1,
      canRetry: () => true,
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('flaky');
        return 'recovered';
      },
    });

    await expect(result).resolves.toBe('recovered');
    expect(attempts).toBe(2);
    await subject.dispose();
  });

  it('aborts on timeout and retains the slot until execution settles', async () => {
    const subject = queue();
    let active = 0;
    let maxActive = 0;
    const timedOut = subject.enqueueAndWait({
      name: 'timed',
      timeoutMs: 10,
      execute: signal => new Promise<void>((_resolve, reject) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        signal.addEventListener('abort', () => {
          active -= 1;
          reject(signal.reason);
        }, { once: true });
      }),
    });
    const next = subject.enqueueAndWait({
      name: 'next',
      execute: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        active -= 1;
        return 'next';
      },
    });

    await expect(timedOut).rejects.toThrow('timed out');
    await expect(next).resolves.toBe('next');
    expect(maxActive).toBe(1);
    await subject.dispose();
  });

  it('dispose aborts running work, rejects queued work, and awaits settlement', async () => {
    const subject = queue();
    let settled = false;
    const running = subject.enqueueAndWait({
      name: 'running',
      execute: signal => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          queueMicrotask(() => {
            settled = true;
            reject(signal.reason);
          });
        }, { once: true });
      }),
    });
    const queued = subject.enqueueAndWait({
      name: 'queued',
      execute: async () => undefined,
    });

    const disposal = subject.dispose();
    await expect(running).rejects.toThrow('cancelled');
    await expect(queued).rejects.toThrow('cancelled');
    await disposal;
    expect(settled).toBe(true);
  });

  it('rejects use after disposal', async () => {
    const subject = queue();
    await subject.dispose();

    expect(() => subject.enqueueAndWait({
      name: 'late',
      execute: async () => undefined,
    })).toThrow('disposed');
  });
});
