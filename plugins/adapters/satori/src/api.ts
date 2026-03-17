/**
 * Satori HTTP API 封装：POST /v1/{resource}.{method}，头 Satori-Platform、Satori-User-ID、Authorization
 * 参考 https://satori.chat/en-US/protocol/api.html
 */
export interface SatoriApiOptions {
  baseUrl: string;
  platform: string;
  userId: string;
  token?: string;
}

/**
 * 调用 Satori API：POST {baseUrl}/v1/{resource}.{method}，JSON body
 */
export async function callSatoriApi<T = unknown>(
  options: SatoriApiOptions,
  resource: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { baseUrl, platform, userId, token } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/v1/${resource}.${method}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Satori-Platform': platform,
    'Satori-User-ID': userId,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error(`Satori API 认证失败: ${text}`);
  if (res.status === 403) throw new Error(`Satori API 权限不足: ${text}`);
  if (res.status === 404) throw new Error(`Satori API 不存在: ${resource}.${method}`);
  if (res.status >= 400) throw new Error(`Satori API 错误 ${res.status}: ${text}`);

  if (!text || text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Satori API 无效 JSON: ${text.slice(0, 200)}`);
  }
}
