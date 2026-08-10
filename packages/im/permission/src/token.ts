import { createToken } from '@zhin.js/plugin-runtime';
import type { PermissionHost } from './host.js';

export const permissionHostToken = createToken<PermissionHost>(
  'zhin.permission.host',
  'Unified PermissionHost for command/tool/platform-level auth',
);
