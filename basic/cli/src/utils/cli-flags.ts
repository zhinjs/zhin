/**
 * Global CLI flags (#1250): `--verbose` (diagnostic log prefix) and `--debug` (show log
 * correlation ids of instance errors and look them up). Set from the root command's `preAction`
 * hook; `ZHIN_CLI_VERBOSE=1` / `ZHIN_CLI_DEBUG=1` enable them without the flag.
 */
const flags = { verbose: false, debug: false };

const enabled = (value: string | undefined): boolean => value === '1' || value?.toLowerCase() === 'true';

export function setCliFlags(next: Readonly<{ verbose?: boolean; debug?: boolean }>): void {
  if (next.verbose !== undefined) flags.verbose = next.verbose;
  if (next.debug !== undefined) flags.debug = next.debug;
}

export function isCliVerbose(): boolean {
  return flags.verbose || enabled(process.env.ZHIN_CLI_VERBOSE);
}

export function isCliDebug(): boolean {
  return flags.debug || enabled(process.env.ZHIN_CLI_DEBUG);
}
