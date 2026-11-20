import { describe, expect, it, vi } from 'vitest';
import { createIngressRouteFacade, resolveIngressRoute, ingressRouteToken, type IngressRoute } from '../../src/plugin-runtime/im/inbound-spine.js';
import { Scope, SnapshotStore, childPluginId, createToken, rootPluginId, type SnapshotLease, type SnapshotState } from '@zhin.js/plugin-runtime';

/**
 * zhinjs/zhin#1250 第 85 批: `ingressRouteToken` is readable from plugin scopes, so it carries only the
 * hooks the IM runtime calls, bound to the route; nothing else of the route object is reachable.
 */
describe('createIngressRouteFacade', () => {
  class Route implements IngressRoute {
    // A TS-private field: reachable at run time on the route object itself.
    private readonly secret = { snapshots: { acquire: () => 'a real lease' } };
    readonly seen: unknown[][] = [];
    async preRoute(...args: unknown[]) { this.seen.push(['pre', ...args]); return false; }
    shouldRouteBeforeDispatch() { return this.secret !== undefined; }
    async route(...args: unknown[]) { this.seen.push(['route', ...args]); return true; }
    managementOnly() { return this.secret; }
  }

  it('exposes exactly the IM runtime hooks, bound to the route, and nothing else', async () => {
    const route = new Route();
    const facade = createIngressRouteFacade(route) as unknown as Record<PropertyKey, unknown>;
    expect(Object.isFrozen(facade)).toBe(true);
    expect(Object.getPrototypeOf(facade)).toBe(Object.prototype);
    expect(Reflect.ownKeys(facade).sort()).toEqual(['preRoute', 'route', 'shouldRouteBeforeDispatch']);
    expect(facade.secret).toBeUndefined();
    expect(facade.managementOnly).toBeUndefined();
    const lease = {} as SnapshotLease;
    const message = { id: 'm' };
    const typed = facade as unknown as IngressRoute;
    await expect(typed.preRoute!(message as never, lease, rootPluginId(), 3)).resolves.toBe(false);
    expect(typed.shouldRouteBeforeDispatch!(message as never)).toBe(true);
    await expect(typed.route(message as never, lease, rootPluginId(), undefined)).resolves.toBe(true);
    expect(route.seen).toEqual([['pre', message, lease, rootPluginId(), 3], ['route', message, lease, rootPluginId(), undefined]]);
  });

  it('omits the optional hooks a route does not have, and still resolves as the generation route', async () => {
    const route = vi.fn(async () => true);
    const facade = createIngressRouteFacade({ route });
    expect(Reflect.ownKeys(facade)).toEqual(['route']);
    const root = rootPluginId();
    const rootScope = new Scope(root);
    rootScope.provide(ingressRouteToken, facade);
    rootScope.seal();
    // The run-time snapshot is assembled from the Root Scope's public resources, as the assembler does.
    const state = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
      config: new Map(), resources: new Map([[root, rootScope.snapshot()]]), capabilities: new Map(), projections: new Map() } as unknown as SnapshotState;
    const store = new SnapshotStore(state, undefined, undefined, (_state, _root, token) => rootScope.has(token) ? rootScope.use(token) : undefined);
    const lease = store.acquire();
    try {
      expect(resolveIngressRoute(store, lease)).toBe(facade);
    } finally { lease.release(); await store.close(); }
  });
});

/**
 * zhinjs/zhin#1250 第 85 批: `ingressRouteToken` is Root-private. A plugin scope cannot read it (neither
 * by the token nor by a look-alike token with the same id), and the run-time snapshot's public
 * resources do not carry it; only the Root's real SnapshotStore resolves it for a lease it owns.
 */
describe('ingressRouteToken is Root-private', () => {
  it('cannot be read from a plugin scope or the public snapshot, only through the Root store', async () => {
    const route = vi.fn(async () => true);
    const facade = createIngressRouteFacade({ route });
    const root = rootPluginId();
    const rootScope = new Scope(root);
    rootScope.provide(ingressRouteToken, facade);
    const plugin = new Scope(childPluginId(root, 'some-plugin'), rootScope);
    expect(plugin.has(ingressRouteToken)).toBe(false);
    expect(() => plugin.use(ingressRouteToken)).toThrow('Missing resource zhin.im.ingress-route');
    expect(plugin.get(ingressRouteToken)).toBeUndefined();
    const lookalike = createToken<IngressRoute>('zhin.im.ingress-route');
    expect(plugin.has(lookalike)).toBe(false);
    expect(rootScope.has(lookalike)).toBe(false);
    // The Root scope that provided it reads it back.
    expect(rootScope.use(ingressRouteToken)).toBe(facade);
    rootScope.seal();
    plugin.seal();
    expect(rootScope.snapshot().has(ingressRouteToken.id)).toBe(false);
    expect(plugin.snapshot().has(ingressRouteToken.id)).toBe(false);

    const state = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
      config: new Map(), resources: new Map([[root, rootScope.snapshot()]]), capabilities: new Map(), projections: new Map() } as unknown as SnapshotState;
    const store = new SnapshotStore(state, undefined, undefined, (_state, _root, token) => rootScope.has(token) ? rootScope.use(token) : undefined);
    const other = new SnapshotStore(state);
    const lease = store.acquire();
    const foreign = other.acquire();
    try {
      expect(lease.value.resources.get(root)?.has(ingressRouteToken.id)).toBe(false);
      expect(resolveIngressRoute(store, lease)).toBe(facade);
      // A lease the store did not issue (a look-alike, another Root's) reads nothing.
      expect(() => resolveIngressRoute(store, { value: lease.value, active: true, release() {} } as unknown as SnapshotLease)).toThrow();
      expect(() => resolveIngressRoute(store, foreign)).toThrow();
    } finally {
      lease.release();
      foreign.release();
      await store.close();
      await other.close();
    }
  });
});
