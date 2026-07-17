import {
  DisposeStack,
  createSnapshotView,
  type CapabilityId,
  type Dispose,
  type FeatureId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import { FeatureDiscovery } from '@zhin.js/next-feature-kit';
import { FeatureProjector, composeGenerationHandoffs } from './feature-projector.js';
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

    const projected = await new FeatureProjector(this.model.providers.values()).project(
      current.generation + 1,
      {
        root: current.root,
        tree: current.tree,
        config: current.config,
        resources: current.resources,
        capabilities,
      },
    );
    try {
      const snapshot = createSnapshotView(current.generation + 1, projected.state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.model.graph,
        snapshot,
        this.model.featureIdsByPackageRoot,
      );
      const assets = this.model.assets.fork(projected.disposers);
      return {
        generation: {
          snapshot: projected.state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(projected.handoff),
        },
        ownership,
        model: { ...this.model, assets },
      };
    } catch (error) {
      await disposeProjections(projected.disposers, error);
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
