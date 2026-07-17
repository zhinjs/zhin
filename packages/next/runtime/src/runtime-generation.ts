import type {
  FeatureId,
  PluginId,
  PreparedGeneration,
  Scope,
} from '@zhin.js/next-kernel';
import type {
  CapabilityRoot,
  FeatureProvider,
} from '@zhin.js/next-feature-kit';
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

export interface PreparedRuntimeGeneration {
  readonly generation: PreparedGeneration;
  readonly ownership: SourceOwnershipIndex;
  readonly model: RuntimeGenerationModel;
}
