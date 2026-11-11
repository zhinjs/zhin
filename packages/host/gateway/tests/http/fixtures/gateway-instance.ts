// Instance for the CLI-supervised gateway test: run as `<entry> runtime start …` by
// runGateway, serves its routes over the control channel only (no listener of its own).
import { CONSOLE_BUILTIN_ROLES } from '@zhin.js/console-protocol';
import { createBridgedHttpHost, openInstanceControlChannel } from '@zhin.js/host-http/bridge';

const channel = openInstanceControlChannel();
if (!channel) throw new Error('expected a gateway control channel');
const host = createBridgedHttpHost({ channel });
const audits: unknown[] = [];
if (process.env.FAKE_OWNER === '1') {
  // Stands in for the instance's Console IAM (ADR 0049) until B1.4 moves it into the gateway.
  host.tokenRegistry.useAccessProvider({
    initialized: () => true,
    authenticate: async (token) => token === 'owner-token'
      ? {
        kind: 'user', userId: 'u1', username: 'owner', displayName: 'Owner', credentialId: 's1',
        grants: [{ role: 'owner', scope: { kind: 'global' }, permissions: CONSOLE_BUILTIN_ROLES.owner.permissions }],
        roles: ['owner'],
      }
      : token === 'nobody-token'
        ? { kind: 'user', userId: 'u2', username: 'nobody', displayName: 'Nobody', credentialId: 's2', grants: [], roles: [] }
        : null,
    audit: (entry) => { audits.push(entry); },
  });
}
host.route('GET', '/hello', () => Response.json({ hello: 'instance', pid: process.pid, origin: host.address?.origin ?? null }));
host.route('POST', '/api/console/request', async (request, context) => Response.json({
  forwarded: await request.json(),
  principal: context.principal ?? null,
  audits,
}));
host.route('POST', '/exit', () => {
  setTimeout(() => { void host.close().then(() => { channel.close(); process.exit(0); }); }, 10);
  return new Response(null, { status: 202 });
});
channel.onShutdown(() => {
  void host.close().then(() => { channel.close(); process.disconnect?.(); });
});
await host.listen();
channel.ready({ generation: 1, routes: host.routeTable() });
