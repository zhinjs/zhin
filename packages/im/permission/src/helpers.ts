/**
 * 常见 IM 平台场景身份：sender.role 为 owner / admin。
 * 从旧 platform-permit 迁移到 PermissionHost 体系的等价 helper。
 */

import type { PermissionSubject } from './subject.js';
import type { PlatformPermitChecker } from './host.js';

export function createSceneRolePlatformChecker(): PlatformPermitChecker {
  return (perm: string, subject: PermissionSubject): boolean => {
    const role = subject.sender?.role?.[0];
    const permissions = subject.sender?.permissions;
    if (perm === 'scene_admin') {
      return role === 'admin' || role === 'owner'
        || (permissions?.includes('admin') ?? false)
        || (permissions?.includes('owner') ?? false);
    }
    if (perm === 'scene_owner') {
      return role === 'owner' || (permissions?.includes('owner') ?? false);
    }
    return false;
  };
}
