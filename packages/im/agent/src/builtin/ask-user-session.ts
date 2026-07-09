/**
 * ask_user 挂起会话注册表 — 委托 AskUserSessionService（常驻 middleware）。
 */
import type { Message, Plugin } from '@zhin.js/core';
import { AskUserSessionService } from './ask-user-session-service.js';

export interface PendingAskUserSession {
  endpointId: string;
  masterId: string;
  groupOrigin?: Message;
  registeredAt: number;
}

export function registerPendingAskUser(_session: PendingAskUserSession): void {
  // legacy no-op：排队与会话状态由 AskUserSessionService 管理
}

export function clearPendingAskUser(_endpointId: string, _masterId: string): void {
  // legacy no-op
}

export function getPendingAskUser(_endpointId: string, _masterId: string): PendingAskUserSession | undefined {
  return undefined;
}

/** 该私聊消息是否应作为 ask_user 回复消费（勿再触发 AI Handler）。 */
export function isAskUserPendingReply(
  message: Message,
  root?: Plugin,
): boolean {
  const service = AskUserSessionService.get();
  if (!service) return false;
  return service.isPendingReply(message, root);
}

export function ensureAskUserSessionService(plugin: Plugin): AskUserSessionService {
  return AskUserSessionService.install(plugin);
}
