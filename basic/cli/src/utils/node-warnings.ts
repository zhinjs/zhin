/**
 * Suppress Node ExperimentalWarnings that zhin intentionally relies on
 * (native TypeScript type-stripping, node:sqlite). Prefer also passing
 * `--disable-warning=ExperimentalWarning` on child process argv.
 */
export const DISABLE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';

declare global {
  // eslint-disable-next-line no-var
  var __zhinExperimentalWarningsSuppressed: boolean | undefined;
}

export function suppressNodeExperimentalWarnings(): void {
  if (globalThis.__zhinExperimentalWarningsSuppressed) return;
  globalThis.__zhinExperimentalWarningsSuppressed = true;

  const originalEmit = process.emit.bind(process);
  process.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (
      event === 'warning'
      && args[0] instanceof Error
      && args[0].name === 'ExperimentalWarning'
    ) {
      return false;
    }
    return Reflect.apply(originalEmit, process, [event, ...args]) as boolean;
  }) as typeof process.emit;
}
