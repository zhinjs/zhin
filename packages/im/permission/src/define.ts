/**
 * 声明式权限定义 — 供 permissions/ 约定目录使用。
 */

import type { PermissionChecker, PlatformPermitChecker } from './host.js';

export interface PermissionDefinition {
  readonly name: string | RegExp;
  readonly check: PermissionChecker;
}

export interface PlatformPermissionDefinition {
  readonly adapter: string;
  readonly check: PlatformPermitChecker;
}

export function definePermission(definition: PermissionDefinition): PermissionDefinition {
  return Object.freeze(definition);
}

export function definePlatformPermission(
  definition: PlatformPermissionDefinition,
): PlatformPermissionDefinition {
  return Object.freeze(definition);
}
