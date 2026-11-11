import { CONSOLE_BUILTIN_ROLES, type ConsoleBindingScope } from '@zhin.js/console-protocol';
import type { ConsoleUserPrincipal } from '../../src/access-control.js';

/** A signed-in Console user holding one built-in role at one scope. */
export function userPrincipal(
  role: keyof typeof CONSOLE_BUILTIN_ROLES,
  scope: ConsoleBindingScope = { kind: 'global' },
): ConsoleUserPrincipal {
  return Object.freeze({
    kind: 'user',
    userId: role,
    username: role,
    displayName: role,
    credentialId: `${role}-session`,
    grants: Object.freeze([{ role, scope, permissions: CONSOLE_BUILTIN_ROLES[role].permissions }]),
    roles: Object.freeze([role]),
  });
}

/** Read-only built-in `viewer` (replaces the removed demo scope in tests). */
export const VIEWER = userPrincipal('viewer');
