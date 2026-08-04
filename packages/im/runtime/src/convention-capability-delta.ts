import { isAbsolute, relative, resolve } from 'node:path';
import { capabilityId, type CapabilityId, type FeatureId, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { type CapabilityRoot, type FeatureProvider } from '@zhin.js/feature-kit';
import type { FallbackInvalidation } from './invalidation-planner.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import type { RuntimeGenerationModel } from './runtime-generation.js';

export type CapabilityDelta = ReadonlyMap<FeatureId, ReadonlySet<CapabilityId>>;

export interface ConventionCapabilityDelta {
  readonly capabilities: CapabilityDelta;
  readonly unresolved: readonly FallbackInvalidation[];
}

/**
 * Resolves unowned filesystem paths through mounted Feature conventions.
 * Conventions are asked to enumerate sources only: definition modules stay
 * untouched until SlotGenerationPreparer commits the selected delta.
 */
export class ConventionCapabilityDeltaResolver {
  readonly #host: NodeDiscoveryHost;

  constructor(
    modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
    private readonly snapshot: RuntimeSnapshot,
  ) {
    this.#host = new NodeDiscoveryHost(modules);
  }

  async resolve(
    fallbacks: readonly FallbackInvalidation[],
    selected: readonly CapabilityId[],
  ): Promise<ConventionCapabilityDelta> {
    const capabilities = new Map<FeatureId, Set<CapabilityId>>();
    const unresolved: FallbackInvalidation[] = [];
    const cache = new Map<string, readonly { readonly source: string; readonly id: CapabilityId }[]>();

    for (const fallback of fallbacks) {
      let claimed = false;
      for (const owner of fallback.owners) {
        for (const [feature, provider] of this.model.providers) {
          const roots = (this.model.rootsByFeature.get(feature) ?? [])
            .filter((root) => root.owner === owner && contains(root.packageRoot, fallback.source));
          for (const root of roots) {
            const discovered = await this.#discover(cache, provider, root);
            for (const candidate of discovered) {
              if (candidate.source !== fallback.source) continue;
              const ids = capabilities.get(feature) ?? new Set<CapabilityId>();
              ids.add(candidate.id);
              capabilities.set(feature, ids);
              claimed = true;
            }
          }
        }
      }
      if (!claimed) unresolved.push(fallback);
    }
    await this.#discoverMoves(cache, capabilities, selected);

    return Object.freeze({
      capabilities: freezeCapabilityDelta(capabilities),
      unresolved: Object.freeze(unresolved),
    });
  }

  async #discoverMoves(
    cache: Map<string, readonly { readonly source: string; readonly id: CapabilityId }[]>,
    capabilities: Map<FeatureId, Set<CapabilityId>>,
    selected: readonly CapabilityId[],
  ): Promise<void> {
    for (const id of selected) {
      const slot = this.snapshot.capabilities.get(id);
      if (!slot || slot.origin === 'setup') continue;
      const provider = this.model.providers.get(slot.feature);
      if (!provider) continue;
      const roots = (this.model.rootsByFeature.get(slot.feature) ?? [])
        .filter((root) => root.owner === slot.owner && contains(root.packageRoot, slot.source));
      for (const root of roots) {
        const discovered = await this.#discover(cache, provider, root);
        if (discovered.some((candidate) => candidate.source === slot.source)) continue;
        for (const candidate of discovered) {
          if (this.snapshot.capabilities.has(candidate.id)) continue;
          const ids = capabilities.get(slot.feature) ?? new Set<CapabilityId>();
          ids.add(candidate.id);
          capabilities.set(slot.feature, ids);
        }
      }
    }
  }

  async #discover(
    cache: Map<string, readonly { readonly source: string; readonly id: CapabilityId }[]>,
    provider: FeatureProvider,
    root: CapabilityRoot,
  ): Promise<readonly { readonly source: string; readonly id: CapabilityId }[]> {
    const key = `${provider.id}\0${root.owner}\0${root.packageRoot}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const discovered: Array<{ readonly source: string; readonly id: CapabilityId }> = [];
    const context = { ...root, host: this.#host };
    for (const convention of provider.authoring.conventions) {
      for await (const source of convention.discover(context)) {
        discovered.push(Object.freeze({
          source: resolve(source.source),
          id: capabilityId(root.owner, provider.id, source.localName),
        }));
      }
    }
    const frozen = Object.freeze(discovered);
    cache.set(key, frozen);
    return frozen;
  }
}

export function capabilityDeltaFromSlots(
  snapshot: RuntimeSnapshot,
  selected: readonly CapabilityId[],
): CapabilityDelta {
  const result = new Map<FeatureId, Set<CapabilityId>>();
  for (const id of selected) {
    const slot = snapshot.capabilities.get(id);
    if (!slot) continue;
    const ids = result.get(slot.feature) ?? new Set<CapabilityId>();
    ids.add(id);
    result.set(slot.feature, ids);
  }
  return freezeCapabilityDelta(result);
}

export function mergeCapabilityDeltas(...deltas: readonly CapabilityDelta[]): CapabilityDelta {
  const result = new Map<FeatureId, Set<CapabilityId>>();
  for (const delta of deltas) {
    for (const [feature, ids] of delta) {
      const merged = result.get(feature) ?? new Set<CapabilityId>();
      for (const id of ids) merged.add(id);
      result.set(feature, merged);
    }
  }
  return freezeCapabilityDelta(result);
}

export function filterCapabilityDelta(
  delta: CapabilityDelta,
  predicate: (owner: PluginId) => boolean,
): CapabilityDelta {
  const result = new Map<FeatureId, Set<CapabilityId>>();
  for (const [feature, ids] of delta) {
    for (const id of ids) {
      if (!predicate(capabilityOwner(id))) continue;
      const filtered = result.get(feature) ?? new Set<CapabilityId>();
      filtered.add(id);
      result.set(feature, filtered);
    }
  }
  return freezeCapabilityDelta(result);
}

export function capabilityDeltaIds(delta: CapabilityDelta): readonly CapabilityId[] {
  return Object.freeze([...delta.values()].flatMap((ids) => [...ids]));
}

export function capabilityOwner(id: CapabilityId): PluginId {
  return id.slice(0, id.indexOf('\0')) as PluginId;
}

function freezeCapabilityDelta(
  delta: ReadonlyMap<FeatureId, ReadonlySet<CapabilityId>>,
): CapabilityDelta {
  return new Map([...delta].map(([feature, ids]) => [feature, new Set(ids)]));
}

function contains(root: string, source: string): boolean {
  const path = relative(root, resolve(source));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
