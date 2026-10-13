export interface ProcessRejectionSource {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/** The Process Host owns reporting; SDK owners must still recover their own operations. */
export function installProcessRejectionHandler(
  source: ProcessRejectionSource,
  report: (reason: unknown) => void | Promise<void>,
): () => void {
  const listener = (reason: unknown): void => {
    try {
      // A failing reporter must not create another unhandled rejection loop.
      void Promise.resolve(report(reason)).catch(() => undefined);
    } catch {
      // Keep synchronous reporter failures from replacing the original rejection.
    }
  };
  source.on('unhandledRejection', listener);
  return () => { source.off('unhandledRejection', listener); };
}
