/**
 * 60s API 共享模块
 * 供 *.tool.md handler 文件引用
 */

const API_BASE = process.env.ZHIN_60S_API_BASE || 'https://60s.viki.moe';

export async function fetchApi<T = any>(
  endpoint: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${API_BASE}/v2${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  const data = (await res.json()) as any;
  if (data.error) throw new Error(data.error);
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(data.message || data.msg || `API 错误: ${data.code}`);
  }
  return data.data ?? data;
}

export function formatList(items: any[], limit = 10): string {
  return items
    .slice(0, limit)
    .map((item, i) => {
      const title = item.title || item.name || item.word || item;
      const hot = item.hot_value || item.hot;
      return `${i + 1}. ${title}${hot ? ` 🔥${hot}` : ''}`;
    })
    .join('\n');
}

/** 热搜/榜单类工具的 handler 工厂 */
export function createHotListHandler(endpoint: string, emoji: string, title: string) {
  return async (args: { limit?: number }) => {
    const data = await fetchApi<any[]>(endpoint);
    return [`${emoji} ${title}`, '', formatList(data, args.limit || 10)].join('\n');
  };
}

/** 简单文本类工具的 handler 工厂 */
export function createSimpleTextHandler(
  endpoint: string,
  emoji: string,
  title: string,
  fields: string[],
) {
  return async () => {
    const data = await fetchApi<any>(endpoint);
    const text =
      fields.reduce<string>((result, f) => result || data[f] || '', '') ||
      (typeof data === 'string' ? data : '');
    return `${emoji} ${title}\n\n${text}`;
  };
}
