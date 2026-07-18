/**
 * 钉钉 DingTalk platform permit
 */
import { registerPlatformPermitChecker, type Message } from '@zhin.js/core';

const ADAPTER = 'dingtalk';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'chat_admin',
  scene_owner: 'chat_owner',
};

export function dingtalkGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeDingtalkSenderForPermit(input: {
  isOwner?: boolean;
  isAdmin?: boolean;
}): { role?: string; permissions?: string[] } {
  if (input.isOwner) {
    return { role: 'owner', permissions: ['chat_owner', 'chat_admin'] };
  }
  if (input.isAdmin) {
    return { role: 'admin', permissions: ['chat_admin'] };
  }
  return { role: 'member', permissions: [] };
}

export function checkDingtalkPlatformPermit(perm: string, message: Message<any>): boolean {
  const sender = message.$sender as { role?: string; permissions?: string[] };
  const permissions = sender.permissions ?? [];
  const role = sender.role;
  const has = (t: string) => permissions.includes(t);

  switch (perm) {
    case 'chat_owner':
      return role === 'owner' || has('chat_owner');
    case 'chat_admin':
      return role === 'owner' || role === 'admin' || has('chat_admin') || has('chat_owner');
    default:
      return false;
  }
}

export function registerDingtalkPlatformPermitChecker(): () => void {
  return registerPlatformPermitChecker(ADAPTER, checkDingtalkPlatformPermit);
}
