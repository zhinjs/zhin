/**
 * KOOK platform permit — guild / channel 差异化门禁
 */
import { registerPlatformPermitChecker, type Message } from '@zhin.js/core';
import { KookPermission } from './protocol.js';

const ADAPTER = 'kook';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'guild_admin',
  scene_owner: 'guild_owner',
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

function senderPermits(message: Message<any>): { role?: string; permissions: string[] } {
  const sender = message.$sender as KookSenderInfo & { role?: string; permissions?: string[] };
  const permissions = [...(sender.permissions ?? [])];
  if (sender.isGuildOwner) permissions.push('guild_owner');
  if (sender.isAdmin) permissions.push('guild_admin');
  if (sender.permission === KookPermission.ChannelAdmin) permissions.push('channel_admin');
  return { role: sender.role, permissions };
}

export function checkKookPlatformPermit(perm: string, message: Message<any>): boolean {
  const { role, permissions } = senderPermits(message);
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

export function registerKookPlatformPermitChecker(): () => void {
  return registerPlatformPermitChecker(ADAPTER, checkKookPlatformPermit);
}
