/**
 * OneBot 12 HTTP 动作调用：POST 动作请求到实现的 HTTP 端点，返回动作响应
 * 参考 https://12.onebot.dev/connect/communication/http/
 */
import type { OneBot12ActionRequest, OneBot12ActionResponse } from './types.js';

export interface OneBot12HttpOptions {
  url: string;
  access_token?: string;
}

/**
 * 向 OneBot 实现发送动作请求（HTTP POST），返回动作响应
 */
export async function callOneBot12Action(
  options: OneBot12HttpOptions,
  action: string,
  params: Record<string, unknown> = {},
  echo?: string,
): Promise<OneBot12ActionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.access_token) {
    headers['Authorization'] = `Bearer ${options.access_token}`;
  }
  const body: OneBot12ActionRequest = { action, params };
  if (echo) body.echo = echo;

  const res = await fetch(options.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error(`OneBot12 鉴权失败: ${text}`);
  if (res.status !== 200) throw new Error(`OneBot12 HTTP ${res.status}: ${text}`);

  let data: OneBot12ActionResponse;
  try {
    data = JSON.parse(text) as OneBot12ActionResponse;
  } catch {
    throw new Error(`OneBot12 无效响应: ${text.slice(0, 200)}`);
  }
  if (data.status === 'failed' && data.retcode !== 0) {
    throw new Error(`OneBot12 动作失败 retcode=${data.retcode}: ${data.message}`);
  }
  return data;
}
