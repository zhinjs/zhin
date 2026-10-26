import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  DisposeStack,
  createSnapshotView,
  type CapabilityId,
  type CapabilitySlot,
  type Dispose,
  type FeatureId,
  type PluginId,
  type RuntimeSnapshot,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import {
  FeatureCatalog,
  FeatureDiscovery,
  type CapabilityRoot,
  type FeatureProvider,
} from '@zhin.js/feature-kit';
import type { RuntimeEnvironment } from './environment.js';
import type { EnvironmentLayers } from './environment-store.js';
import { FeatureProjector, composeGenerationHandoffs } from './feature-projector.js';
import type { IsolatedPluginRuntimePort } from './isolation.js';
import type { ZhinFeatureManifest } from './manifest.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import {
  PluginScopeAssembler,
  type PluginConfigResolver,
  type RootResourceInstaller,
} from './plugin-scope-assembler.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import {
  prepareRuntimeGeneration,
  type PreparedRuntimeGeneration,
  type RuntimeGenerationModel,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import {
  capabilityDeltaFromSlots,
  capabilityDeltaIds,
  type CapabilityDelta,
} from './convention-capability-delta.js';
import {
  addCapabilitySlot,
  featureSetupAliases,
  mergeSetupCapabilities,
} from './setup-capabilities.js';
import {
  TopologyTransactionPlanner,
  collapseRoots,
  graphNodes,
  graphOrder,
  isWithin,
  type FeatureMount,
  type TopologyTransactionPlan,
} from './topology-transaction.js';

interface FeatureTopology {
  readonly providers: ReadonlyMap<FeatureId, FeatureProvider>;
  readonly rootsByFeature: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>;
  readonly featureIdsByPackageRoot: ReadonlyMap<string, FeatureId>;
}

/** Runtime-local invalidation to commit alongside an ABI-safe manifest change. */
export interface TopologyRuntimeDelta {
  readonly slots: readonly CapabilityId[];
  readonly subtrees: readonly PluginId[];
  readonly capabilities?: CapabilityDelta;
}

