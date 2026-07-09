/**
 * 入站 Endpoint 解析 — @ 候选 ID 与 aiAccess（阶段 4）。
 */
import type { Plugin, Message, AIAccessScopeConfig } from '@zhin.js/core';

type InboundEndpointRecord = {
  $config?: Record<string, unknown> & { aiAccess?: AIAccessScopeConfig };
  $platformUserId?: string;
};

/** 从 root 注入 adapter 解析当前 message 的 endpoint 记录；adapter 未就绪时返回 undefined。 */
export function resolveEndpointConfig(message: Message, root: Plugin): InboundEndpointRecord | undefined {
  try {
    const adapter = root.inject(message.$adapter) as
      | { endpoints?: Map<string, InboundEndpointRecord> }
      | undefined;
    return adapter?.endpoints?.get(message.$endpoint);
  } catch {
    return undefined;
  }
}

export function resolveEndpointAtIds(message: Message, root: Plugin): string[] {
  const ids = new Set<string>([String(message.$endpoint)]);
  const endpoint = resolveEndpointConfig(message, root);
  const cfg = endpoint?.$config;
  if (cfg?.name) ids.add(String(cfg.name));
  if (cfg?.appid) ids.add(String(cfg.appid));
  if (endpoint?.$platformUserId) ids.add(String(endpoint.$platformUserId));
  return [...ids];
}

export function resolveEndpointAiAccess(message: Message, root: Plugin): AIAccessScopeConfig | undefined {
  return resolveEndpointConfig(message, root)?.$config?.aiAccess;
}
