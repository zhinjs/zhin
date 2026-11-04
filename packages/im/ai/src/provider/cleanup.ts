/** Cleanup telemetry cannot change inference outcomes or authorize retries. */
export interface ProviderCleanupFailure {
  readonly operationId: string;
  readonly phase: 'driver-dispose' | 'driver-release' | 'iterator-return' | 'binding-state-dispose';
}
export interface ProviderCleanupState {
  readonly failureCount: number;
  readonly lastFailure?: ProviderCleanupFailure;
}
export interface ProviderCleanupObserver {
  (input: ProviderCleanupFailure & Readonly<{ error: unknown }>): void | Promise<void>;
}
/** Constant-space evidence, with an optional Host-private diagnostic sink. */
export function createProviderCleanupReporter(observer?: ProviderCleanupObserver) {
  let failureCount = 0;
  let lastFailure: ProviderCleanupFailure | undefined;
  return Object.freeze({
    report(input: ProviderCleanupFailure & Readonly<{ error: unknown }>): void {
      failureCount++;
      lastFailure = Object.freeze({ operationId: input.operationId, phase: input.phase });
      try { void Promise.resolve(observer?.(input)).catch(() => undefined); } catch { /* observation never changes the business result */ }
    },
    read(): ProviderCleanupState {
      return Object.freeze({ failureCount, ...(lastFailure ? { lastFailure } : {}) });
    },
  });
}
