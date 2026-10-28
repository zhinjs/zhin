const INLINE_SECRET_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghs|github_pat|xox[abpr])[_-][A-Za-z0-9_-]{12,}/g, '[redacted]'],
  [/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]'],
];

/** Masks credentials that appear inline in free text (error messages, string args). */
export function scrubSecrets(text: string): string {
  return INLINE_SECRET_RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
