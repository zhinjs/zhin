/**
 * Redact LLM request payloads for safe logging (truncate long strings, shrink base64).
 */

const DEFAULT_MAX_STRING = 800;
const MAX_DEPTH = 10;

export function redactValueForLog(value: unknown, depth = 0, maxString = DEFAULT_MAX_STRING): unknown {
  if (depth > MAX_DEPTH) return '<max-depth>';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.includes('base64,')) {
      const idx = value.indexOf('base64,');
      const b64 = value.slice(idx + 7);
      return `${value.slice(0, idx + 7)}<${b64.length} chars>`;
    }
    if (value.length > maxString) {
      return `${value.slice(0, maxString)}…<${value.length} total>`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValueForLog(item, depth + 1, maxString));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactValueForLog(child, depth + 1, maxString);
    }
    return out;
  }
  return String(value);
}

export function formatRedactedJson(value: unknown, maxString = DEFAULT_MAX_STRING): string {
  return JSON.stringify(redactValueForLog(value, 0, maxString));
}
