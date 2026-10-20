/** 解析 DB 中的 JSON 字符串集合（兼容 SQLite 已自动 parse 的数组） */
export function parseStringSet(value: string | string[] | unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.filter((x): x is string => typeof x === 'string'));
  }
  if (typeof value !== 'string' || !value) return new Set();
  try {
    const v = JSON.parse(value);
    return Array.isArray(v)
      ? new Set(v.filter((x): x is string => typeof x === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function serializeStringSet(set: Set<string>): string {
  return JSON.stringify([...set].sort());
}
