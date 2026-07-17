import {
  DisposeStack,
  createSnapshotView,
  rootPluginId,
  type Dispose,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import { FeatureDiscovery } from '@zhin.js/next-feature-kit';
import type { RuntimeEnvironment } from './environment.js';
import { FeatureProjector } from './feature-projector.js';
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

export class SubtreeTopologyChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtreeTopologyChangedError';
  }
}

/** Replaces selected Plugin forests while retaining all other Scope lifetimes. */
export class SubtreeGenerationPreparer {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly model: RuntimeGenerationModel,
    private readonly graph: ProjectGraph,
    private readonly configResolver: PluginConfigResolver,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
  ) {}

  async prepare(
    current: RuntimeSnapshot,
    roots: readonly PluginId[],
  ): Promise<PreparedRuntimeGeneration> {
    const nodes = indexGraph(this.graph);
    assertCompatibleTopology(indexGraph(this.model.graph), nodes, roots);
    const plugins = new PluginScopeAssembler(
      this.modules,
      this.configResolver,
      this.environment,
      this.installResources,
      {
        scopes: this.model.scopes,
        tree: current.tree,
        config: current.config,
        resources: current.resources,
      },
    );
    plugins.removeSubtrees(roots);

    const projectionDisposers: Dispose[] = [];
    try {
      for (const root of roots) {
        const node = nodes.get(root);
        if (!node) throw new SubtreeTopologyChangedError(`Missing subtree root: ${root}`);
        await plugins.setupTree(node);
      }

      const capabilities = new Map(current.capabilities);
      for (const [id, slot] of capabilities) {
        if (roots.some((root) => isWithin(slot.owner, root))) capabilities.delete(id);
      }
      const discovery = new FeatureDiscovery(new NodeDiscoveryHost(this.modules));
      for (const provider of this.model.providers.values()) {
        const affectedRoots = (this.model.rootsByFeature.get(provider.id) ?? [])
          .filter((root) => roots.some((owner) => isWithin(root.owner, owner)));
        if (affectedRoots.length === 0) continue;
        const slots = await discovery.discover(provider, affectedRoots);
        for (const slot of slots) capabilities.set(slot.id, slot);
      }

      const projected = await new FeatureProjector(this.model.providers.values()).project(
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
        this.model.featureIdsByPackageRoot,
      );
      const replacements = new Map(plugins.createdScopeDisposers());
      // Local prepare still commits a complete immutable generation. The
      // replacement map controls lifetime ownership, not snapshot granularity.
      const assets = this.model.assets.replaceScopes(
        [...nodes.keys()],
        replacements,
        projectionDisposers,
      );
      return {
        generation: {
          snapshot: projected.state,
          dispose: () => assets.dispose(),
          handoff: plugins.generationHandoff(),
        },
        ownership,
        model: {
          ...this.model,
          graph: this.graph,
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
}

function indexGraph(graph: ProjectGraph): ReadonlyMap<PluginId, PluginGraphNode> {
  const result = new Map<PluginId, PluginGraphNode>();
  const visit = (node: PluginGraphNode): void => {
    result.set(node.id, node);
    for (const child of node.children) visit(child);
  };
  visit(graph.root);
  return result;
}

function assertCompatibleTopology(
  previousNodes: ReadonlyMap<PluginId, PluginGraphNode>,
  nextNodes: ReadonlyMap<PluginId, PluginGraphNode>,
  roots: readonly PluginId[],
): void {
  if (roots.includes(rootPluginId())) {
    throw new SubtreeTopologyChangedError('Root changes require a full generation');
  }
  if (previousNodes.size !== nextNodes.size) {
    throw new SubtreeTopologyChangedError('Plugin tree size changed');
  }
  for (const [id, previous] of previousNodes) {
    const next = nextNodes.get(id);
    if (
      !next
      || next.parent !== previous.parent
      || next.instanceKey !== previous.instanceKey
      || next.package.root !== previous.package.root
      || next.package.name !== previous.package.name
      || !sameValues(
        next.children.map((child) => child.id),
        previous.children.map((child) => child.id),
      )
      || !sameValues(featureRoots(next), featureRoots(previous))
    ) {
      throw new SubtreeTopologyChangedError(`Plugin topology changed at ${id}`);
    }
  }
}

function featureRoots(node: PluginGraphNode): readonly string[] {
  return node.features.map((feature) => feature.package.root);
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isWithin(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
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
      'Subtree generation prepare and rollback both failed',
      { cause: disposeError },
    );
  }
}
