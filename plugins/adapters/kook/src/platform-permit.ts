/**
 * KOOK platform permit — guild / channel 差异化门禁
 */
import type { PermissionSubject } from '@zhin.js/permission';
import { KookPermission } from './protocol.js';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'guild_admin',
  owner: 'guild_owner',
};

export function kookGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export interface KookSenderInfo {
  id: string;
  name: string;
  permission?: KookPermission;
  roles?: number[];
  isGuildOwner?: boolean;
  isAdmin?: boolean;
  role?: string;
  permissions?: string[];
}

export function normalizeKookSenderForPermit(
  info: KookSenderInfo,
  isChannel: boolean,
): { role?: string; permissions?: string[] } {
  const permissions: string[] = [];
  if (info.roles?.length) {
    permissions.push(...info.roles.map((r) => `role:${r}`));
  }

  if (info.isGuildOwner || info.permission === KookPermission.Owner) {
    permissions.push('guild_owner', 'guild_admin');
    return { role: 'owner', permissions };
  }
  if (info.permission === KookPermission.ChannelAdmin && isChannel) {
    permissions.push('channel_admin', 'guild_admin');
    return { role: 'channel_admin', permissions };
  }
  if (info.isAdmin || info.permission === KookPermission.Admin) {
    permissions.push('guild_admin');
    return { role: 'admin', permissions };
  }
  return { role: 'member', permissions };
}

export function checkKookPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
  const has = (t: string) => permissions.includes(t);

  switch (perm) {
    case 'guild_owner':
      return role === 'owner' || has('guild_owner');
    case 'guild_admin':
      return role === 'owner' || role === 'admin' || role === 'channel_admin' || has('guild_admin') || has('channel_admin');
    case 'channel_admin':
      return role === 'owner' || role === 'admin' || role === 'channel_admin' || has('channel_admin') || has('guild_admin');
    case 'manage_roles':
      return role === 'owner' || role === 'admin' || has('guild_owner') || has('guild_admin');
    default:
      return false;
  }
}

