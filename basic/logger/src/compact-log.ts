/**
 * Compact log fields: `op | key: val | flag` (no leading `[Tag]`).
 *
 * - `op` 作为前缀动作词直接输出（`connect | endpoint: …`，不是 `op: connect | …`）
 * - 值为 `true` 的字段只输出键名（`mentioned`，不是 `mentioned: true`）
 *
 * **Prefix vs body:** Logger already prints `[icqq]` — the message body should
 * NOT repeat `[ICQQ]`. Use `formatCompact()` for plugin/module loggers; reserve
 * `formatCompactLog(tag, …)` only when the tag adds context beyond the prefix
 * (e.g. `[setup]` logging `[AI Handler] total_ms: …`).
 */

import {
  formatDisplayPath,
  isPathLikeField,
  looksLikeAbsolutePath,
  type DisplayPathOptions,
} from './display-path.js';

export type CompactFieldValue = string | number | boolean;

export interface CompactUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** 日志字段原文（仅 trim，不截断长度） */
export function truncatePreview(text: string, max?: number): string {
  const normalized = text.trim();
  if (max === undefined || normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function formatCompactValue(
  key: string,
  value: CompactFieldValue,
  pathOptions?: DisplayPathOptions,
): string {
  if (typeof value !== 'string') return String(value);
  if (/^https?:\/\//i.test(value.trim())) return value;
  if (isPathLikeField(key) || looksLikeAbsolutePath(value)) {
    return formatDisplayPath(value, pathOptions);
  }
  return value;
}

/** Body only — use when logger `name` / prefix already identifies the source. */
export function formatCompact(
  fields: Record<string, CompactFieldValue | undefined | null>,
  pathOptions?: DisplayPathOptions,
): string {
  const parts: string[] = [];
  const op = fields.op;
  if (op !== undefined && op !== null && op !== '') {
    parts.push(String(op));
  }
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'op') continue;
    if (value === undefined || value === null || value === '') continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}: ${formatCompactValue(key, value, pathOptions)}`);
  }
  return parts.join(' | ');
}

/** Body with explicit tag — when tag is not redundant with logger prefix. */
export function formatCompactLog(
  tag: string,
  fields: Record<string, CompactFieldValue | undefined | null>,
  pathOptions?: DisplayPathOptions,
): string {
  const body = formatCompact(fields, pathOptions);
  return body ? `[${tag}] ${body}` : `[${tag}]`;
}

export function formatCompactUsage(usage: CompactUsage, subagentUsage?: CompactUsage): string {
  if (!usage.total_tokens && !usage.prompt_tokens && !usage.completion_tokens) {
    return 'n/a';
  }
  const subTotal = subagentUsage?.total_tokens ?? 0;
  const base = `${usage.total_tokens} (In ${usage.prompt_tokens} / Out ${usage.completion_tokens})`;
  if (subTotal > 0) {
    const mainTotal = Math.max(0, usage.total_tokens - subTotal);
    return `${base}; main ${mainTotal} + sub ${subTotal}`;
  }
  return base;
}

export function addCompactUsage(target: CompactUsage, source?: CompactUsage): void {
  if (!source) return;
  target.prompt_tokens += source.prompt_tokens;
  target.completion_tokens += source.completion_tokens;
  target.total_tokens += source.total_tokens;
}

export const EMPTY_COMPACT_USAGE: CompactUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};
