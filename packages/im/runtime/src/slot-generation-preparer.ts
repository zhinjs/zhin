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
import {
  prepareRuntimeGeneration,
  type PreparedRuntimeGeneration,
  type RuntimeGenerationModel,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import { projectPrimaryConfigResources, type PrimaryConfig } from './primary-config.js';
import {
  capabilityDeltaFromSlots,
  type CapabilityDelta,
} from './convention-capability-delta.js';

export class SlotGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
    private readonly primaryConfig?: PrimaryConfig,
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

    // Snapshot-capturing execution indexes need a current view even when their
    // own definitions were not edited. Retain only explicitly shareable resources.
    const providers = [...this.model.providers.values()].filter((provider) =>
      selectedByFeature.has(provider.id) || provider.runtime.retain !== 'when-owner-unchanged');
    const projectedFeatures = providers.map((provider) => provider.id);
    const projected = await new FeatureProjector(providers, this.model.scopes.get(current.root)).project(
      current.generation + 1,
      {
        root: current.root,
        tree: current.tree,
        config: current.config,
        resources: this.primaryConfig
          ? projectPrimaryConfigResources(current.resources, this.primaryConfig)
          : current.resources,
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
        projectedFeatures,
        projected.disposers,
      );
      return prepareRuntimeGeneration(
        {
          snapshot: projected.state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(projected.handoff),
        },
        ownership,
        { ...this.model, assets },
      );
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
