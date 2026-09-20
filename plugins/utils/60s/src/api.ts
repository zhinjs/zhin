export type ListItem = string | Record<string, unknown>;

/** Untyped 60s API JSON payload narrowed by handlers. */
export type ApiPayload = Record<string, unknown>;

/** Coerce nested API JSON objects for property access in handlers. */
export function asRecord(value: unknown): ApiPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ApiPayload)
    : {};
}

export function asString(value: unknown): string {
  return value == null ? '' : String(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function formatList(items: ListItem[], limit = 10): string {
  return items
    .slice(0, limit)
    .map((item, i) => {
      const obj = typeof item === 'string' ? null : item;
      const title = obj
        ? String(obj.title ?? obj.name ?? obj.word ?? item)
        : item;
      const hot = obj ? obj.hot_value ?? obj.hot : undefined;
      const hotStr = hot ? ` 🔥${hot}` : '';
      return `${i + 1}. ${title}${hotStr}`;
    })
    .join('\n');
}
