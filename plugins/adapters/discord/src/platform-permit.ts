/**
 * Discord platform permit — Guild 权限位
 */
import type { PermissionSubject } from '@zhin.js/permission';

const ADAPTER = 'discord';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'moderate_members',
  scene_owner: 'guild_owner',
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
  const role = subject.sender?.role?.[0];
  const permissions = subject.sender?.permissions ?? [];
  const has = (t: string) => permissions.includes(t);

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

