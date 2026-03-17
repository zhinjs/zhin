/**
 * Milky HTTP API 封装：鉴权 + POST /api/:api
 */
import type { MilkyApiResponse } from './types.js';

export interface MilkyApiClientOptions {
  baseUrl: string;
  access_token?: string;
}

/** 鉴权：Header Authorization: Bearer {token} 或 URL query access_token=xxx */
function authHeaders(access_token?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (access_token) {
    headers['Authorization'] = `Bearer ${access_token}`;
  }
  return headers;
}

function authQuery(access_token?: string): string {
  if (!access_token) return '';
  return `access_token=${encodeURIComponent(access_token)}`;
}

/**
 * 调用协议端 API：POST {baseUrl}/api/{apiName}，Body JSON，鉴权。
 * 非 200 或 retcode !== 0 时抛错。
 */
export async function callApi<T = unknown>(
  options: MilkyApiClientOptions,
  apiName: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { baseUrl, access_token } = options;
  const url = new URL(`/api/${apiName}`, baseUrl.replace(/\/$/, ''));
  const q = authQuery(access_token);
  if (q) url.search = (url.search ? url.search + '&' : '') + q;

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(access_token),
    },
    body: JSON.stringify(Object.keys(params).length ? params : {}),
  });

  const text = await res.text();
  let body: MilkyApiResponse<T>;
  try {
    body = JSON.parse(text) as MilkyApiResponse<T>;
  } catch {
    throw new Error(`Milky API ${apiName}: invalid JSON response (${res.status}) ${text.slice(0, 200)}`);
  }

  if (res.status !== 200) {
    throw new Error(`Milky API ${apiName}: HTTP ${res.status} ${body.message ?? text}`);
  }
  if (body.retcode !== 0) {
    throw new Error(`Milky API ${apiName}: retcode=${body.retcode} ${body.message ?? ''}`);
  }
  return (body.data ?? {}) as T;
}
