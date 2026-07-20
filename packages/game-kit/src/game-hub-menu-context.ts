import type { Message } from '@zhin.js/core';
import { channelKey } from './board-sender.js';
import { generateCompactId } from './random.js';

export interface HubMenuContext {
  channelKey: string;
  /** 打开菜单的用户（仅记录，大厅导航不限制点击者） */
  openerId: string;
  message: Message<any>;
  expiresAt: number;
}

export interface HubMenuChoice {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface LastHubMenu {
  scopeId: string;
  choices: HubMenuChoice[];
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const contexts = new Map<string, HubMenuContext>();
const lastMenus = new Map<string, LastHubMenu>();

/** 大厅 fallback 按频道共享，任意成员可回复数字或点按钮 */
function hubMenuKey(message: Message<any>): string {
  return channelKey(message);
}

export function createHubScope(message: Message<any>): string {
  const scopeId = generateCompactId('h');
  contexts.set(scopeId, {
    channelKey: channelKey(message),
    openerId: message.$sender.id,
    message,
    expiresAt: Date.now() + TTL_MS,
  });
  pruneExpired();
  return scopeId;
}

export function rememberHubMenu(
  message: Message<any>,
  scopeId: string,
  choices: HubMenuChoice[],
): void {
  lastMenus.set(hubMenuKey(message), {
    scopeId,
    choices,
    expiresAt: Date.now() + TTL_MS,
  });
  pruneExpired();
}

export function getLastHubMenu(message: Message<any>): LastHubMenu | null {
  pruneExpired();
  const key = hubMenuKey(message);
  const last = lastMenus.get(key);
  if (!last || last.expiresAt < Date.now()) {
    lastMenus.delete(key);
    return null;
  }
  return last;
}

export function getHubContext(scopeId: string): HubMenuContext | null {
  pruneExpired();
  const ctx = contexts.get(scopeId);
  if (!ctx || ctx.expiresAt < Date.now()) {
    contexts.delete(scopeId);
    return null;
  }
  return ctx;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, ctx] of contexts) {
    if (ctx.expiresAt < now) contexts.delete(id);
  }
  for (const [key, menu] of lastMenus) {
    if (menu.expiresAt < now) lastMenus.delete(key);
  }
}

/** 测试专用：清空菜单上下文 */
export function resetHubMenuContextForTests(): void {
  contexts.clear();
  lastMenus.clear();
}
