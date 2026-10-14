/**
 * Workroom 与 Data Governance 共享，名称中的 Workroom 前缀为兼容保留。
 */
import { createHash } from 'node:crypto';

/** Locale-independent UTF-16 code-unit order for authoritative identities. */
export function compareCanonicalWorkroomText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Canonical representation shared by Workroom and Data Governance records (Workroom prefix kept for compatibility). */
export function canonicalWorkroomJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorkroomJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareCanonicalWorkroomText)
      .map((key) => `${JSON.stringify(key)}:${canonicalWorkroomJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function digestCanonicalWorkroomValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalWorkroomJson(value)).digest('hex')}`;
}

export function deepFreezeWorkroomValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreezeWorkroomValue(item);
  }
  return Object.freeze(value);
}
