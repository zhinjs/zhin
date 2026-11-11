import { describe, expect, it } from 'vitest';
import { jsonResponse } from '@zhin.js/host-http-contract';
import { createHttpRouter } from '../src/http-host.js';
import type { ConsolePrincipal } from '../src/access-control.js';

const statusViewer: ConsolePrincipal = Object.freeze({
  kind: 'user',
  userId: 'u1',
  username: 'alice',
  displayName: 'Alice',
  credentialId: 's1',
  roles: [],
  grants: [{ scope: { kind: 'global' }, permissions: ['status.view'] }],
});

describe('router authentication modes (ADR 0054 §3)', () => {
  it('credentials mode ignores a principal supplied by the transport', async () => {
    const router = createHttpRouter({ token: 'bootstrap-secret' });
    router.route('GET', '/api/system/status', () => jsonResponse(200, { ok: true }));
    router.ws('/sandbox').onConnection(() => undefined);
    const response = await router.handle(new Request('http://local/api/system/status'), { principal: statusViewer });
    expect(response.status).toBe(401);
    const upgrade = await router.upgrade({ url: new URL('http://local/sandbox'), headers: new Headers(), principal: { kind: 'bootstrap', open: true } });
    expect(upgrade).toMatchObject({ accepted: false, status: 401 });
    router.close();
  });

  it('forwarded mode trusts the forwarded principal, never parses credentials, and still authorizes', async () => {
    const router = createHttpRouter({ token: 'bootstrap-secret', authentication: 'forwarded' });
    router.route('GET', '/api/system/status', (_request, context) => jsonResponse(200, { user: context.principal?.kind }));
    router.ws('/sandbox').onConnection(() => undefined);
    // A valid bootstrap token in the request does not authenticate here.
    const withToken = await router.handle(new Request('http://local/api/system/status', { headers: { authorization: 'Bearer bootstrap-secret' } }));
    expect(withToken.status).toBe(401);
    expect((await router.handle(new Request('http://local/api/system/status'), { principal: statusViewer })).status).toBe(200);
    const denied = await router.handle(new Request('http://local/api/system/status'), {
      principal: { ...statusViewer, grants: [{ scope: { kind: 'adapter', key: 'qq' }, permissions: ['status.view'] }] },
    });
    expect(denied.status).toBe(403);
    expect(await router.upgrade({ url: new URL('http://local/sandbox?token=bootstrap-secret'), headers: new Headers() }))
      .toMatchObject({ accepted: false, status: 401 });
    expect(await router.upgrade({ url: new URL('http://local/sandbox'), headers: new Headers(), principal: statusViewer }))
      .toMatchObject({ accepted: false, status: 401 });
    const accepted = await router.upgrade({ url: new URL('http://local/sandbox'), headers: new Headers(), principal: { kind: 'bootstrap', open: true } });
    expect(accepted.accepted).toBe(true);
    if (accepted.accepted) accepted.reject();
    router.close();
  });

  it('lists WebSocket routes with their authentication and reports registration changes', () => {
    const router = createHttpRouter();
    let changes = 0;
    router.onRoutesChanged(() => { changes += 1; });
    const handle = router.ws('/reverse', { auth: 'protocol' });
    const stop = handle.onConnection(() => undefined);
    router.ws('/mixed', { auth: 'protocol' }).onConnection(() => undefined);
    router.ws('/mixed').onConnection(() => undefined);
    expect(router.listWsRoutes()).toEqual([{ path: '/reverse', auth: 'protocol' }, { path: '/mixed', auth: 'host' }]);
    const dispose = router.route('GET', '/x', () => new Response(null));
    dispose();
    dispose();
    stop();
    expect(changes).toBe(6); // 3 sockets, route add + remove (second dispose is a no-op), socket stop
    expect(router.listWsRoutes().map((route) => route.path)).toEqual(['/mixed']);
    router.close();
  });
});
