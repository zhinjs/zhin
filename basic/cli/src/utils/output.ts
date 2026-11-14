/**
 * User-facing results of a CLI command (#1250): written to **stdout** as-is, without a log prefix,
 * so multi-line content stays intact and can be piped. Diagnostics go through `logger` (stderr).
 */
export const output = {
  /** Writes each argument as one line (no argument writes a blank line). */
  line(...lines: readonly string[]): void {
    console.log(lines.length === 0 ? '' : lines.join('\n'));
  },
  /** Writes a value as indented JSON. */
  json(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
  },
};
