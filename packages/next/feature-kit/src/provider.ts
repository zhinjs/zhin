import type {
  CapabilitySlot,
  Dispose,
  FeatureId,
  GenerationHandoffParticipant,
  PluginId,
  RuntimeSnapshot,
} from '@zhin.js/next-kernel';

export type SourceTarget = 'server' | 'client';

export interface DiscoveredSource {
  readonly localName: string;
  readonly source: string;
  readonly target: SourceTarget;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface DiscoveryHost {
  list(directory: string): Promise<readonly DirectoryEntry[]>;
  loadModule<T = unknown>(source: string): Promise<T>;
  /** Loads a build artifact for browser code without executing that code in Node. */
  loadClientModule?<T = unknown>(
    source: string,
    request: ClientModuleRequest,
  ): Promise<T>;
  readText(source: string): Promise<string>;
}

export interface ClientModuleRequest {
  readonly feature: FeatureId;
  readonly owner: PluginId;
  readonly localName: string;
}

export interface DiscoveryContext {
  readonly owner: PluginId;
  readonly packageRoot: string;
  readonly host: DiscoveryHost;
}

export interface LoadContext extends DiscoveryContext {}

export interface ValidationContext {
  readonly owner: PluginId;
  readonly feature: FeatureId;
  readonly localName: string;
  readonly source: string;
}

export interface SourceConvention {
  readonly id: string;
  discover(context: DiscoveryContext): AsyncIterable<DiscoveredSource>;
  load(source: DiscoveredSource, context: LoadContext): Promise<unknown>;
}

export interface FeatureAuthoring<TDefinition> {
  readonly conventions: readonly SourceConvention[];
  validate(value: unknown, context: ValidationContext): TDefinition;
}

export interface ProjectionContext {
  readonly snapshot: RuntimeSnapshot;
}

export interface FeatureProjection<T> {
  readonly value: T;
  readonly dispose?: Dispose;
  /** Participates in the generation transaction without opening admission in prepare. */
  readonly handoff?: GenerationHandoffParticipant;
}

export interface FeatureRuntime<TDefinition, TProjection> {
  project(
    slots: readonly Readonly<CapabilitySlot<TDefinition>>[],
    context: ProjectionContext,
  ): FeatureProjection<TProjection> | Promise<FeatureProjection<TProjection>>;
}

export interface FeatureBuildAdapter {
  plan(sources: readonly DiscoveredSource[]): readonly BuildArtifact[];
}

export interface BuildArtifact {
  readonly source: string;
  readonly target: SourceTarget;
  readonly output: string;
}

export interface FeatureProvider<TDefinition = unknown, TProjection = unknown> {
  readonly protocol: 1;
  readonly id: FeatureId;
  readonly authoring: FeatureAuthoring<TDefinition>;
  readonly runtime: FeatureRuntime<TDefinition, TProjection>;
  readonly build?: FeatureBuildAdapter;
}

export function defineFeatureProvider<TDefinition, TProjection>(
  provider: FeatureProvider<TDefinition, TProjection>,
): Readonly<FeatureProvider<TDefinition, TProjection>> {
  if (provider.protocol !== 1) {
    throw new TypeError(`Unsupported Feature provider protocol: ${provider.protocol}`);
  }
  const conventionIds = new Set<string>();
  for (const convention of provider.authoring.conventions) {
    if (conventionIds.has(convention.id)) {
      throw new TypeError(`Duplicate convention ${convention.id} in ${provider.id}`);
    }
    conventionIds.add(convention.id);
  }
  return Object.freeze({
    ...provider,
    authoring: Object.freeze({
      ...provider.authoring,
      conventions: Object.freeze([...provider.authoring.conventions]),
    }),
    runtime: Object.freeze({ ...provider.runtime }),
  });
}
