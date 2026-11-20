import { describe, expect, it, vi } from 'vitest';
import { createIngressRouteFacade, resolveIngressRoute, ingressRouteToken, type IngressRoute } from '../../src/plugin-runtime/im/inbound-spine.js';
import { rootPluginId, type RuntimeSnapshot, type SnapshotLease } from '@zhin.js/plugin-runtime';

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

  it('omits the optional hooks a route does not have, and still resolves as the generation route', () => {
    const route = vi.fn(async () => true);
    const facade = createIngressRouteFacade({ route });
    expect(Reflect.ownKeys(facade)).toEqual(['route']);
    const root = rootPluginId();
    const snapshot = { root, resources: new Map([[root, new Map([[ingressRouteToken.id, facade]])]]) } as unknown as RuntimeSnapshot;
    expect(resolveIngressRoute(snapshot)).toBe(facade);
  });
});
