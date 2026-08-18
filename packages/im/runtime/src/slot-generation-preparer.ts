import {
  DisposeStack,
  createSnapshotView,
  type CapabilityId,
  type Dispose,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { FeatureDiscovery } from '@zhin.js/feature-kit';
import { FeatureProjector, composeGenerationHandoffs } from './feature-projector.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import type {
  PreparedRuntimeGeneration,
  RuntimeGenerationModel,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import {
  capabilityDeltaFromSlots,
  type CapabilityDelta,
} from './convention-capability-delta.js';

export class SlotGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
  ) {}

  async prepare(
    current: RuntimeSnapshot,
    selected: readonly CapabilityId[] | CapabilityDelta,
    signal: AbortSignal,
  ): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    const selectedByFeature: CapabilityDelta = Array.isArray(selected)
      ? capabilityDeltaFromSlots(current, selected as readonly CapabilityId[])
      : selected as CapabilityDelta;
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
      signal.throwIfAborted();
      for (const slot of replacements) capabilities.set(slot.id, slot);
    }

    // Capability-file HMR projects only the owning Features. The complete
    // snapshot below is assembled by retaining every other projection.
    const providers = [...selectedByFeature.keys()].map((feature) => {
      const provider = this.model.providers.get(feature);
      if (!provider) throw new Error(`Missing Feature provider for ${feature}`);
      return provider;
    });
    const projected = await new FeatureProjector(providers).project(
      current.generation + 1,
      {
        root: current.root,
        tree: current.tree,
        config: current.config,
        resources: current.resources,
        capabilities,
      },
      signal,
      current.projections,
    );
    try {
      const snapshot = createSnapshotView(current.generation + 1, projected.state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.model.graph,
        snapshot,
        this.model.featureIdsByPackageRoot,
      );
      const assets = this.model.assets.replaceProjections(
        selectedByFeature.keys(),
        projected.disposers,
      );
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
      await disposeProjections(projected.disposers.values(), error);
      throw error;
    }
  }
}

async function disposeProjections(
  disposers: Iterable<Dispose>,
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
