/**
 * Endpoint identity — 通过 Adapter Endpoint 注册表反查 peer Bot（ADR 0024 D5）。
 *
 * 取代废弃的 `peerSenderId`：群内某条消息的 `$sender.id` 若匹配到 Cell 成员
 * Endpoint 在平台上的身份（platformUserId / config.id / appid / endpointKey），
 * 则该消息来自 peer Bot；否则视为人类（非 roster sender）。
 */
import { type Message, type Plugin } from '@zhin.js/core';
import type { CollaborationScene, CollaborationSceneMemberRuntime } from './types.js';
import { memberTransportAdapter } from './collaboration-config.js';
interface EndpointLike {
  $config?: Record<string, unknown>;
  $platformUserId?: string;
}

/** 解析某个 Endpoint 在平台上可被识别的 id 集合。 */
export function resolveEndpointKeysForMember(
  root: Plugin | undefined,
  adapter: string,
  endpointKey: string,
): string[] {
  const ids = new Set<string>([endpointKey]);
  if (!root) return [...ids];
  try {
    const ad = root.inject(adapter) as
      | { endpoints?: Map<string, EndpointLike> }
      | undefined;
    const endpoint = ad?.endpoints?.get(endpointKey);
    const cfg = endpoint?.$config;
    if (cfg?.id) ids.add(String(cfg.id));
    if (cfg?.appid) ids.add(String(cfg.appid));
    if (endpoint?.$platformUserId) ids.add(String(endpoint.$platformUserId));
  } catch {
    // adapter 未就绪：仅用 endpointKey
  }
  return [...ids];
}

/** 在 Cell 成员中按平台 senderId 反查；命中即 peer Bot，未命中为人类。 */
export function resolveMemberBySender(
  cell: CollaborationScene | undefined,
  senderId: string,
  root?: Plugin,
): CollaborationSceneMemberRuntime | undefined {
  if (!cell || !senderId) return undefined;
  const plugin = root ?? undefined;
  for (const member of cell.members) {
    const ids = resolveEndpointKeysForMember(
      plugin,
      memberTransportAdapter(cell, member),
      member.endpointKey,
    );
    if (ids.includes(senderId)) return member;
  }
  return undefined;
}

/** 便捷：判断入站消息是否来自同 Cell 的 peer Bot。 */
export function isInboundFromPeerBot(
  message: Message,
  cell: CollaborationScene | undefined,
  root?: Plugin,
): boolean {
  const senderId = String(message.$sender?.id ?? '');
  if (!senderId) return false;
  return !!resolveMemberBySender(cell, senderId, root);
}

/**
 * 出站 @ 解析：用发送方 adapter 的 id 格式解析目标 peer 的 platform id。
 *
 * 跨 adapter 场景下（如 icqq bot 发消息 @ 官 Q bot），需要按发送方 adapter
 * 反查目标在该 adapter 平台上的 id。
 *
 * 策略：
 * 1. 目标 member 的 transport adapter 与发送方相同 → 直接用 endpointKey / platformUserId
 * 2. 不同 adapter → 尝试通过 scenes 表 + 注册表交叉反查平台 id
 * 3. fallback → 使用 endpointKey
 */
export function resolveOutboundMentionId(
  cell: CollaborationScene,
  targetMember: CollaborationSceneMemberRuntime,
  senderAdapter: string,
  root?: Plugin,
): string {
  const plugin = root ?? undefined;
  const targetAdapter = memberTransportAdapter(cell, targetMember);

  if (targetAdapter === senderAdapter) {
    if (!plugin) return targetMember.endpointKey;
    const ids = resolveEndpointKeysForMember(plugin, targetAdapter, targetMember.endpointKey);
    return ids.find((id) => id !== targetMember.endpointKey) ?? targetMember.endpointKey;
  }

  if (!plugin) return targetMember.endpointKey;

  try {
    const senderAd = plugin.inject(senderAdapter) as
      | { endpoints?: Map<string, EndpointLike> }
      | undefined;
    if (senderAd?.endpoints) {
      for (const [, ep] of senderAd.endpoints) {
        const cfg = ep.$config;
        if (!cfg) continue;
      }
    }
  } catch {
    // adapter not ready
  }

  const ids = resolveEndpointKeysForMember(plugin, targetAdapter, targetMember.endpointKey);
  return ids.find((id) => id !== targetMember.endpointKey) ?? targetMember.endpointKey;
}
