import type {
  AccessSnapshot,
  LayoutManifest,
  LayoutSlot,
  NavNode,
  PageManifest,
} from '@zhin.js/console-contract';
import type { FeatureId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { LayoutIndex, layoutFeatureId } from '@zhin.js/layout';
import { PageIndex, pageFeatureId } from '@zhin.js/page';
import { allowsPage, createAccessIndex } from './access.js';
import { buildNavigation } from './navigation.js';

export type RouteMatch =
  | { readonly status: 'found'; readonly page: Readonly<PageManifest> }
  | { readonly status: 'forbidden'; readonly page: Readonly<PageManifest> }
  | { readonly status: 'missing' };

export class ConsoleCatalog {
  readonly generation: number;
  readonly #snapshot: RuntimeSnapshot;
  readonly #pages?: PageIndex;
  readonly #layouts?: LayoutIndex;
  readonly #access: ReturnType<typeof createAccessIndex>;
  readonly #active: () => boolean;

  constructor(
    snapshot: RuntimeSnapshot,
    access: AccessSnapshot,
    active: () => boolean = () => true,
  ) {
    this.generation = snapshot.generation;
    this.#snapshot = snapshot;
    this.#pages = projection(snapshot, pageFeatureId, PageIndex);
    this.#layouts = projection(snapshot, layoutFeatureId, LayoutIndex);
    this.#access = createAccessIndex(access);
    this.#active = active;
  }

  pages(): readonly Readonly<PageManifest>[] {
    this.#assertActive();
    return Object.freeze((this.#pages?.list() ?? []).filter((page) => allowsPage(page, this.#access)));
  }

  match(path: string): RouteMatch {
    this.#assertActive();
    const page = this.#pages?.route(path);
    if (!page) return Object.freeze({ status: 'missing' });
    return allowsPage(page, this.#access)
      ? Object.freeze({ status: 'found', page })
      : Object.freeze({ status: 'forbidden', page });
  }

  navigation(): readonly Readonly<NavNode>[] {
    this.#assertActive();
    return buildNavigation(this.#snapshot, this.pages());
  }

  layouts(owner: PluginId, slot: LayoutSlot): readonly Readonly<LayoutManifest>[] {
    this.#assertActive();
    if (!this.#snapshot.tree.has(owner)) throw new Error(`Unknown Layout owner: ${owner}`);
    return this.#layouts?.chain(owner, slot) ?? Object.freeze([]);
  }

  fallback(owner: PluginId): string | undefined {
    this.#assertActive();
    if (!this.#snapshot.tree.has(owner)) throw new Error(`Unknown Page fallback owner: ${owner}`);
    let current: PluginId | undefined = owner;
    while (current) {
      const page = this.#pages?.ownedBy(current).find((candidate) => allowsPage(candidate, this.#access));
      if (page) return page.route;
      current = this.#snapshot.tree.get(current)?.parent;
    }
    return undefined;
  }

  #assertActive(): void {
    if (!this.#active()) throw new Error('Console catalog view scope has ended');
  }
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: FeatureId,
  constructor: { readonly prototype: T },
): T | undefined {
  const value = snapshot.projections.get(id);
  return value
    && typeof value === 'object'
    && Object.prototype.isPrototypeOf.call(constructor.prototype, value)
    ? value as T
    : undefined;
}
