import { createHash } from 'node:crypto';

/** Canonical representation used by immutable Workroom domain records. */
export function canonicalWorkroomJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorkroomJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
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
