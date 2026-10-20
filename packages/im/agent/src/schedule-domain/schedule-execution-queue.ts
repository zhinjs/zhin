export interface ScheduleExecutionQueueOptions {
  readonly maxConcurrency: number;
  readonly defaultTimeoutMs: number;
  readonly defaultMaxRetries: number;
}

export interface ScheduleExecutionRequest<T> {
  readonly name: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly execute: (signal: AbortSignal) => Promise<T>;
}

interface PendingExecution<T> extends ScheduleExecutionRequest<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function cancellationError(name: string): Error {
  return new Error(`Schedule execution ${name} cancelled`);
}

/**
 * Generation-owned concurrency boundary for Schedule turns.
 *
 * It deliberately owns only admission, retry, timeout and drain. Workroom
 * dependencies/priorities belong to the durable Workroom scheduler, not here.
 */
export class ScheduleExecutionQueue {
  readonly #options: ScheduleExecutionQueueOptions;
  readonly #pending: PendingExecution<unknown>[] = [];
  readonly #running = new Set<Promise<void>>();
  readonly #controllers = new Set<AbortController>();
  #disposed = false;

  constructor(options: ScheduleExecutionQueueOptions) {
    if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
      throw new Error('Schedule execution maxConcurrency must be a positive integer');
    }
    if (!Number.isInteger(options.defaultMaxRetries) || options.defaultMaxRetries < 0) {
      throw new Error('Schedule execution defaultMaxRetries must be a non-negative integer');
    }
    if (!Number.isFinite(options.defaultTimeoutMs) || options.defaultTimeoutMs <= 0) {
      throw new Error('Schedule execution defaultTimeoutMs must be positive');
    }
    this.#options = options;
  }

  enqueueAndWait<T>(request: ScheduleExecutionRequest<T>): Promise<T> {
    this.#assertActive();
    if (request.maxRetries !== undefined
      && (!Number.isInteger(request.maxRetries) || request.maxRetries < 0)) {
      throw new Error('Schedule execution maxRetries must be a non-negative integer');
    }
    if (request.timeoutMs !== undefined
      && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) {
      throw new Error('Schedule execution timeoutMs must be positive');
    }
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({
        ...request,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.#drain();
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      await Promise.allSettled([...this.#running]);
      return;
    }
    this.#disposed = true;

    for (const pending of this.#pending.splice(0)) {
      pending.reject(cancellationError(pending.name));
    }
    for (const controller of this.#controllers) {
      controller.abort(cancellationError('during disposal'));
    }

    await Promise.allSettled([...this.#running]);
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('Schedule execution queue is disposed');
    }
  }

  #drain(): void {
    while (!this.#disposed && this.#running.size < this.#options.maxConcurrency) {
      const pending = this.#pending.shift();
      if (!pending) return;

      const settlement = this.#run(pending);
      this.#running.add(settlement);
      void settlement.then(() => {
        this.#running.delete(settlement);
        this.#drain();
      });
    }
  }

  async #run<T>(pending: PendingExecution<T>): Promise<void> {
    const maxRetries = pending.maxRetries ?? this.#options.defaultMaxRetries;
    const timeoutMs = pending.timeoutMs ?? this.#options.defaultTimeoutMs;
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      this.#controllers.add(controller);
      const timeout = setTimeout(() => {
        controller.abort(new Error(`Schedule execution ${pending.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref?.();

      try {
        const value = await pending.execute(controller.signal);
        if (controller.signal.aborted) {
          pending.reject(abortReason(controller.signal, pending.name));
        } else {
          pending.resolve(value);
        }
        return;
      } catch (error) {
        if (controller.signal.aborted || this.#disposed) {
          pending.reject(abortReason(controller.signal, pending.name));
          return;
        }
        if (attempt >= maxRetries) {
          pending.reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        attempt += 1;
      } finally {
        clearTimeout(timeout);
        this.#controllers.delete(controller);
      }
    }
  }
}

function abortReason(signal: AbortSignal, name: string): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return cancellationError(name);
}
