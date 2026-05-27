/**
 * Compact log fields: `key1: val1; key2: val2` (no leading `[Tag]`).
 *
 * **Prefix vs body:** Logger already prints `[Zhin:icqq]:` — the message body should
 * NOT repeat `[ICQQ]`. Use `formatCompact()` for plugin/module loggers; reserve
 * `formatCompactLog(tag, …)` only when the tag adds context beyond the prefix
 * (e.g. `[Zhin:setup]` logging `[AI Handler] total_ms: …`).
 *
 * See field conventions below; avoid a universal `op:` schema.
 */

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

/** @deprecated 与 truncatePreview 相同；保留别名便于语义区分 error 字段 */
export const truncateError = truncatePreview;

/** Body only — use when logger `name` / prefix already identifies the source. */
export function formatCompact(
  fields: Record<string, CompactFieldValue | undefined | null>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.join('; ');
}

/** Body with explicit tag — when tag is not redundant with logger prefix. */
export function formatCompactLog(
  tag: string,
  fields: Record<string, CompactFieldValue | undefined | null>,
): string {
  const body = formatCompact(fields);
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
