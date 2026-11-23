import { isWholeEnvironmentReference } from "zhin.js";

/** Treat an unresolved `${ENV}` placeholder (the shared plugin-runtime parser) as empty. */
export function cleanSecret(value: string): string {
  const text = (value ?? "").trim();
  return isWholeEnvironmentReference(text) ? "" : text;
}
