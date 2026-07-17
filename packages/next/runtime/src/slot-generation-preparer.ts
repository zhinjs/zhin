import {
  DisposeStack,
  createSnapshotView,
  type CapabilityId,
  type Dispose,
  type FeatureId,
  type RuntimeSnapshot,
  type SnapshotState,
} from '@zhin.js/next-kernel';
import { FeatureDiscovery } from '@zhin.js/next-feature-kit';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import type {
  PreparedRuntimeGeneration,
  RuntimeGenerationModel,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';

export class SlotGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
  ) {}

  async prepare(
    current: RuntimeSnapshot,
    selected: readonly CapabilityId[],
  ): Promise<PreparedRuntimeGeneration> {
    const selectedByFeature = groupByFeature(current, selected);
    const capabilities = new Map(current.capabilities);
    const discovery = new FeatureDiscovery(new NodeDiscoveryHost(this.modules));
    for (const [feature, ids] of selectedByFeature) {
      const provider = this.model.providers.get(feature);
      if (!provider) throw new Error(`Missing Feature provider for ${feature}`);
      for (const id of ids) capabilities.delete(id);
      const replacements = await discovery.discover(
        provider,
        this.model.rootsByFeature.get(feature) ?? [],
        { capabilities: ids },
      );
      for (const slot of replacements) capabilities.set(slot.id, slot);
    }

    const projections = new Map<FeatureId, unknown>();
    const projectionDisposers: Dispose[] = [];
    const state: SnapshotState = {
      root: current.root,
      tree: current.tree,
      config: current.config,
      resources: current.resources,
      capabilities,
      projections,
    };
    try {
      // Definitions are loaded selectively, but projections are generation
      // views and may capture their snapshot. Rebuild all of them to prevent
      // an unchanged Feature from retaining an older generation implicitly.
      for (const provider of this.model.providers.values()) {
        const slots = [...capabilities.values()].filter(
          (slot) => slot.feature === provider.id,
        );
        const projection = await provider.runtime.project(slots, {
          snapshot: createSnapshotView(current.generation + 1, state),
        });
        projections.set(provider.id, projection.value);
        if (projection.dispose) projectionDisposers.push(projection.dispose);
      }
      const snapshot = createSnapshotView(current.generation + 1, state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.model.graph,
        snapshot,
        this.model.featureIdsByPackageRoot,
      );
      const assets = this.model.assets.fork(projectionDisposers);
      return {
        generation: { snapshot: state, dispose: () => assets.dispose() },
        ownership,
        model: { ...this.model, assets },
      };
    } catch (error) {
      await disposeProjections(projectionDisposers, error);
      throw error;
    }
  }
}

function groupByFeature(
  current: RuntimeSnapshot,
  selected: readonly CapabilityId[],
): ReadonlyMap<FeatureId, ReadonlySet<CapabilityId>> {
  const result = new Map<FeatureId, Set<CapabilityId>>();
  for (const id of selected) {
    const slot = current.capabilities.get(id);
    if (!slot) throw new Error(`Cannot reload missing Capability Slot: ${id}`);
    const ids = result.get(slot.feature) ?? new Set<CapabilityId>();
    ids.add(id);
    result.set(slot.feature, ids);
  }
  return result;
}

async function disposeProjections(
  disposers: readonly Dispose[],
  prepareError: unknown,
): Promise<void> {
  const rollback = new DisposeStack();
  for (const dispose of disposers) rollback.add(dispose);
  try {
    await rollback.dispose();
  } catch (disposeError) {
    throw new AggregateError(
      [prepareError, disposeError],
      'Slot generation prepare and rollback both failed',
      { cause: disposeError },
    );
  }
}
