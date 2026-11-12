/**
 * 声明式权限定义 — 供 permissions/ 约定目录使用。
 */

import type { PermissionChecker } from './host.js';

export interface PermissionDefinition {
  readonly name: string | RegExp;
  readonly check: PermissionChecker;
}

export function definePermission(definition: PermissionDefinition): PermissionDefinition {
  return Object.freeze(definition);
}
