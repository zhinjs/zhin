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
import type {
  PreparedRuntimeGeneration,
  RuntimeGenerationModel,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';
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

/** Prepares manifest topology changes without rebuilding stable Plugin Scopes. */
export class TopologyGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
    private readonly graph: ProjectGraph,
    private readonly configResolver: PluginConfigResolver,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
    private readonly environmentLayers: EnvironmentLayers = {},
    private readonly isolation?: IsolatedPluginRuntimePort,
  ) {}

  async prepare(current: RuntimeSnapshot): Promise<PreparedRuntimeGeneration | undefined> {
    const planned = new TopologyTransactionPlanner().plan(this.model.graph, this.graph);
    const nextNodes = graphNodes(this.graph);
    const configReplacements = changedConfigRoots(current, nextNodes, this.configResolver);
    const replacedPluginRoots = collapseRoots([
      ...planned.replacedPluginRoots,
      ...configReplacements,
    ]);
    const plan = withReplacements(planned, replacedPluginRoots);
    if (!plan.changed) return undefined;

    const featureTopology = await this.#loadFeatureTopology(plan);
    const plugins = new PluginScopeAssembler(
      this.modules,
      this.configResolver,
      this.environment,
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
    const setupRoots = collapseRoots([
      ...plan.addedPluginRoots,
      ...plan.replacedPluginRoots,
    ]);
    const removalRoots = collapseRoots([
      ...plan.removedPluginRoots,
      ...plan.replacedPluginRoots,
    ]);
    plugins.removeSubtrees(removalRoots);

    const projectionDisposers: Dispose[] = [];
    try {
      for (const root of setupRoots) {
        const node = nextNodes.get(root);
        if (!node) throw new Error(`Missing topology setup root: ${root}`);
        await plugins.setupTree(node);
      }
      // Retained parents still need a new immutable children view after add,
      // remove, move, or reorder operations.
      plugins.synchronizeTree(this.graph.root);

      const capabilities = await this.#prepareCapabilities(
        current,
        plan,
        setupRoots,
        featureTopology,
      );
      const projected = await new FeatureProjector(featureTopology.providers.values()).project(
        current.generation + 1,
        {
          root: current.root,
          tree: plugins.tree,
          config: plugins.config,
          resources: plugins.resources,
          capabilities,
        },
      );
      projectionDisposers.push(...projected.disposers);

      const snapshot = createSnapshotView(current.generation + 1, projected.state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.graph,
        snapshot,
        featureTopology.featureIdsByPackageRoot,
      );
      const replacements = new Map(plugins.createdScopeDisposers());
      const assets = this.model.assets.replaceScopes(
        graphOrder(this.graph),
        replacements,
        projectionDisposers,
      );
      return {
        generation: {
          snapshot: projected.state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(
            plugins.generationHandoff(),
            projected.handoff,
          ),
        },
        ownership,
        model: {
          graph: this.graph,
          providers: featureTopology.providers,
          rootsByFeature: featureTopology.rootsByFeature,
          featureIdsByPackageRoot: featureTopology.featureIdsByPackageRoot,
          scopes: new Map(plugins.scopes),
          assets,
        },
      };
    } catch (error) {
      await rollback(
        plugins.createdScopeDisposers().map(([, dispose]) => dispose),
        projectionDisposers,
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
    for (const [id, slot] of capabilities) {
      const key = ownerFeatureKey(slot.owner, slot.feature);
      if (!nextOwners.has(slot.owner) || !mounted.has(key) || refresh.has(key)) {
        capabilities.delete(id);
      }
    }

    const discovery = new FeatureDiscovery(new NodeDiscoveryHost(this.modules));
    for (const [feature, roots] of topology.rootsByFeature) {
      const selected = roots.filter((root) => refresh.has(ownerFeatureKey(root.owner, feature)));
      if (selected.length === 0) continue;
      const provider = topology.providers.get(feature);
      if (!provider) throw new Error(`Missing Feature provider for ${feature}`);
      for (const slot of await discovery.discover(provider, selected)) {
        capabilities.set(slot.id, slot);
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

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
