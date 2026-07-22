import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installProcessLifecycle,
  type ProcessLifecycleAdapter,
  type ProcessLifecycleSignal,
} from '../../src/plugin-runtime/process-lifecycle.js';

class FakeProcessAdapter implements ProcessLifecycleAdapter {
  readonly #listeners = new Map<ProcessLifecycleSignal, Set<() => void>>();
  readonly forcedExitCodes: number[] = [];
  exitCode: number | undefined;

  on(signal: ProcessLifecycleSignal, listener: () => void): void {
    const listeners = this.#listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(signal, listeners);
  }

  off(signal: ProcessLifecycleSignal, listener: () => void): void {
    this.#listeners.get(signal)?.delete(listener);
  }

  setExitCode(code: number): void {
    this.exitCode = code;
  }

  forceExit(code: number): void {
    this.forcedExitCodes.push(code);
  }

  emit(signal: ProcessLifecycleSignal): void {
    for (const listener of [...(this.#listeners.get(signal) ?? [])]) listener();
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Process Lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the first signal for one graceful Runtime Stop without forcing exit', async () => {
    const process = new FakeProcessAdapter();
    const requestStop = vi.fn().mockResolvedValue(undefined);
    const dispose = installProcessLifecycle({ process, requestStop });

    process.emit('SIGINT');
    await flushAsyncWork();

    expect(requestStop).toHaveBeenCalledTimes(1);
    expect(process.forcedExitCodes).toEqual([]);
    expect(process.exitCode).toBe(0);
    dispose();
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('forces exit on a repeated %s while Runtime Stop is pending', (signal, code) => {
    const process = new FakeProcessAdapter();
    const requestStop = vi.fn(() => new Promise<void>(() => undefined));
    const dispose = installProcessLifecycle({ process, requestStop });

    process.emit(signal);
    process.emit(signal);

    expect(requestStop).toHaveBeenCalledTimes(1);
    expect(process.forcedExitCodes).toEqual([code]);
    dispose();
  });

  it('forces a failed exit when the Shutdown Budget is exhausted', async () => {
    vi.useFakeTimers();
    const process = new FakeProcessAdapter();
    const requestStop = vi.fn(() => new Promise<void>(() => undefined));
    const dispose = installProcessLifecycle({
      process,
      requestStop,
      shutdownBudgetMs: 10_000,
    });

    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(process.forcedExitCodes).toEqual([1]);
    dispose();
  });

  it('reports Runtime Stop failure and leaves the process with exit code 1', async () => {
    const process = new FakeProcessAdapter();
    const error = new Error('dispose failed');
    const reportError = vi.fn();
    const dispose = installProcessLifecycle({
      process,
      requestStop: vi.fn().mockRejectedValue(error),
      reportError,
    });

    process.emit('SIGHUP');
    await flushAsyncWork();

    expect(reportError).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
    expect(process.forcedExitCodes).toEqual([]);
    dispose();
  });

  it('removes only its own signal listeners', () => {
    const process = new FakeProcessAdapter();
    const externalListener = vi.fn();
    const requestStop = vi.fn().mockResolvedValue(undefined);
    process.on('SIGINT', externalListener);
    const dispose = installProcessLifecycle({ process, requestStop });

    dispose();
    process.emit('SIGINT');

    expect(externalListener).toHaveBeenCalledTimes(1);
    expect(requestStop).not.toHaveBeenCalled();
  });
});
