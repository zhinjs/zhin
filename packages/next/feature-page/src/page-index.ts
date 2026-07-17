import {
  pageRoute,
  type PageManifest,
} from '@zhin.js/next-console-contract';
import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { OwnerCapabilityIndex } from '@zhin.js/feature-kit';
import type { PageDefinition } from './definition.js';

export class PageIndex {
  readonly #pages: readonly Readonly<PageManifest>[];
  readonly #byRoute: ReadonlyMap<string, Readonly<PageManifest>>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<PageDefinition>>[],
    snapshot: RuntimeSnapshot,
  ) {
    const index = new OwnerCapabilityIndex(slots, snapshot);
    const byRoute = new Map<string, Readonly<PageManifest>>();
    this.#pages = Object.freeze(index.entries().map((entry) => {
      const route = pageRoute(entry.owner, snapshot.root, entry.name);
      const definition = entry.slot.definition;
      const page = Object.freeze({
        id: entry.slot.id,
        owner: entry.owner,
        localName: entry.name,
        source: entry.source,
        module: definition.module,
        hash: definition.hash,
        route,
        title: definition.title,
        icon: definition.icon,
        order: definition.order,
        hideInNav: definition.hideInNav,
        requiredPermissions: definition.requiredPermissions,
        requiredRoles: definition.requiredRoles,
      });
      if (byRoute.has(route)) throw new Error(`Duplicate Page route: ${route}`);
      byRoute.set(route, page);
      return page;
    }).sort(comparePage));
    this.#byRoute = byRoute;
  }

  list(): readonly Readonly<PageManifest>[] {
    return this.#pages;
  }

  ownedBy(owner: PluginId): readonly Readonly<PageManifest>[] {
    return Object.freeze(this.#pages.filter((page) => page.owner === owner));
  }

  route(path: string): Readonly<PageManifest> | undefined {
    return this.#byRoute.get(path);
  }
}

function comparePage(left: PageManifest, right: PageManifest): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}
