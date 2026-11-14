import { isGlobalOwnerPrincipal, isLocalSocketPrincipal, type ConsoleUserPrincipal } from '@zhin.js/host-http';
import { LOCAL_OWNER_PRINCIPAL } from '../../src/http/local-principal.js';

// #1250: CLI-only inference routes recognise the control-socket principal and nothing else.
it('recognises only the gateway control-socket principal as the local CLI', () => {
  expect(isLocalSocketPrincipal(LOCAL_OWNER_PRINCIPAL)).toBe(true);
  expect(isGlobalOwnerPrincipal(LOCAL_OWNER_PRINCIPAL)).toBe(true);
  const session: ConsoleUserPrincipal = { ...LOCAL_OWNER_PRINCIPAL, credentialId: 'a1b2c3-session-hash' };
  expect(isLocalSocketPrincipal(session)).toBe(false);
  const token: ConsoleUserPrincipal = { ...LOCAL_OWNER_PRINCIPAL, kind: 'api-token' };
  expect(isLocalSocketPrincipal(token)).toBe(false);
  expect(isLocalSocketPrincipal({ kind: 'bootstrap', open: true })).toBe(false);
  expect(isGlobalOwnerPrincipal({ ...LOCAL_OWNER_PRINCIPAL, grants: [{ role: 'owner', scope: { kind: 'adapter', key: 'qq' }, permissions: [] }] })).toBe(false);
});
