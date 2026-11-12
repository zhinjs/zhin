/**
 * The principal of requests from the local control socket (`gateway.http.request`, ADR 0054 §6).
 * Connecting to `.zhin/gateway.sock` requires the project owner's OS account (the socket's owner
 * check), which the gateway treats as the Console owner. The instance sees a global owner; audit
 * entries name it `user:local`.
 */
import { CONSOLE_PERMISSION_LIST } from '@zhin.js/console-protocol';
import type { ConsoleUserPrincipal } from '@zhin.js/host-http';

export const LOCAL_OWNER_PRINCIPAL: ConsoleUserPrincipal = Object.freeze({
  kind: 'user',
  userId: 'local',
  username: 'local',
  displayName: '本机 CLI（网关控制套接字）',
  credentialId: 'local-socket',
  grants: Object.freeze([Object.freeze({ role: 'owner', scope: Object.freeze({ kind: 'global' }), permissions: CONSOLE_PERMISSION_LIST })]),
  roles: Object.freeze(['owner']),
}) as ConsoleUserPrincipal;