/** Prepares manifest topology changes without rebuilding stable Plugin Scopes. */
export class TopologyGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
    private readonly graph: ProjectGraph,
    private readonly configResolver: PluginConfigResolver,
    private readonly primaryConfigDocument: RuntimeConfigDocument,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
    private readonly environmentLayers: EnvironmentLayers = {},
    private readonly isolation?: IsolatedPluginRuntimePort,
  ) {}

  async prepare(
    current: RuntimeSnapshot,
    signal: AbortSignal,
    delta: TopologyRuntimeDelta = { slots: [], subtrees: [] },
  ): Promise<PreparedRuntimeGeneration | undefined> {
    signal.throwIfAborted();
    const planned = new TopologyTransactionPlanner().plan(this.model.graph, this.graph);
    const nextNodes = graphNodes(this.graph);
    const configReplacements = changedConfigRoots(current, nextNodes, this.configResolver);
    const replacedPluginRoots = collapseRoots([
      ...planned.replacedPluginRoots,
      ...configReplacements,
    ]);
    const initialPlan = withReplacements(planned, replacedPluginRoots);
    const subtreeRoots = collapseRoots(delta.subtrees);
    const selected = delta.capabilities ?? capabilityDeltaFromSlots(current, delta.slots);
    if (!initialPlan.changed && subtreeRoots.length === 0 && selected.size === 0) return undefined;

    const featureTopology = await this.#loadFeatureTopology(initialPlan);
    // Root installers can branch on their mounted Features. Changing that
    // contract must rebuild the Root's setup resources and capabilities as one
    // normal replacement, instead of keeping the previous installation alive.
    const plan = this.installResources && !sameMountedFeatures(
      current.root, this.model.rootsByFeature, featureTopology.rootsByFeature,
    ) ? withReplacements(initialPlan, [current.root]) : initialPlan;
    const plugins = new PluginScopeAssembler(
      this.modules,
      this.configResolver,
      this.environment,
      this.primaryConfigDocument,
      current.generation + 1,
      this.installResources,
      this.environmentLayers,
      {
        scopes: this.model.scopes,
        tree: current.tree,
        config: current.config,
        resources: current.resources,
      },
      this.isolation,
    );
    plugins.installSetupFeatureAliases(featureSetupAliases(featureTopology.providers.values()), featureTopology.rootsByFeature);
    const setupRoots = collapseRoots([
      ...plan.addedPluginRoots,
      ...plan.replacedPluginRoots,
      ...subtreeRoots,
    ]);
    const removalRoots = collapseRoots([
      ...plan.removedPluginRoots,
      ...plan.replacedPluginRoots,
      ...subtreeRoots,
    ]);
    plugins.removeSubtrees(removalRoots);

    const projectionDisposers = new Map<FeatureId, Dispose>();
    try {
      for (const root of setupRoots) {
        const node = nextNodes.get(root);
        if (!node) throw new Error(`Missing topology setup root: ${root}`);
        await plugins.setupTree(node, signal);
      }
      // Retained parents still need a new immutable children view after add,
      // remove, move, or reorder operations.
      plugins.synchronizeTree(this.graph.root);

      const capabilities = await this.#prepareCapabilities(
        current,
        plan,
        setupRoots,
        featureTopology,
        selected,
      );
      mergeSetupCapabilities(
        capabilities,
        plugins.setupCapabilities(),
        featureTopology.providers,
        featureTopology.rootsByFeature,
      );
      const providers = [...featureTopology.providers.values()].filter(provider =>
        provider.runtime.retain !== 'when-owner-unchanged'
        || this.model.providers.get(provider.id) !== provider
        || !current.projections.has(provider.id)
        || !sameFeatureOwners(
          this.model.rootsByFeature.get(provider.id) ?? [],
          featureTopology.rootsByFeature.get(provider.id) ?? [],
          this.model.scopes,
          plugins.scopes,
        )
        || !sameFeatureSlots(provider.id, current.capabilities, capabilities));
      const retained = new Map([...current.projections].filter(([id]) => featureTopology.providers.has(id)));
      const projected = await new FeatureProjector(providers).project(
        current.generation + 1,
        {
          root: current.root,
          tree: plugins.tree,
          config: plugins.config,
          resources: plugins.resources,
          capabilities,
        },
        signal,
        retained,
      );
      for (const [feature, dispose] of projected.disposers) {
        projectionDisposers.set(feature, dispose);
      }

      const snapshot = createSnapshotView(current.generation + 1, projected.state);
      plugins.bindCandidateSnapshot(snapshot);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.graph,
        snapshot,
        featureTopology.featureIdsByPackageRoot,
      );
      const replacements = new Map(plugins.createdScopeDisposers());
      const assets = this.model.assets.replaceScopes(
        graphOrder(this.graph),
        replacements,
        new Set([
          ...providers.map(provider => provider.id),
          ...[...this.model.providers.keys()].filter(id => !featureTopology.providers.has(id)),
        ]),
        projectionDisposers,
      );
      return prepareRuntimeGeneration(
        {
          snapshot: projected.state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(
            plugins.generationHandoff(),
            projected.handoff,
          ),
        },
        ownership,
        {
          graph: this.graph,
          providers: featureTopology.providers,
          rootsByFeature: featureTopology.rootsByFeature,
          featureIdsByPackageRoot: featureTopology.featureIdsByPackageRoot,
          scopes: new Map(plugins.scopes),
          assets,
        },
      );
    } catch (error) {
      await rollback(
        plugins.createdScopeDisposers().map(([, dispose]) => dispose),
        [...projectionDisposers.values()],
        error,
      );
      throw error;
    }
  }

  async #loadFeatureTopology(plan: TopologyTransactionPlan): Promise<FeatureTopology> {
    const catalog = new FeatureCatalog();
    const providers = new Map<FeatureId, FeatureProvider>();
    const rootsByFeature = new Map<FeatureId, CapabilityRoot[]>();
    const featureIdsByPackageRoot = new Map<string, FeatureId>();
    const loadedByPackageRoot = new Map<string, FeatureProvider>();

    for (const node of graphNodes(this.graph).values()) {
      for (const requirement of node.features) {
        const packageRoot = resolve(requirement.package.root);
        let provider = loadedByPackageRoot.get(packageRoot);
        if (!provider) {
          const previousId = this.model.featureIdsByPackageRoot.get(packageRoot);
          provider = !plan.reloadedFeaturePackages.has(packageRoot) && previousId
            ? this.model.providers.get(previousId)
            : undefined;
          if (!provider) provider = await loadProvider(this.modules, requirement.package);
          loadedByPackageRoot.set(packageRoot, provider);
          featureIdsByPackageRoot.set(packageRoot, provider.id);
          catalog.add(provider);
          providers.set(provider.id, provider);
        }
        const roots = rootsByFeature.get(provider.id) ?? [];
        roots.push({ owner: node.id, packageRoot: node.package.root });
        rootsByFeature.set(provider.id, roots);
      }
    }
    return {
      providers: new Map(providers),
      rootsByFeature: new Map(
        [...rootsByFeature].map(([feature, roots]) => [feature, Object.freeze(roots)]),
      ),
      featureIdsByPackageRoot: new Map(featureIdsByPackageRoot),
    };
  }

  async #prepareCapabilities(
    current: RuntimeSnapshot,
    plan: TopologyTransactionPlan,
    setupRoots: readonly PluginId[],
    topology: FeatureTopology,
    selected: CapabilityDelta,
  ): Promise<Map<CapabilityId, CapabilitySlot>> {
    const nextOwners = new Set(graphNodes(this.graph).keys());
    const mounted = mountedFeatures(topology);
    const refresh = new Set<string>();
    for (const [feature, roots] of topology.rootsByFeature) {
      for (const root of roots) {
        if (setupRoots.some((owner) => isWithin(root.owner, owner))) {
          refresh.add(ownerFeatureKey(root.owner, feature));
        }
      }
    }
    for (const mount of plan.addedFeatures) {
      const feature = topology.featureIdsByPackageRoot.get(mount.packageRoot);
      if (feature) refresh.add(ownerFeatureKey(mount.owner, feature));
    }
    for (const mount of featureMountsForReload(this.graph, plan.reloadedFeaturePackages)) {
      const feature = topology.featureIdsByPackageRoot.get(mount.packageRoot);
      if (feature) refresh.add(ownerFeatureKey(mount.owner, feature));
    }
    for (const mount of plan.removedFeatures) {
      const previousFeature = this.model.featureIdsByPackageRoot.get(mount.packageRoot);
      if (previousFeature) refresh.add(ownerFeatureKey(mount.owner, previousFeature));
    }

    const capabilities = new Map(current.capabilities);
    const retainedSetup: CapabilitySlot[] = [];
    const selectedIds = new Set(capabilityDeltaIds(selected));
    for (const [id, slot] of capabilities) {
      const key = ownerFeatureKey(slot.owner, slot.feature);
      const replacedOwner = setupRoots.some(root => isWithin(slot.owner, root));
      if (
        !nextOwners.has(slot.owner)
        || !mounted.has(key)
        || refresh.has(key)
        || selectedIds.has(id)
      ) {
        capabilities.delete(id);
        // Setup definitions belong to their retained Scope, not a convention
        // file. A provider refresh still validates them against its new contract;
        // replaced/removed owners and mounts are never resurrected this way.
        if (slot.origin === 'setup' && nextOwners.has(slot.owner) && mounted.has(key)
          && !replacedOwner && !selectedIds.has(id)) retainedSetup.push(slot);
      }
    }
    mergeSetupCapabilities(capabilities, retainedSetup, topology.providers, topology.rootsByFeature);

    const discovery = new FeatureDiscovery(new NodeDiscoveryHost(this.modules));
    for (const [feature, roots] of topology.rootsByFeature) {
      const selected = roots.filter((root) => refresh.has(ownerFeatureKey(root.owner, feature)));
      if (selected.length === 0) continue;
      const provider = topology.providers.get(feature);
      if (!provider) throw new Error(`Missing Feature provider for ${feature}`);
      for (const slot of await discovery.discover(provider, selected)) {
        addCapabilitySlot(capabilities, slot);
      }
    }

    // A manifest batch can carry a direct capability change. Rediscover the
    // requested Slots after topology refresh so both observations commit as
    // one immutable generation instead of racing two reload transactions.
    const selectedByFeature = selectedSlotsByFeature(current, selected, refresh);
    for (const [feature, ids] of selectedByFeature) {
      const provider = topology.providers.get(feature);
      if (!provider) continue;
      const roots = topology.rootsByFeature.get(feature) ?? [];
      for (const slot of await discovery.discover(provider, roots, { capabilities: ids })) {
        addCapabilitySlot(capabilities, slot);
      }
    }
    return capabilities;
  }
}

