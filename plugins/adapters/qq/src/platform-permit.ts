/**
 * QQ 官方频道 platform permit（guild/channel，非 QQ 群 group_*）
 */
import type { PermissionSubject } from '@zhin.js/permission';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

/** 官方频道工厂工具：映射到 guild 语义，不用 group_* */
const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'guild_admin',
  owner: 'guild_owner',
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

/**
 * QQ 官方频道事件 `member.roles` 中的内置身份 id：4 = 频道主，2 = 超级管理员。
 * 事件已自带，无需额外 API；其余 id（含 5 子频道管理员）不视为 admin。
 */
const QQ_GUILD_OWNER_ROLE_ID = '4';
const QQ_GUILD_ADMIN_ROLE_ID = '2';

/** 入站角色投影：规范角色 owner / admin 进 roles，原始角色 id 进 permissions（`role:<id>`）。 */
export function projectQqGuildSenderRoles(authorRoles: readonly string[] | undefined): {
  role?: 'owner' | 'admin';
  permissions: string[];
} {
  const ids = authorRoles ?? [];
  const projected = normalizeQqGuildSenderForPermit({
    roles: ids.map((id) => `role:${id}`),
    isOwner: ids.includes(QQ_GUILD_OWNER_ROLE_ID),
    isAdmin: ids.includes(QQ_GUILD_ADMIN_ROLE_ID),
  });
  const role = projected.role === 'owner' || projected.role === 'admin' ? projected.role : undefined;
  return { ...(role ? { role } : {}), permissions: projected.permissions ?? [] };
}

export function checkQqPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
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
