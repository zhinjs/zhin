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
  /** Names of components still stopping, logged when the budget is exhausted. */
  readonly describePending?: () => readonly string[];
  /** Called right before a forced exit (budget exhausted or repeated signal). */
  readonly reportForcedExit?: (reason: 'budget' | 'repeated-signal', pending: readonly string[]) => void;
}

/** Conventional 128 + signal number exit codes. */
const SIGNAL_EXIT_CODES: Readonly<Record<ProcessLifecycleSignal, number>> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

export const DEFAULT_SHUTDOWN_BUDGET_MS = 5_000;

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

  const forceExit = (code: number, reason: 'budget' | 'repeated-signal'): void => {
    if (disposed || phase === 'completed') return;
    try {
      options.reportForcedExit?.(reason, options.describePending?.() ?? []);
    } catch {
      // Diagnostics must never prevent the forced exit.
    }
    adapter.forceExit(code);
  };

  const handleSignal = (signal: ProcessLifecycleSignal): void => {
    if (disposed || phase === 'completed') return;
    if (phase === 'stopping') {
      // A second Ctrl+C / SIGTERM during shutdown exits immediately.
      if (signal === 'SIGINT' || signal === 'SIGTERM') forceExit(SIGNAL_EXIT_CODES[signal], 'repeated-signal');
      return;
    }

    phase = 'stopping';
    forceTimer = setTimeout(() => forceExit(SIGNAL_EXIT_CODES[signal], 'budget'), shutdownBudgetMs);
    // The budget timer must never keep an otherwise finished process alive.
    forceTimer.unref?.();

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
