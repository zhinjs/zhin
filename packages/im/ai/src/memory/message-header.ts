/**
 * ADR 0041 §1 header primitives shared by participant headers, the scene line and state-change
 * lines. Every value that a member can influence goes through these, so escaping lives in one place.
 */

export const HEADER_VALUE_MAX_CHARS = 64;

/** Sender ids only the host may emit; a member whose id collides is rendered as `user:<id>`. */
export const RESERVED_SENDER_IDS: ReadonlySet<string> = new Set(['system', 'assistant', 'tool']);

/** The sender id of host-generated state changes when they are downgraded to a user message. */
export const SYSTEM_SENDER_ID = 'system';

function clip(value: string): string {
  const chars = Array.from(value);
  return chars.length > HEADER_VALUE_MAX_CHARS ? `${chars.slice(0, HEADER_VALUE_MAX_CHARS - 1).join('')}…` : value;
}

/** A value inside `[k:v;…]`: `;`, `]`, `[` and line breaks become spaces; clipped to 64 chars. */
export function escapeHeaderValue(value: string): string {
  return clip(value.replace(/[;\[\]\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim());
}

/** A member-controlled value inside a state-change line: always double-quoted, quotes escaped. */
export function quoteEventValue(value: string): string {
  return `"${clip(value.replace(/[\r\n\t]+/gu, ' ').trim()).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

/** A real participant's id as rendered: reserved ids get a `user:` prefix so they cannot pose as the host. */
export function renderSenderId(id: string): string {
  const normalized = escapeHeaderValue(id);
  return RESERVED_SENDER_IDS.has(normalized.toLowerCase()) ? `user:${normalized}` : normalized;
}

/** Joins `[k:v;k:v;…;]`, dropping undefined / empty fields (missing = unknown, never `null`). */
export function formatHeader(fields: ReadonlyArray<readonly [string, string | number | boolean | readonly string[] | undefined | null]>): string {
  const parts: string[] = [];
  for (const [key, value] of fields) {
    if (value === undefined || value === null) continue;
    const text = Array.isArray(value) ? value.map(item => escapeHeaderValue(String(item))).filter(Boolean).join(',') : escapeHeaderValue(String(value));
    if (text === '') continue;
    parts.push(`${key}:${text}`);
  }
  return `[${parts.join(';')};]`;
}
