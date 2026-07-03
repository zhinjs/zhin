/**
 * Telegram platform permit — ChatMember 状态 + 细粒度权限
 */
import type { Message } from 'zhin.js';
import { registerPlatformPermitChecker } from 'zhin.js';

const ADAPTER = 'telegram';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'chat_administrator',
  scene_owner: 'chat_creator',
};

export function telegramGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeTelegramChatMember(member: {
  status?: string;
  can_restrict_members?: boolean;
  can_pin_messages?: boolean;
  can_delete_messages?: boolean;
  can_manage_chat?: boolean;
}): { role?: string; permissions: string[] } {
  const permissions: string[] = [];
  const status = member.status;
  if (status === 'creator') {
    permissions.push('chat_creator', 'chat_administrator', 'restrict_members', 'pin_messages');
    return { role: 'creator', permissions };
  }
  if (status === 'administrator') {
    permissions.push('chat_administrator');
    if (member.can_restrict_members) permissions.push('restrict_members');
    if (member.can_pin_messages) permissions.push('pin_messages');
    if (member.can_delete_messages) permissions.push('delete_messages');
    if (member.can_manage_chat) permissions.push('manage_chat');
    return { role: 'administrator', permissions };
  }
  return { role: 'member', permissions };
}

function senderPermits(message: Message<any>): { role?: string; permissions: string[] } {
  const sender = message.$sender as { role?: string; permissions?: string[] };
  return { role: sender.role, permissions: sender.permissions ?? [] };
}

export function checkTelegramPlatformPermit(perm: string, message: Message<any>): boolean {
  const { role, permissions } = senderPermits(message);
  const has = (t: string) => permissions.includes(t);

  switch (perm) {
    case 'chat_creator':
      return role === 'creator' || has('chat_creator');
    case 'chat_administrator':
      return role === 'creator' || role === 'administrator' || has('chat_administrator');
    case 'restrict_members':
      return has('restrict_members') || role === 'creator';
    case 'pin_messages':
      return has('pin_messages') || role === 'creator';
    case 'manage_chat':
      return has('manage_chat') || role === 'creator';
    default:
      return false;
  }
}

export function registerTelegramPlatformPermitChecker(): () => void {
  return registerPlatformPermitChecker(ADAPTER, checkTelegramPlatformPermit);
}
