export type ProcessLifecycleSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

export interface ProcessLifecycleAdapter {
  on(signal: ProcessLifecycleSignal, listener: () => void): void;
  off(signal: ProcessLifecycleSignal, listener: () => void): void;
  setExitCode(code: number): void;
  forceExit(code: number): void;
}

export interface InstallProcessLifecycleOptions {
  readonly process: ProcessLifecycleAdapter;
  readonly requestStop: () => void | Promise<void>;
  readonly shutdownBudgetMs?: number;
  readonly reportError?: (error: unknown) => void;
}

export const DEFAULT_SHUTDOWN_BUDGET_MS = 10_000;

export const nodeProcessLifecycleAdapter: ProcessLifecycleAdapter = {
  on(signal, listener) {
    process.on(signal, listener);
  },
  off(signal, listener) {
    process.off(signal, listener);
  },
  setExitCode(code) {
    process.exitCode = code;
  },
  forceExit(code) {
    process.exit(code);
  },
};

/**
 * Gives one Process Host exclusive ownership of termination signals while
 * keeping Runtime Stop independent from the Node process lifecycle.
 */
export function installProcessLifecycle(
  options: InstallProcessLifecycleOptions,
): () => void {
  const adapter = options.process;
  const reportError = options.reportError ?? (() => undefined);
  const shutdownBudgetMs = options.shutdownBudgetMs ?? DEFAULT_SHUTDOWN_BUDGET_MS;
  let phase: 'listening' | 'stopping' | 'completed' = 'listening';
  let disposed = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  const forceExit = (code: number): void => {
    if (disposed || phase === 'completed') return;
    adapter.forceExit(code);
  };

  const handleSignal = (signal: ProcessLifecycleSignal): void => {
    if (disposed || phase === 'completed') return;
    if (phase === 'stopping') {
      if (signal === 'SIGINT') forceExit(130);
      else if (signal === 'SIGTERM') forceExit(143);
      return;
    }

    phase = 'stopping';
    forceTimer = setTimeout(() => forceExit(1), shutdownBudgetMs);

    void (async () => {
      try {
        await options.requestStop();
        adapter.setExitCode(0);
      } catch (error) {
        adapter.setExitCode(1);
        try {
          reportError(error);
        } catch {
          // Error reporting must not replace the Runtime Stop outcome.
        }
      } finally {
        if (forceTimer) clearTimeout(forceTimer);
        forceTimer = undefined;
        if (!disposed) phase = 'completed';
      }
    })();
  };

  const listeners = new Map<ProcessLifecycleSignal, () => void>([
    ['SIGINT', () => handleSignal('SIGINT')],
    ['SIGTERM', () => handleSignal('SIGTERM')],
    ['SIGHUP', () => handleSignal('SIGHUP')],
  ]);
  for (const [signal, listener] of listeners) adapter.on(signal, listener);

  return () => {
    if (disposed) return;
    disposed = true;
    if (forceTimer) clearTimeout(forceTimer);
    forceTimer = undefined;
    for (const [signal, listener] of listeners) adapter.off(signal, listener);
  };
}
