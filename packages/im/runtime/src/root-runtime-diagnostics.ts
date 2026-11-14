import { resolve } from 'node:path';
import {
  DisposeStack, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type ControlErrorHandler, type Dispose,
  type FeatureId, type HmrEventDetails, type HmrOutcome, type HmrReloadScope,
  type HmrResumeDetails, type PluginId, type PrepareTransaction, type RootController,
  type RuntimeConfigDocument, type RuntimeSnapshot, type SnapshotLease,
  type SnapshotReader, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { FeatureCatalog, FeatureDiscovery, type CapabilityRoot, type FeatureProvider } from '@zhin.js/feature-kit';
import {
  capabilityDeltaFromSlots, capabilityDeltaIds, ConventionCapabilityDeltaResolver,
  filterCapabilityDelta, mergeCapabilityDeltas, type CapabilityDelta,
} from './convention-capability-delta.js';
import type { RuntimeEnvironment } from './environment.js';
import { createEnvStore, type EnvironmentLayers } from './environment-store.js';
import { FeatureProjector, composeGenerationHandoffs, type ProjectionState } from './feature-projector.js';
import { GenerationAssets } from './generation-assets.js';
import type { GenerationInvalidationPlan, ProcessInvalidationPlan } from './invalidation-planner.js';
import type { IsolatedPluginRuntimePort } from './isolation.js';
import type { ZhinFeatureManifest } from './manifest.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import { pluginEventInstances, type PluginEventInstance } from './plugin-events.js';
import { PluginScopeAssembler, type PluginConfigResolver, type RootResourceInstaller } from './plugin-scope-assembler.js';
import { createPrimaryConfig } from './primary-config.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import { RestartBoundaryPlanner } from './restart-boundary.js';
import {
  graphNodes,
  isWithinInvalidationRoot,
  type InspectedProject,
  type RuntimeInputCandidate,
} from './root-runtime-config.js';
import {
  prepareRuntimeGeneration, type PreparedRuntimeGeneration,
  type RuntimeGenerationModel, type RuntimeGenerationState,
} from './runtime-generation.js';
import { addCapabilitySlot, featureSetupAliases, mergeSetupCapabilities } from './setup-capabilities.js';
import { SlotGenerationPreparer } from './slot-generation-preparer.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import { normalizeSourcePath } from './source-path.js';
import { TopologyGenerationPreparer } from './topology-generation-preparer.js';

/** Facts for one existing Controller transaction; does not own commit or rollback. */
export interface ReloadEventRequest {
  readonly target: PluginId | string;
  readonly trigger: HmrEventDetails['trigger'];
  readonly changed: readonly string[];
  readonly planned: HmrReloadScope;
  readonly prepare: PrepareTransaction<RuntimeGenerationState>;
  readonly restartRequired?: () => boolean;
}

export interface ReloadEventHost {
  readonly controller: RootController<RuntimeGenerationState>;
  readonly snapshots: SnapshotReader;
  readonly currentSnapshot: () => RuntimeSnapshot;
  readonly currentModel: () => RuntimeGenerationModel | undefined;
  readonly isStopping: () => boolean;
  readonly onControlError: ControlErrorHandler;
}

/** Hold real old/current instances through notification; the Controller alone publishes candidates. */
export async function executeReloadWithEvents(
  host: ReloadEventHost,
  request: ReloadEventRequest,
): Promise<RuntimeSnapshot> {
  const previous = host.snapshots.acquire();
  const oldInstances = pluginEventInstances(host.currentModel()?.scopes);
  const attempted = new Set<PluginEventInstance>();
  let active: SnapshotLease | undefined;
  let outcome: HmrOutcome = 'rejected';
  const facts = (instance: PluginEventInstance, currentInstances: ReadonlySet<PluginEventInstance>, generation: number): HmrEventDetails => Object.freeze({
    trigger: request.trigger, changed: Object.freeze([...request.changed]),
    planned: Object.freeze({ ...request.planned, plugins: Object.freeze([...request.planned.plugins]), capabilities: Object.freeze([...request.planned.capabilities]) }),
    previousGeneration: previous.value.generation, activeGeneration: generation,
    receiver: Object.freeze({ owner: instance.owner, creationGeneration: instance.creationGeneration,
      state: currentInstances.has(instance) ? 'current' : 'replaced' }),
  });
  try {
    const snapshot = await host.controller.reload(request.target, async (current, signal) => {
      const currentInstances = new Set(oldInstances);
      const results = await Promise.allSettled(oldInstances.map(instance => {
        attempted.add(instance);
        return instance.channel.dispatch('hmr.pause', Object.freeze({ signal, details: facts(instance, currentInstances, current.generation) }));
      }));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Plugin pause handlers rejected reload');
      signal.throwIfAborted();
      const prepared = await request.prepare(current, signal);
      if (!prepared) return undefined;
      const root = current.root;
      const currentState = host.controller.committed.state;
      const sameOwner = currentState.model?.scopes.get(root) === prepared.state.model?.scopes.get(root);
      return sameOwner && currentState.rootResources?.size
        ? { ...prepared, state: { ...prepared.state,
          rootResources: new Map([...currentState.rootResources, ...(prepared.state.rootResources ?? [])]) } }
        : prepared;
    });
    outcome = request.restartRequired?.() ? 'restart-required'
      : snapshot.generation === previous.value.generation ? 'unchanged' : 'committed';
    return snapshot;
  } catch (error) {
    outcome = host.isStopping() ? 'cancelled' : 'rejected';
    throw error;
  } finally {
    // Acquire before another await: retirement may proceed, but these instances must survive notification.
    try { active = host.snapshots.acquire(); } catch { if (host.isStopping()) outcome = 'cancelled'; }
    const current = new Set(pluginEventInstances(host.currentModel()?.scopes));
    const recipients = new Set([...attempted, ...(active ? current : [])]);
    const replaced = Object.freeze(oldInstances.filter(instance => !current.has(instance)).map(instance => instance.owner));
    const results = await Promise.allSettled([...recipients].map(instance => {
      const details: HmrResumeDetails = Object.freeze({
        ...facts(instance, current, active?.value.generation ?? host.currentSnapshot().generation),
        outcome, replaced, ...(!active && host.isStopping() ? { reason: 'root-stopping' as const } : {}),
      });
      return instance.channel.dispatch('hmr.resume', Object.freeze({ signal: previous.stopSignal, details }));
    }));
    for (const result of results) if (result.status === 'rejected') {
      try { host.onControlError(result.reason); } catch { /* Diagnostics cannot reverse a committed transaction. */ }
    }
    active?.release();
    previous.release();
  }
}

export async function resolveCapabilityDelta(
  modules: ModuleRuntime,
  model: RuntimeGenerationModel | undefined,
  current: RuntimeSnapshot,
  plan: GenerationInvalidationPlan,
): Promise<{ readonly plan: GenerationInvalidationPlan; readonly capabilities: CapabilityDelta }> {
  const known = capabilityDeltaFromSlots(current, plan.slots);
  if (!model || (plan.fallbacks.length === 0 && plan.slots.length === 0)) {
    return { plan, capabilities: known };
  }
  const discovered = await new ConventionCapabilityDeltaResolver(modules, model, current).resolve(plan.fallbacks, plan.slots);
  const subtrees = collapseInvalidationSubtrees([
    ...plan.subtrees,
    ...discovered.unresolved.flatMap((fallback) => fallback.owners),
  ]);
  const capabilities = filterCapabilityDelta(
    mergeCapabilityDeltas(known, discovered.capabilities),
    (owner) => !subtrees.some((root) => isWithinInvalidationRoot(owner, root)),
  );
  const effective = Object.freeze({
    ...plan,
    slots: capabilityDeltaIds(capabilities),
    subtrees,
    fallbacks: Object.freeze([]),
  });
  return { plan: effective, capabilities };
}

export function canPrepareSubtrees(
  plan: GenerationInvalidationPlan,
  runtimeInputSources: ReadonlySet<string>,
  sourceOwnership: SourceOwnershipIndex,
): boolean {
  if (plan.subtrees.length === 0 || plan.subtrees.includes(rootPluginId())) return false;
  return plan.changed.every((source) => {
    if (runtimeInputSources.has(normalizeSourcePath(source))) return true;
    const records = sourceOwnership.recordsFor(source);
    return records.length > 0 && records.every((record) => record.role === 'plugin' || record.role === 'schema');
  });
}

export interface PrepareInvalidatedGenerationContext {
  readonly modules: ModuleRuntime;
  readonly model?: RuntimeGenerationModel;
  readonly environment: RuntimeEnvironment;
  readonly installResources?: RootResourceInstaller;
  readonly isolation?: IsolatedPluginRuntimePort;
  readonly runtimeInputSources: ReadonlySet<string>;
  readonly sourceOwnership: SourceOwnershipIndex;
  readonly inspectProject: (document?: RuntimeConfigDocument, environmentLayers?: Readonly<EnvironmentLayers>) => Promise<InspectedProject>;
  readonly prepareFull: (current: RuntimeSnapshot, signal: AbortSignal, document?: RuntimeConfigDocument, environmentLayers?: Readonly<EnvironmentLayers>) => Promise<PreparedRuntimeGeneration>;
  readonly prepareInspected: (current: RuntimeSnapshot, inspected: InspectedProject, signal: AbortSignal) => Promise<PreparedRuntimeGeneration>;
  readonly prepareSubtrees: (current: RuntimeSnapshot, inspected: InspectedProject, roots: readonly PluginId[], signal: AbortSignal, configUpdates?: RuntimeInputCandidate['configUpdates']) => Promise<PreparedRuntimeGeneration>;
}

export async function prepareInvalidatedGeneration(
  ctx: PrepareInvalidatedGenerationContext,
  current: RuntimeSnapshot,
  signal: AbortSignal,
  plan: GenerationInvalidationPlan,
  inputs: RuntimeInputCandidate | undefined,
): Promise<{ prepared?: PreparedRuntimeGeneration; restart?: ProcessInvalidationPlan; rebuild?: PreparedRebuild }> {
  const effectiveInputPlan = inputs
    ? Object.freeze({
        ...plan,
        subtrees: collapseInvalidationSubtrees([...plan.subtrees, ...inputs.roots]),
        fallbacks: Object.freeze(plan.fallbacks.filter(fallback => !inputs.inputSources.has(normalizeSourcePath(fallback.source)))),
      })
    : plan;
  const resolved = await resolveCapabilityDelta(ctx.modules, ctx.model, current, effectiveInputPlan);
  const effective = resolved.plan;
  if (
    inputs && effective.manifestSources.length === 0 && effective.subtrees.length === 0
    && effective.slots.length === 0 && resolved.capabilities.size === 0
    && !inputs.topologyChanged && !inputs.primaryConfigChanged
  ) return {};
  if (ctx.model && (effective.manifestSources.length > 0 || inputs?.topologyChanged)) {
    const inspected = inputs?.inspected ?? await ctx.inspectProject(inputs?.document, inputs?.environmentLayers);
    const restart = new RestartBoundaryPlanner().plan(ctx.model.graph, inspected.graph, effective.changed);
    if (restart) return { restart };
    if (effective.subtrees.includes(rootPluginId())) {
      return {
        prepared: await ctx.prepareInspected(current, inspected, signal),
        rebuild: { rebuilt: 'root', reason: rootFallbackReason(ctx, effective) },
      };
    }
    const prepared = await new TopologyGenerationPreparer(
      ctx.modules, ctx.model, inspected.graph, inspected.configResolver, inspected.primaryConfigDocument,
      ctx.environment, ctx.installResources, inspected.environmentLayers, ctx.isolation, inputs?.configUpdates,
    ).prepare(current, signal, { ...effective, capabilities: resolved.capabilities });
    return { prepared, rebuild: { rebuilt: 'subtree' } };
  }
  if (effective.subtrees.length === 0 && resolved.capabilities.size > 0 && ctx.model) {
    const primary = inputs?.primaryConfigChanged
      ? createPrimaryConfig(inputs.inspected.primaryConfigDocument,
        createEnvStore(rootPluginId(), ctx.environment, inputs.environmentLayers), inputs.inspected.configResolver.compositionMode)
      : undefined;
    const prepared = await new SlotGenerationPreparer(ctx.modules, ctx.model, primary, inputs?.configUpdates)
      .prepare(current, resolved.capabilities, signal);
    return { prepared, rebuild: { rebuilt: 'capability', capabilities: capabilityDeltaIds(resolved.capabilities) } };
  }
  if (ctx.model && canPrepareSubtrees(effective, ctx.runtimeInputSources, ctx.sourceOwnership)) {
    const inspected = inputs?.inspected ?? await ctx.inspectProject(inputs?.document, inputs?.environmentLayers);
    return {
      prepared: await ctx.prepareSubtrees(current, inspected, effective.subtrees, signal, inputs?.configUpdates),
      rebuild: { rebuilt: 'subtree' },
    };
  }
  if (ctx.model && inputs?.primaryConfigChanged && effective.subtrees.length === 0 && resolved.capabilities.size === 0) {
    return {
      prepared: await ctx.prepareSubtrees(current, inputs.inspected, [], signal, inputs.configUpdates),
      rebuild: { rebuilt: 'subtree' },
    };
  }
  return {
    prepared: await ctx.prepareFull(current, signal, inputs?.document, inputs?.environmentLayers),
    rebuild: { rebuilt: 'root', reason: rootFallbackReason(ctx, effective) },
  };
}

/** Which preparation path a source reload took (#1250: `hmr_reload` reports it, not the plan). */
export type HmrRebuildKind = 'root' | 'subtree' | 'capability';

export interface PreparedRebuild {
  readonly rebuilt: HmrRebuildKind;
  /** Replaced capability slots (`capability` path). */
  readonly capabilities?: readonly CapabilityId[];
  /** Why the whole Root generation was rebuilt (`root` path). */
  readonly reason?: string;
}

/**
 * Explains a whole-Root rebuild in terms of the changed sources, without changing the choice
 * (the scope algorithm itself is unchanged; see #1250 `hmr-multi-change-full-rebuild`).
 */
function rootFallbackReason(ctx: PrepareInvalidatedGenerationContext, plan: GenerationInvalidationPlan): string {
  if (!ctx.model) return 'no committed generation to reload against';
  const root = rootPluginId();
  if (plan.subtrees.includes(root)) {
    if (plan.manifestSources.some((source) => ctx.sourceOwnership.recordsFor(source).some((record) => record.owner === root))) {
      return 'the Root Plugin manifest changed';
    }
    const unresolved = plan.changed.filter((source) => (
      !ctx.runtimeInputSources.has(normalizeSourcePath(source))
      && ctx.sourceOwnership.ownersForPath(source).includes(root)
      && !ctx.sourceOwnership.recordsFor(source).some((record) => record.role === 'capability')
    ));
    return unresolved.length > 0
      ? `changed Root Plugin files are not a convention capability: ${unresolved.join(', ')}`
      : 'the Root Plugin is in the invalidated subtrees';
  }
  const unsupported = plan.changed.filter((source) => {
    if (ctx.runtimeInputSources.has(normalizeSourcePath(source))) return false;
    const records = ctx.sourceOwnership.recordsFor(source);
    return records.length === 0 || !records.every((record) => record.role === 'plugin' || record.role === 'schema');
  });
  return unsupported.length > 0
    ? `a subtree reload only covers Plugin entry / schema changes; other changed sources: ${unsupported.join(', ')}`
    : 'no narrower reload path applies to this change set';
}

export function collapseInvalidationSubtrees(values: readonly PluginId[]): readonly PluginId[] {
  const sorted = [...new Set(values)].sort((left, right) => left.length - right.length);
  return Object.freeze(sorted.filter((candidate, index) =>
    !sorted.slice(0, index).some((root) => isWithinInvalidationRoot(candidate, root)),
  ));
}

export { graphNodes, isWithinInvalidationRoot };

export class GenerationAssembler {
  readonly #capabilities = new Map<CapabilityId, CapabilitySlot>();
  readonly #catalog = new FeatureCatalog();
  readonly #rootsByFeature = new Map<FeatureId, CapabilityRoot[]>();
  readonly #featureIdsByPackageRoot = new Map<string, FeatureId>();
  readonly #projectionDisposers = new Map<FeatureId, Dispose>();
  readonly #host: NodeDiscoveryHost;
  readonly #plugins: PluginScopeAssembler;

  constructor(
    private readonly graph: ProjectGraph,
    private readonly modules: ModuleRuntime,
    configResolver: PluginConfigResolver,
    primaryConfigDocument: RuntimeConfigDocument,
    private readonly generation: number,
    environment: RuntimeEnvironment,
    installResources?: RootResourceInstaller,
    environmentLayers: EnvironmentLayers = {},
    isolation?: IsolatedPluginRuntimePort,
  ) {
    this.#host = new NodeDiscoveryHost(modules);
    this.#plugins = new PluginScopeAssembler(
      modules, configResolver, environment, primaryConfigDocument,
      generation, installResources, environmentLayers, undefined, isolation,
    );
  }

  async prepare(signal: AbortSignal): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    try {
      await this.#loadProviders(this.graph.root, signal);
      this.#plugins.installSetupFeatureAliases(featureSetupAliases(this.#catalog.values()), this.#rootsByFeature);
      await this.#plugins.setupTree(this.graph.root, signal);
      await this.#discover(signal);
      const projected = await new FeatureProjector(this.#catalog.values(), this.#plugins.scopes.get(this.graph.root.id))
        .project(this.generation, this.#projectionState(), signal);
      for (const [feature, dispose] of projected.disposers) this.#projectionDisposers.set(feature, dispose);
      const state = projected.state;
      const snapshot = createSnapshotView(this.generation, state);
      this.#plugins.bindCandidateSnapshot(snapshot);
      const ownership = SourceOwnershipIndex.fromGeneration(this.graph, snapshot, this.#featureIdsByPackageRoot);
      const assets = GenerationAssets.create(this.#plugins.createdScopeDisposers(), this.#projectionDisposers);
      return prepareRuntimeGeneration(
        {
          snapshot: state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(this.#plugins.generationHandoff(), projected.handoff),
        },
        ownership,
        {
          graph: this.graph,
          providers: new Map(this.#catalog.values().map((provider) => [provider.id, provider])),
          rootsByFeature: new Map([...this.#rootsByFeature].map(([feature, roots]) => [feature, Object.freeze([...roots])])),
          featureIdsByPackageRoot: new Map(this.#featureIdsByPackageRoot),
          scopes: new Map(this.#plugins.scopes),
          assets,
        },
      );
    } catch (error) {
      await disposePreparedParts(
        this.#plugins.createdScopeDisposers().map(([, dispose]) => dispose),
        [...this.#projectionDisposers.values()],
        error,
      );
      throw error;
    }
  }

  async #loadProviders(node: PluginGraphNode, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    for (const requirement of node.features) {
      const manifest = requirement.package.packageJson.zhin as ZhinFeatureManifest;
      const module = await this.modules.load<ModuleNamespace>(resolve(requirement.package.root, manifest.entry));
      signal.throwIfAborted();
      const provider = module.default as FeatureProvider | undefined;
      if (!provider || provider.protocol !== 1) {
        throw new TypeError(`${requirement.package.name} does not default-export a Feature provider`);
      }
      this.#catalog.add(provider);
      const packageRoot = resolve(requirement.package.root);
      const existingFeature = this.#featureIdsByPackageRoot.get(packageRoot);
      if (existingFeature && existingFeature !== provider.id) {
        throw new Error(`Feature package ${requirement.package.name} changed identity within one generation`);
      }
      this.#featureIdsByPackageRoot.set(packageRoot, provider.id);
      const roots = this.#rootsByFeature.get(provider.id) ?? [];
      roots.push({ owner: node.id, packageRoot: node.package.root });
      this.#rootsByFeature.set(provider.id, roots);
    }
    for (const child of node.children) await this.#loadProviders(child, signal);
  }

  async #discover(signal: AbortSignal): Promise<void> {
    mergeSetupCapabilities(
      this.#capabilities,
      this.#plugins.setupCapabilities(),
      new Map(this.#catalog.values().map((provider) => [provider.id, provider])),
      this.#rootsByFeature,
    );
    const discovery = new FeatureDiscovery(this.#host);
    for (const provider of this.#catalog.values()) {
      signal.throwIfAborted();
      const roots = this.#rootsByFeature.get(provider.id) ?? [];
      const slots = await discovery.discover(provider, roots);
      signal.throwIfAborted();
      for (const slot of slots) addCapabilitySlot(this.#capabilities, slot);
    }
  }

  #projectionState(): ProjectionState {
    return {
      root: rootPluginId(),
      tree: this.#plugins.tree,
      config: this.#plugins.config,
      resources: this.#plugins.resources,
      capabilities: this.#capabilities,
    };
  }
}

interface ModuleNamespace {
  readonly default?: unknown;
}

export function emptyState(): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}

export function isProcessPlan<T extends object>(value: T | ProcessInvalidationPlan): value is ProcessInvalidationPlan {
  return 'kind' in value && value.kind === 'process';
}

/** What a committed source reload actually rebuilt (#1250). */
export interface HmrReloadReport {
  readonly kind: 'reloaded';
  readonly rebuilt: HmrRebuildKind;
  /**
   * Plugins whose Scope was set up again (replaced, added or removed) — adapters and their
   * Endpoints included. Empty for a pure capability swap.
   */
  readonly plugins: readonly PluginId[];
  readonly capabilities: readonly CapabilityId[];
  /** Why the whole Root generation was rebuilt (`rebuilt: 'root'`). */
  readonly reason?: string;
}

export function describeHmrReload(
  rebuild: PreparedRebuild,
  previous: ReadonlyMap<PluginId, unknown> | undefined,
  next: ReadonlyMap<PluginId, unknown> | undefined,
): HmrReloadReport {
  const plugins = new Set<PluginId>();
  for (const [id, scope] of next ?? []) if (previous?.get(id) !== scope) plugins.add(id);
  for (const id of previous?.keys() ?? []) if (!next?.has(id)) plugins.add(id);
  return Object.freeze({
    kind: 'reloaded',
    rebuilt: rebuild.rebuilt,
    plugins: Object.freeze([...plugins].sort()),
    capabilities: Object.freeze([...(rebuild.capabilities ?? [])]),
    ...(rebuild.reason ? { reason: rebuild.reason } : {}),
  });
}

export async function disposePreparedParts(
  scopeDisposers: readonly Dispose[],
  projectionDisposers: readonly Dispose[],
  prepareError?: unknown,
): Promise<void> {
  const rollback = new DisposeStack();
  for (const dispose of scopeDisposers) rollback.add(dispose);
  for (const dispose of projectionDisposers) rollback.add(dispose);
  try {
    await rollback.dispose();
  } catch (disposeError) {
    if (prepareError !== undefined) {
      throw new AggregateError([prepareError, disposeError], 'Generation prepare and rollback both failed', { cause: disposeError });
    }
    throw disposeError;
  }
}
