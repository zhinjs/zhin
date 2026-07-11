/**
 * 60s API 共享模块 — 供 *.tool.md handler 使用
 */

const API_BASE = process.env.ZHIN_60S_API || 'https://60s.viki.moe';

export type ListItem = string | Record<string, unknown>;

export async function fetchApi<T = unknown>(
  endpoint: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${API_BASE}/v2${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    error?: string;
    code?: number;
    message?: string;
    msg?: string;
    data?: T;
  };
  if (data.error) throw new Error(data.error);
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(data.message || data.msg || `API 错误: ${data.code}`);
  }
  return (data.data ?? data) as T;
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