async function loadProvider(
  modules: ModuleRuntime,
  pkg: PluginGraphNode['features'][number]['package'],
): Promise<FeatureProvider> {
  const manifest = pkg.packageJson.zhin as ZhinFeatureManifest;
  const module = await modules.load<{ readonly default?: unknown }>(
    resolve(pkg.root, manifest.entry),
  );
  const provider = module.default as FeatureProvider | undefined;
  if (!provider || provider.protocol !== 1) {
    throw new TypeError(`${pkg.name} does not default-export a Feature provider`);
  }
  return provider;
}

function changedConfigRoots(
  current: RuntimeSnapshot,
  nextNodes: ReadonlyMap<PluginId, PluginGraphNode>,
  configResolver: PluginConfigResolver,
): readonly PluginId[] {
  const changed: PluginId[] = [];
  for (const [id, node] of nextNodes) {
    if (!current.tree.has(id)) continue;
    if (!isDeepStrictEqual(current.config.get(id), configResolver(node) ?? {})) changed.push(id);
  }
  return collapseRoots(changed);
}

function withReplacements(
  plan: TopologyTransactionPlan,
  replacedPluginRoots: readonly PluginId[],
): TopologyTransactionPlan {
  if (sameValues(plan.replacedPluginRoots, replacedPluginRoots)) return plan;
  return Object.freeze({
    ...plan,
    replacedPluginRoots,
    changed: plan.changed || replacedPluginRoots.length > 0,
  });
}

