import {
  pageRoute,
  type PageManifest,
} from '@zhin.js/console-contract';
import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { OwnerCapabilityIndex } from '@zhin.js/feature-kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageDefinition } from './definition.js';

export const pageIndexProjection = 'zhin.page-index/1' as const;

export class PageIndex {
  /**
   * Structural brand. Runtime generation imports can load this module more than once,
   * so consumers must not rely on `instanceof` / prototype identity.
   */
  readonly $projection = pageIndexProjection;
  readonly #pages: readonly Readonly<PageManifest>[];
  readonly #byRoute: ReadonlyMap<string, Readonly<PageManifest>>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<PageDefinition>>[],
    snapshot: RuntimeSnapshot,
  ) {
    const index = new OwnerCapabilityIndex(slots, snapshot);
    const byRoute = new Map<string, Readonly<PageManifest>>();
    const descriptions = new Map<string, string | undefined>();
    this.#pages = Object.freeze(index.entries().map((entry) => {
      const route = pageRoute(entry.owner, snapshot.root, entry.name);
      const definition = entry.slot.definition;
      const node = snapshot.tree.get(entry.owner);
      const packageName = node?.packageName;
      const pluginDescription = node ? packageDescription(node.packageRoot, descriptions) : undefined;
      const page = Object.freeze({
        id: entry.slot.id,
        owner: entry.owner,
        localName: entry.name,
        source: entry.source,
        module: definition.module,
        hash: definition.hash,
        route,
        title: definition.title,
        ...(definition.titleI18n === undefined ? {} : { titleI18n: definition.titleI18n }),
        ...(definition.description === undefined ? {} : { description: definition.description }),
        ...(definition.group === undefined ? {} : { group: definition.group }),
        ...(definition.parent === undefined ? {} : { parent: definition.parent }),
        ...(definition.fullWidth === undefined ? {} : { fullWidth: definition.fullWidth }),
        ...(definition.section === undefined ? {} : { section: definition.section }),
        ...(definition.keywords === undefined ? {} : { keywords: definition.keywords }),
        ...(packageName ? { packageName } : {}),
        ...(pluginDescription ? { pluginDescription } : {}),
        icon: definition.icon,
        order: definition.order,
        hideInNav: definition.hideInNav,
        requiredPermissions: definition.requiredPermissions,
        requiredRoles: definition.requiredRoles,
        ...(definition.blueprint !== undefined ? { blueprint: definition.blueprint } : {}),
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

/** `description` of the plugin's package.json, read once per package root for this index. */
function packageDescription(packageRoot: string, cache: Map<string, string | undefined>): string | undefined {
  if (!packageRoot) return undefined;
  if (cache.has(packageRoot)) return cache.get(packageRoot);
  let description: string | undefined;
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { description?: unknown };
    if (typeof manifest.description === 'string' && manifest.description.trim()) description = manifest.description.trim();
  } catch {
    description = undefined;
  }
  cache.set(packageRoot, description);
  return description;
}

function comparePage(left: PageManifest, right: PageManifest): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

/** True for a {@link PageIndex} from any module instance (HMR generation imports included). */
export function isPageIndex(value: unknown): value is PageIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === pageIndexProjection;
}
