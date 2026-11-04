import type {
  FeatureId,
  PluginId,
  PreparedGeneration,
  Scope,
  Token,
} from '@zhin.js/plugin-runtime';
import type {
  CapabilityRoot,
  FeatureProvider,
} from '@zhin.js/feature-kit';
import type { GenerationAssets } from './generation-assets.js';
import type { ProjectGraph } from './project-graph.js';
import type { SourceOwnershipIndex } from './source-ownership.js';

export interface RuntimeGenerationModel {
  readonly graph: ProjectGraph;
  readonly providers: ReadonlyMap<FeatureId, FeatureProvider>;
  readonly rootsByFeature: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>;
  readonly featureIdsByPackageRoot: ReadonlyMap<string, FeatureId>;
  readonly scopes: ReadonlyMap<PluginId, Scope>;
  readonly assets: GenerationAssets;
}

/** Sidecar state that must never be observed from a different generation. */
export interface RuntimeGenerationState {
  readonly ownership: SourceOwnershipIndex;
  readonly model?: RuntimeGenerationModel;
  /** Real-token keyed private overrides owned by this generation, never a public snapshot map. */
  readonly rootResources?: ReadonlyMap<Token<unknown>, unknown>;
}

export interface PreparedRuntimeGeneration {
  readonly generation: PreparedGeneration<RuntimeGenerationState>;
}

/** Config-only facades share the existing Scope/projection lifetimes. */
export interface ConfigViewUpdates {
  readonly config: ReadonlyMap<PluginId, unknown>;
  readonly projections: ReadonlyMap<FeatureId, unknown>;
}

export function prepareRuntimeGeneration(
  generation: PreparedGeneration,
  ownership: SourceOwnershipIndex,
  model: RuntimeGenerationModel,
): PreparedRuntimeGeneration {
  return Object.freeze({
    generation: Object.freeze({
      ...generation,
      state: Object.freeze({ ownership, model }),
    }),
  });
}
