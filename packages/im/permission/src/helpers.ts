/**
 * 常见 IM 平台场景身份：sender.role 为 owner / admin。
 * 常见场景角色的 PermissionHost checker。
 */

import type { PermissionSubject } from './subject.js';
import type { PlatformPermitChecker } from './host.js';
import { assertPermitSyntax } from './builtin.js';

/** Build a validated platform permission name for commands and tools. */
export function platformPermission(adapter: string, permission: string): string {
  const adapterName = adapter.trim();
  const permissionName = permission.trim();
  if (!adapterName || !permissionName) {
    throw new TypeError('Platform permission requires non-empty adapter and permission names');
  }
  const name = `platform(${adapterName},${permissionName})`;
  assertPermitSyntax([name]);
  return name;
}

export function createSceneRolePlatformChecker(): PlatformPermitChecker {
  return (perm: string, subject: PermissionSubject): boolean => {
    const roles = subject.sender?.role ?? [];
    const permissions = subject.sender?.permissions;
    if (perm === 'scene_admin') {
      return roles.includes('admin') || roles.includes('owner')
        || (permissions?.includes('admin') ?? false)
        || (permissions?.includes('owner') ?? false);
    }
    if (perm === 'scene_owner') {
      return roles.includes('owner') || (permissions?.includes('owner') ?? false);
    }
    return false;
  };
}
