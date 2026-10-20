import type { AccessSnapshot, PageManifest } from '@zhin.js/console-contract';

export interface AccessIndex {
  readonly permissions: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
}

export function createAccessIndex(access: AccessSnapshot): AccessIndex {
  return Object.freeze({
    permissions: new Set(access.permissions),
    roles: new Set(access.roles),
  });
}

export function allowsPage(page: PageManifest, access: AccessIndex): boolean {
  return page.requiredPermissions.every((permission) => access.permissions.has(permission))
    && page.requiredRoles.every((role) => access.roles.has(role));
}