function mountedFeatures(topology: FeatureTopology): ReadonlySet<string> {
  const mounted = new Set<string>();
  for (const [feature, roots] of topology.rootsByFeature) {
    for (const root of roots) mounted.add(ownerFeatureKey(root.owner, feature));
  }
  return mounted;
}

function featureMountsForReload(
  graph: ProjectGraph,
  packageRoots: ReadonlySet<string>,
): readonly FeatureMount[] {
  const mounts: FeatureMount[] = [];
  for (const node of graphNodes(graph).values()) {
    for (const requirement of node.features) {
      const packageRoot = resolve(requirement.package.root);
      if (packageRoots.has(packageRoot)) mounts.push({ owner: node.id, packageRoot });
    }
  }
  return mounts;
}

function ownerFeatureKey(owner: PluginId, feature: FeatureId): string {
  return `${owner}\0${feature}`;
}

function selectedSlotsByFeature(
  current: RuntimeSnapshot,
  selected: CapabilityDelta,
  refreshed: ReadonlySet<string>,
): ReadonlyMap<FeatureId, ReadonlySet<CapabilityId>> {
  const result = new Map<FeatureId, Set<CapabilityId>>();
  for (const [feature, selectedIds] of selected) {
    for (const id of selectedIds) {
      const slot = current.capabilities.get(id);
      if (slot && refreshed.has(ownerFeatureKey(slot.owner, slot.feature))) continue;
      const ids = result.get(feature) ?? new Set<CapabilityId>();
      ids.add(id);
      result.set(feature, ids);
    }
  }
  return result;
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMountedFeatures(
  owner: PluginId,
  previous: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>,
  next: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>,
): boolean {
  const mounted = (roots: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>) =>
    new Set([...roots].filter(([, values]) => values.some(value => value.owner === owner)).map(([id]) => id));
  const before = mounted(previous);
  const after = mounted(next);
  return before.size === after.size && [...before].every(id => after.has(id));
}

function sameFeatureSlots(
  feature: FeatureId,
  previous: ReadonlyMap<CapabilityId, CapabilitySlot>,
  next: ReadonlyMap<CapabilityId, CapabilitySlot>,
): boolean {
  const before = [...previous.values()].filter(slot => slot.feature === feature);
  const after = [...next.values()].filter(slot => slot.feature === feature);
  return before.length === after.length && before.every(slot => next.get(slot.id) === slot);
}

function sameFeatureOwners(
  previous: readonly CapabilityRoot[],
  next: readonly CapabilityRoot[],
  previousScopes: ReadonlyMap<PluginId, unknown>,
  nextScopes: ReadonlyMap<PluginId, unknown>,
): boolean {
  return previous.length === next.length && previous.every((root, index) => {
    const candidate = next[index];
    return candidate?.owner === root.owner
      && candidate.packageRoot === root.packageRoot
      && previousScopes.get(root.owner) === nextScopes.get(root.owner);
  });
}

async function rollback(
  scopeDisposers: readonly Dispose[],
  projectionDisposers: readonly Dispose[],
  prepareError: unknown,
): Promise<void> {
  const disposers = new DisposeStack();
  for (const dispose of scopeDisposers) disposers.add(dispose);
  for (const dispose of projectionDisposers) disposers.add(dispose);
  try {
    await disposers.dispose();
  } catch (disposeError) {
    throw new AggregateError(
      [prepareError, disposeError],
      'Topology generation prepare and rollback both failed',
      { cause: disposeError },
    );
  }
}
