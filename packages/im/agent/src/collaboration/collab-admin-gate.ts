/**
 * CollabAdminGate — 多 Bot 群 /collab 管理指令门控。
 *
 * 当群内有多个 Bot 同时在线时，/collab init|bind|unbind|reset 等管理指令
 * 仅由被 @-mention 的 endpoint 执行并回复，其余 endpoint 静默忽略。
 *
 * 规则：
 * 1. 消息含 at segment 且目标是本 endpoint → 放行
 * 2. 消息不含任何 at segment 且群内只有 1 个 Bot → 放行
 * 3. 其余情况 → 拦截
 */

import type { Message, Plugin } from '@zhin.js/core';
import { extractAtTargets } from './init-observe-hook.js';

interface EndpointLike {
  $config?: Record<string, unknown>;
  $platformUserId?: string;
}

/**
 * 获取当前 endpoint 在平台上可被 @ 到的所有 id。
 */
function resolveLocalEndpointIds(
  root: Plugin,
  adapter: string,
  endpointId: string,
): Set<string> {
  const ids = new Set<string>([endpointId]);
  try {
    const ad = root.inject(adapter) as
      | { endpoints?: Map<string, EndpointLike> }
      | undefined;
    const ep = ad?.endpoints?.get(endpointId);
    if (ep?.$config?.name) ids.add(String(ep.$config.name));
    if (ep?.$config?.appid) ids.add(String(ep.$config.appid));
    if (ep?.$platformUserId) ids.add(String(ep.$platformUserId));
  } catch {
    // adapter not ready
  }
  return ids;
}

/**
 * 统计群内在线 Bot 数量（跨 adapter）。
 */
function countOnlineBotsInGroup(root: Plugin): number {
  let count = 0;
  for (const adapterName of root.adapters) {
    try {
      const adapter = root.inject(String(adapterName)) as
        | { endpoints?: Map<string, { $connected?: boolean }> }
        | undefined;
      if (!adapter?.endpoints) continue;
      for (const ep of adapter.endpoints.values()) {
        if (ep.$connected) count++;
      }
    } catch {
      // skip
    }
  }
  return count;
}

export interface AdminGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 检查当前 endpoint 是否应处理 /collab 管理指令。
 */
export function checkCollabAdminGate(
  message: Message,
  endpointId: string,
  root: Plugin,
): AdminGateResult {
  const adapter = String(message.$adapter ?? '');
  const atTargets = extractAtTargets(message);

  if (atTargets.length > 0) {
    const myIds = resolveLocalEndpointIds(root, adapter, endpointId);
    const isMentioned = atTargets.some((t) => myIds.has(t));
    if (isMentioned) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'at_other_endpoint' };
  }

  const botCount = countOnlineBotsInGroup(root);
  if (botCount <= 1) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'multi_bot_no_mention' };
}
