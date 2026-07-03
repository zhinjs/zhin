/**
 * QQ 官方频道 platform permit（guild/channel，非 QQ 群 group_*）
 */
import type { Message } from 'zhin.js';
import { registerPlatformPermitChecker } from 'zhin.js';

const ADAPTER = 'qq';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

/** 官方频道工厂工具：映射到 guild 语义，不用 group_* */
const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'guild_admin',
  scene_owner: 'guild_owner',
};

export function qqGuildPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeQqGuildSenderForPermit(input: {
  roles?: string[];
  isOwner?: boolean;
  isAdmin?: boolean;
}): { role?: string; permissions?: string[] } {
  const permissions = [...(input.roles ?? [])];
  if (input.isOwner) {
    permissions.push('guild_owner', 'guild_admin');
    return { role: 'owner', permissions };
  }
  if (input.isAdmin) {
    permissions.push('guild_admin');
    return { role: 'admin', permissions };
  }
  return { role: 'member', permissions };
}

export function checkQqPlatformPermit(perm: string, message: Message<any>): boolean {
  const sender = message.$sender as { role?: string; permissions?: string[] };
  const permissions = sender.permissions ?? [];
  const role = sender.role;
  const has = (t: string) => permissions.includes(t);

  switch (perm) {
    case 'guild_owner':
      return role === 'owner' || has('guild_owner');
    case 'guild_admin':
      return role === 'owner' || role === 'admin' || has('guild_admin') || has('guild_owner');
    case 'manage_roles':
      return role === 'owner' || has('guild_owner') || has('manage_roles');
    case 'manage_channels':
      return role === 'owner' || role === 'admin' || has('guild_owner') || has('guild_admin') || has('manage_channels');
    default:
      return false;
  }
}

export function registerQqPlatformPermitChecker(): () => void {
  return registerPlatformPermitChecker(ADAPTER, checkQqPlatformPermit);
}
