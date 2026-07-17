import {
  DisposeStack,
  SharedLifetime,
  type Dispose,
  type PluginId,
} from '@zhin.js/next-kernel';

export class GenerationAssets {
  readonly #scopeLifetimes: ReadonlyMap<PluginId, SharedLifetime>;
  readonly #disposers = new DisposeStack();

  private constructor(
    scopeOrder: readonly PluginId[],
    scopeLifetimes: ReadonlyMap<PluginId, SharedLifetime>,
    projectionDisposers: Iterable<Dispose>,
  ) {
    this.#scopeLifetimes = scopeLifetimes;
    assertScopeOrder(scopeOrder, scopeLifetimes);
    // Scope order is parent-first. DisposeStack unwinds projections first,
    // then Plugin leases children-first, so no child observes a closed parent.
    for (const owner of scopeOrder) {
      const lifetime = scopeLifetimes.get(owner);
      if (!lifetime) throw new Error(`Missing Scope lifetime for ${owner}`);
      const lease = lifetime.acquire();
      this.#disposers.add(() => lease.release());
    }
    for (const dispose of projectionDisposers) this.#disposers.add(dispose);
    this.#disposers.seal();
  }

  static create(
    scopeDisposers: Iterable<readonly [PluginId, Dispose]>,
    projectionDisposers: Iterable<Dispose>,
  ): GenerationAssets {
    const lifetimes = new Map<PluginId, SharedLifetime>();
    for (const [owner, dispose] of scopeDisposers) {
      if (lifetimes.has(owner)) throw new Error(`Duplicate Plugin Scope: ${owner}`);
      lifetimes.set(owner, new SharedLifetime(dispose));
    }
    return new GenerationAssets(
      [...lifetimes.keys()],
      lifetimes,
      projectionDisposers,
    );
  }

  fork(projectionDisposers: Iterable<Dispose>): GenerationAssets {
    return new GenerationAssets(
      [...this.#scopeLifetimes.keys()],
      this.#scopeLifetimes,
      projectionDisposers,
    );
  }

  replaceScopes(
    scopeOrder: readonly PluginId[],
    replacements: ReadonlyMap<PluginId, Dispose>,
    projectionDisposers: Iterable<Dispose>,
  ): GenerationAssets {
    const owners = new Set(scopeOrder);
    for (const owner of replacements.keys()) {
      if (!owners.has(owner)) throw new Error(`Replacement Scope is not mounted: ${owner}`);
    }
    const lifetimes = new Map<PluginId, SharedLifetime>();
    for (const owner of scopeOrder) {
      const replacement = replacements.get(owner);
      const lifetime = replacement
        ? new SharedLifetime(replacement)
        : this.#scopeLifetimes.get(owner);
      if (!lifetime) throw new Error(`Cannot retain unknown Plugin Scope: ${owner}`);
      lifetimes.set(owner, lifetime);
    }
    return new GenerationAssets(scopeOrder, lifetimes, projectionDisposers);
  }

  dispose(): Promise<void> {
    return this.#disposers.dispose();
  }
}

function assertScopeOrder(
  scopeOrder: readonly PluginId[],
  lifetimes: ReadonlyMap<PluginId, SharedLifetime>,
): void {
  const owners = new Set<PluginId>();
  for (const owner of scopeOrder) {
    if (owners.has(owner)) throw new Error(`Duplicate Plugin Scope: ${owner}`);
    if (!lifetimes.has(owner)) throw new Error(`Missing Scope lifetime for ${owner}`);
    owners.add(owner);
  }
  if (owners.size !== lifetimes.size) {
    throw new Error('Scope order does not include every Plugin Scope lifetime');
  }
}
