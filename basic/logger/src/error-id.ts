/** Shape of a log correlation id: `err_` + 12 lowercase hex digits. */
export const ERROR_ID_PATTERN = /^err_[0-9a-f]{12}$/u;

/**
 * A fresh log correlation id (`err_` + 12 hex). Shared by the Console API's unexpected-failure
 * responses and the inbound message outcome `internal_error` (ADR 0061 §1.6), so `zhin logs` finds
 * either by the same id. Uses Web Crypto, available in Node.js and browsers.
 */
export function createErrorId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `err_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
