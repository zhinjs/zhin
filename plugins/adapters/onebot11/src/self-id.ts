import { callOnebot11Client, type Onebot11Client } from './client.js';

/**
 * 规范化 OneBot11 平台账号 id（`self_id` / `get_login_info.user_id`）。
 * 非法值、空串、0 均视为未知；绝不使用 `config.id`（那是 Endpoint 名，不是平台账号）。
 */
export function resolveOnebot11SelfId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '0' ? undefined : trimmed;
}

/** Best-effort `get_login_info`；失败返回 undefined 并交给调用方 debug，不抛错。 */
export async function probeOnebot11SelfId(
  client: Onebot11Client,
  onError: (error: unknown) => void,
): Promise<string | undefined> {
  try {
    const data = await callOnebot11Client<{ user_id?: number | string }>({ client, action: 'get_login_info' });
    return resolveOnebot11SelfId(data?.user_id);
  } catch (error) {
    onError(error);
    return undefined;
  }
}
