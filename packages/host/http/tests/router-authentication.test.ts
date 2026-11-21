import { describe, expect, it } from 'vitest';
import { jsonResponse } from '@zhin.js/host-http-contract';
import { createHttpRouter } from '../src/http-host.js';
import type { ConsolePrincipal } from '../src/access-control.js';
import { bindGenerationAdmission, createGenerationAdmissionGate } from '@zhin.js/plugin-runtime';

const statusViewer: ConsolePrincipal = Object.freeze({
  kind: 'user',
  userId: 'u1',
  username: 'alice',
  displayName: 'Alice',
  credentialId: 's1',
  roles: [],
  grants: [{ scope: { kind: 'global' }, permissions: ['status.view'] }],
});

const frozenViewer: ConsolePrincipal = Object.freeze({
  ...statusViewer,
  roles: Object.freeze([]),
  grants: Object.freeze([Object.freeze({ scope: Object.freeze({ kind: 'global' as const }), permissions: Object.freeze(['endpoint.operate']) })]),
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

  it('ADR 0060 §5.4: vouches only for the principal objects it attached itself (deeply frozen), per router', async () => {
    const router = createHttpRouter({ authentication: 'forwarded' });
    const other = createHttpRouter({ authentication: 'forwarded' });
    const seen: unknown[] = [];
    router.route('GET', '/api/system/status', (_request, context) => { seen.push(context.principal); return jsonResponse(200, {}); });
    router.ws('/sandbox').onConnection(connection => { seen.push(connection.principal); });
    other.ws('/sandbox').onConnection(connection => { seen.push(connection.principal); });
    // A principal whose nested parts are mutable is handed on as a deeply frozen copy.
    const mutable = { ...statusViewer, roles: ['viewer'], grants: [{ scope: { kind: 'global' as const }, permissions: ['status.view', 'endpoint.operate'] }] };
    expect((await router.handle(new Request('http://local/api/system/status'), { principal: mutable })).status).toBe(200);
    const transport = { send() {}, close() {}, onMessage: () => () => undefined, onClose: () => () => undefined, bufferedAmount: 0 };
    for (const target of [router, other]) {
      const decision = await target.upgrade({ url: new URL('http://local/sandbox'), headers: new Headers(), principal: mutable });
      expect(decision.accepted).toBe(true);
      if (decision.accepted) decision.accept(transport);
    }
    const [fromRoute, fromSocket, fromOther] = seen as ConsolePrincipal[];
    expect(fromRoute).toEqual(mutable);
    expect(fromRoute).not.toBe(mutable);
    expect(router.isHostIssuedPrincipal(fromRoute)).toBe(true);
    expect(router.isHostIssuedPrincipal(fromSocket)).toBe(true);
    expect(Object.isFrozen(fromRoute) && fromRoute.kind === 'user' && Object.isFrozen(fromRoute.grants[0]!.scope)
      && Object.isFrozen(fromRoute.grants[0]!.permissions)).toBe(true);
    // What the transport passed in, a look-alike plain object, and another router's principal never count.
    expect(router.isHostIssuedPrincipal(mutable)).toBe(false);
    expect(router.isHostIssuedPrincipal(structuredClone(fromRoute))).toBe(false);
    expect(router.isHostIssuedPrincipal({ ...fromRoute })).toBe(false);
    expect(router.isHostIssuedPrincipal(fromOther)).toBe(false);
    expect(other.isHostIssuedPrincipal(fromRoute)).toBe(false);
    expect(router.isHostIssuedPrincipal(undefined)).toBe(false);
    expect(router.isHostIssuedPrincipal('u1')).toBe(false);
    // An already deeply frozen principal is vouched for as is.
    const decision = await router.upgrade({ url: new URL('http://local/sandbox'), headers: new Headers(), principal: frozenViewer });
    if (decision.accepted) decision.accept(transport);
    expect(seen.at(-1)).toBe(frozenViewer);
    expect(router.isHostIssuedPrincipal(frozenViewer)).toBe(true);
    // The plugin-facing generation-bound Host has no such query.
    expect('isHostIssuedPrincipal' in bindGenerationAdmission(router, createGenerationAdmissionGate())).toBe(false);
    router.close();
    other.close();
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
