import { CONSOLE_BUILTIN_ROLES } from '../../../packages/console/protocol/src/index.ts';

/**
 * Console access control (ADR 0049) for smoke Hosts: marks the Host initialised and maps bearer
 * tokens to signed-in users holding one built-in role globally (`'none'` = signed in, no permission).
 * @param {import('../../../packages/host/http/src/index.ts').HttpHost} http
 * @param {Readonly<Record<string, keyof typeof CONSOLE_BUILTIN_ROLES | 'none'>>} users
 */
export function installSmokeConsoleUsers(http, users) {
  const principals = new Map(Object.entries(users).map(([token, role]) => [token, Object.freeze({
    kind: 'user',
    userId: `smoke-${role}`,
    username: `smoke-${role}`,
    displayName: `smoke-${role}`,
    credentialId: `${role}-session`,
    grants: role === 'none' ? [] : [{ role, scope: { kind: 'global' }, permissions: CONSOLE_BUILTIN_ROLES[role].permissions }],
    roles: role === 'none' ? [] : [role],
  })]));
  http.tokenRegistry.useAccessProvider({
    initialized: () => true,
    authenticate: async token => principals.get(token) ?? null,
  });
  return http;
}
