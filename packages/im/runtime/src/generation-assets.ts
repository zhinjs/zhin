import {
  DisposeStack,
  SharedLifetime,
  type Dispose,
  type FeatureId,
  type PluginId,
} from '@zhin.js/plugin-runtime';

export class GenerationAssets {
  readonly #scopeLifetimes: ReadonlyMap<PluginId, SharedLifetime>;
  // Projection ownership is per Feature, so one command transaction can
  // retire CommandIndex without releasing AdapterIndex and its endpoints.
  readonly #projectionLifetimes: ReadonlyMap<FeatureId, SharedLifetime>;
  readonly #disposers = new DisposeStack();

  private constructor(
    scopeOrder: readonly PluginId[],
    scopeLifetimes: ReadonlyMap<PluginId, SharedLifetime>,
    projectionLifetimes: ReadonlyMap<FeatureId, SharedLifetime>,
  ) {
    this.#scopeLifetimes = scopeLifetimes;
    this.#projectionLifetimes = projectionLifetimes;
    assertScopeOrder(scopeOrder, scopeLifetimes);
    // Scope order is parent-first. DisposeStack unwinds projections first,
    // then Plugin leases children-first, so no child observes a closed parent.
    for (const owner of scopeOrder) {
      const lifetime = scopeLifetimes.get(owner);
      if (!lifetime) throw new Error(`Missing Scope lifetime for ${owner}`);
      const lease = lifetime.acquire();
      this.#disposers.add(() => lease.release());
    }
    for (const lifetime of projectionLifetimes.values()) {
      const lease = lifetime.acquire();
      this.#disposers.add(() => lease.release());
    }
    this.#disposers.seal();
  }

  static create(
    scopeDisposers: Iterable<readonly [PluginId, Dispose]>,
    projectionDisposers: ReadonlyMap<FeatureId, Dispose>,
  ): GenerationAssets {
    const lifetimes = new Map<PluginId, SharedLifetime>();
    for (const [owner, dispose] of scopeDisposers) {
      if (lifetimes.has(owner)) throw new Error(`Duplicate Plugin Scope: ${owner}`);
      lifetimes.set(owner, new SharedLifetime(dispose));
    }
    const projectionLifetimes = new Map(
      [...projectionDisposers].map(([feature, dispose]) => [
        feature,
        new SharedLifetime(dispose),
      ]),
    );
    return new GenerationAssets(
      [...lifetimes.keys()],
      lifetimes,
      projectionLifetimes,
    );
  }

  replaceProjections(
    features: Iterable<FeatureId>,
    projectionDisposers: ReadonlyMap<FeatureId, Dispose>,
  ): GenerationAssets {
    const lifetimes = new Map(this.#projectionLifetimes);
    for (const feature of features) {
      const dispose = projectionDisposers.get(feature);
      if (dispose) lifetimes.set(feature, new SharedLifetime(dispose));
      else lifetimes.delete(feature);
    }
    return new GenerationAssets(
      [...this.#scopeLifetimes.keys()],
      this.#scopeLifetimes,
      lifetimes,
    );
  }

  replaceScopes(
    scopeOrder: readonly PluginId[],
    replacements: ReadonlyMap<PluginId, Dispose>,
    projectionDisposers: ReadonlyMap<FeatureId, Dispose>,
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
    const projectionLifetimes = new Map(
      [...projectionDisposers].map(([feature, dispose]) => [
        feature,
        new SharedLifetime(dispose),
      ]),
    );
    return new GenerationAssets(scopeOrder, lifetimes, projectionLifetimes);
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
