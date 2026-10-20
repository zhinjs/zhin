/** Treat unresolved ${ENV} placeholders as empty. */
export function cleanSecret(value: string): string {
  const text = (value ?? "").trim();
  return /^\$\{[^}]*\}$/.test(text) ? "" : text;
}
