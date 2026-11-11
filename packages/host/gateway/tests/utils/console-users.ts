import { CONSOLE_BUILTIN_ROLES, type ConsoleBindingScope, type ConsoleBuiltinRoleName } from '@zhin.js/console-protocol';
import type { ConsoleAuditEntry, ConsoleUserPrincipal, HttpHost } from '@zhin.js/host-http';

/** A signed-in Console user holding one built-in role at one scope. */
export function testUser(role: ConsoleBuiltinRoleName, scope: ConsoleBindingScope = { kind: 'global' }, id: string = role): ConsoleUserPrincipal {
  return Object.freeze({
    kind: 'user' as const,
    userId: id,
    username: id,
    displayName: id,
    credentialId: `${id}-session`,
    grants: Object.freeze([{ role, scope, permissions: CONSOLE_BUILTIN_ROLES[role].permissions }]),
    roles: Object.freeze([role]),
  });
}

/** Signed in, but holding no permission (stands in for the removed demo token in denial tests). */
export function noPermissionUser(id = 'nobody'): ConsoleUserPrincipal {
  return Object.freeze({ ...testUser('viewer', { kind: 'global' }, id), grants: Object.freeze([]), roles: Object.freeze([]) });
}

/**
 * Marks the Host initialised (an owner exists) and maps bearer tokens to Console users, the
 * ADR 0049 replacement for the removed `http.tokens` fixtures. Returns the recorded audit.
 */
export function installTestConsoleUsers(
  http: HttpHost,
  users: Readonly<Record<string, ConsoleBuiltinRoleName | 'none' | ConsoleUserPrincipal>>,
): ConsoleAuditEntry[] {
  const audits: ConsoleAuditEntry[] = [];
  const principals = new Map(Object.entries(users).map(([token, user]) => [token,
    user === 'none' ? noPermissionUser(token) : typeof user === 'string' ? testUser(user, { kind: 'global' }, token) : user]));
  http.tokenRegistry.useAccessProvider({
    initialized: () => true,
    authenticate: async token => principals.get(token) ?? null,
    audit: entry => { audits.push(entry); },
  });
  return audits;
}

/** {@link installTestConsoleUsers} as an expression: returns the host. */
export function withTestUsers<T extends HttpHost>(
  http: T,
  users: Readonly<Record<string, ConsoleBuiltinRoleName | 'none' | ConsoleUserPrincipal>>,
): T {
  installTestConsoleUsers(http, users);
  return http;
}
