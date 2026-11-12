/**
 * Discord platform permit — Guild 权限位
 */
import type { PermissionSubject } from '@zhin.js/permission';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'moderate_members',
  owner: 'guild_owner',
};

export function discordGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeDiscordSenderForPermit(input: {
  isOwner?: boolean;
  permissions?: string[];
}): { role?: string; permissions?: string[] } {
  const permissions = [...(input.permissions ?? [])];
  if (input.isOwner) {
    permissions.push('guild_owner', 'ADMINISTRATOR');
    return { role: 'owner', permissions };
  }
  if (permissions.includes('ADMINISTRATOR')) {
    return { role: 'admin', permissions };
  }
  if (permissions.includes('MODERATE_MEMBERS') || permissions.includes('MANAGE_GUILD')) {
    return { role: 'admin', permissions };
  }
  return { role: 'member', permissions };
}

export function checkDiscordPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
  // Accepts legacy UPPER_SNAKE tokens and ADR 0056 §1 snake_case platform permission names.
  const has = (t: string) => permissions.includes(t) || permissions.includes(t.toLowerCase());

  switch (perm) {
    case 'guild_owner':
      return role === 'owner' || has('guild_owner');
    case 'moderate_members':
      return role === 'owner' || role === 'admin' || has('ADMINISTRATOR') || has('MODERATE_MEMBERS');
    case 'manage_roles':
      return role === 'owner' || has('ADMINISTRATOR') || has('MANAGE_ROLES');
    case 'manage_channels':
      return role === 'owner' || has('ADMINISTRATOR') || has('MANAGE_CHANNELS');
    default:
      return false;
  }
}

