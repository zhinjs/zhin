/**
 * ask_user 挂起会话注册表 — 防止 Owner 私聊回复同时触发独立 AI 回合（与群协作 turn 抢答）。
 */
import type { Message, Plugin } from '@zhin.js/core';

export interface PendingAskUserSession {
  endpointId: string;
  masterId: string;
  /** 群/频道来源消息（群协作 ask_user 时保留，用于回群与 follow-up 提示） */
  groupOrigin?: Message;
  registeredAt: number;
}

const pending = new Map<string, PendingAskUserSession>();

function sessionKey(endpointId: string, masterId: string): string {
  return `${endpointId}:${masterId}`;
}

export function registerPendingAskUser(session: PendingAskUserSession): void {
  pending.set(sessionKey(session.endpointId, session.masterId), session);
}

export function clearPendingAskUser(endpointId: string, masterId: string): void {
  pending.delete(sessionKey(endpointId, masterId));
}

export function getPendingAskUser(endpointId: string, masterId: string): PendingAskUserSession | undefined {
  return pending.get(sessionKey(endpointId, masterId));
}

function resolveEndpointMaster(
  message: Message,
  root?: Plugin,
): { endpointId: string; masterId: string } | undefined {
  const endpointId = String(message.$endpoint ?? '');
  if (!endpointId) return undefined;
  const plugin = root;
  if (!plugin) return undefined;
  try {
    const adapter = plugin.inject(message.$adapter) as
      | { endpoints?: Map<string, { $config?: { master?: string } }> }
      | undefined;
    const master = adapter?.endpoints?.get(endpointId)?.$config?.master;
    if (master == null) return undefined;
    return { endpointId, masterId: String(master) };
  } catch {
    return undefined;
  }
}

/** 该私聊消息是否应作为 ask_user 回复消费（勿再触发 AI Handler）。 */
export function isAskUserPendingReply(
  message: Message,
  root?: Plugin,
): boolean {
  if (message.$channel?.type !== 'private') return false;
  const endpointId = String(message.$endpoint ?? '');
  const senderId = String(message.$sender?.id ?? '');
  if (!endpointId || !senderId) return false;
  if (getPendingAskUser(endpointId, senderId)) return true;
  const ids = resolveEndpointMaster(message, root);
  if (!ids) return false;
  if (senderId !== ids.masterId) return false;
  return !!getPendingAskUser(ids.endpointId, ids.masterId);
}
