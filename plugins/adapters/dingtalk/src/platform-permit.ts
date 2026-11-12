/**
 * 钉钉 DingTalk platform permit
 */
import type { PermissionSubject } from '@zhin.js/permission';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'chat_admin',
  owner: 'chat_owner',
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

export function checkDingtalkPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
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

