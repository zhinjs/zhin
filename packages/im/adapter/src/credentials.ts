/**
 * Pick an explicit credential string.
 * The first `typeof === 'string'` wins — including `""` — so an empty config
 * field disables `process.env` fallbacks (kitchen-sink quiet boot).
 */
export function pickCredential(...candidates: unknown[]): string {
  for (const value of candidates) {
    if (typeof value === 'string') return value;
  }
  return '';
}
