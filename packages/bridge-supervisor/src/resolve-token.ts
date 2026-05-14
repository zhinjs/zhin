/**
 * Read a token from `process.env[name]` after trimming.
 * Returns `undefined` if missing or empty — caller should treat as misconfiguration.
 */
export function readTokenFromEnv(name: string): string | undefined {
  const v = process.env[name]
  if (v === undefined) return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}
