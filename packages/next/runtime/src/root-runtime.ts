import { resolve } from 'node:path';
import {
  DisposeStack,
  RootController,
  Scope,
  createSnapshotView,
  rootPluginId,
  type CapabilityId,
  type CapabilitySlot,
  type ConfigView,
  type Dispose,
  type DisposeStack as DisposeStackType,
  type FeatureId,
  type PluginDefinition,
  type PluginId,
  type PluginInstanceView,
  type PluginNodeSnapshot,
  type RuntimeSnapshot,
  type SnapshotState,
  type TokenId,
} from '@zhin.js/next-kernel';
import {
  FeatureCatalog,
  FeatureDiscovery,
  type CapabilityRoot,
  type FeatureProvider,
} from '@zhin.js/next-feature-kit';
import type { ZhinFeatureManifest, ZhinPluginManifest } from './manifest.js';
import { ConfigComposer, type RuntimeConfigDocument } from './config-composer.js';
import { runtimeEnvironmentToken, type RuntimeEnvironment } from './environment.js';
import { GenerationAssets } from './generation-assets.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import { NodePackageResolver } from './package-resolver.js';
import { ProjectGraphService, type PluginGraphNode, type ProjectGraph } from './project-graph.js';
import { HmrCoordinator, type HmrCoordinatorOptions } from './hmr-coordinator.js';
import type { GenerationInvalidationPlan } from './invalidation-planner.js';
import type {
  PreparedRuntimeGeneration,
  RuntimeGenerationModel,
} from './runtime-generation.js';
import { SlotGenerationPreparer } from './slot-generation-preparer.js';
import { SourceOwnershipIndex } from './source-ownership.js';

export type PluginConfigResolver = (node: PluginGraphNode) => unknown;
export interface RootResourceContext {
  readonly resources: Scope;
  readonly lifecycle: DisposeStackType;
}
export type RootResourceInstaller = (context: RootResourceContext) => void | Promise<void>;

export interface RootRuntimeOptions {
  readonly projectRoot: string;
  readonly modules: ModuleRuntime;
  readonly environment: RuntimeEnvironment;
  readonly config?: PluginConfigResolver | RuntimeConfigDocument;
  readonly installResources?: RootResourceInstaller;
}

export type RootHmrOptions = Omit<HmrCoordinatorOptions, 'modules' | 'ownership' | 'runtime'>;

export class RootRuntime {
  readonly controller: RootController;
  readonly #projectRoot: string;
  readonly #modules: ModuleRuntime;
  readonly #environment: RuntimeEnvironment;
  readonly #config: PluginConfigResolver | RuntimeConfigDocument;
  readonly #installResources?: RootResourceInstaller;
  #ownership = SourceOwnershipIndex.empty();
  #model?: RuntimeGenerationModel;

  constructor(options: RootRuntimeOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#modules = options.modules;
    this.#environment = Object.freeze({ ...options.environment });
    this.#config = options.config ?? Object.freeze({});
    this.#installResources = options.installResources;
    this.controller = new RootController(emptyState());
  }

  get snapshot(): RuntimeSnapshot {
    return this.controller.snapshots.current;
  }

  get sourceOwnership(): SourceOwnershipIndex {
    return this.#ownership;
  }

  async start(): Promise<RuntimeSnapshot> {
    let prepared: PreparedRuntimeGeneration | undefined;
    const snapshot = await this.controller.start(async (current) => {
      prepared = await this.#prepare(current);
      return prepared.generation;
    });
    this.#accept(requirePrepared(prepared));
    return snapshot;
  }

  async reload(target: PluginId | string = rootPluginId()): Promise<RuntimeSnapshot> {
    let prepared: PreparedRuntimeGeneration | undefined;
    const snapshot = await this.controller.reload(target, async (current) => {
      prepared = await this.#prepare(current);
      return prepared.generation;
    });
    this.#accept(requirePrepared(prepared));
    return snapshot;
  }

  createHmrCoordinator(options: RootHmrOptions): HmrCoordinator {
    return new HmrCoordinator({
      ...options,
      modules: this.#modules,
      ownership: () => this.#ownership,
      runtime: {
        reload: async (plan) => {
          await this.#reloadPlan(plan);
        },
      },
    });
  }

  async stop(): Promise<void> {
    try {
      await this.controller.stop();
    } finally {
      await this.#modules.close();
    }
  }

  async #reloadPlan(plan: GenerationInvalidationPlan): Promise<RuntimeSnapshot> {
    let prepared: PreparedRuntimeGeneration | undefined;
    const snapshot = await this.controller.reload(
      plan.subtrees[0] ?? plan.slots[0] ?? rootPluginId(),
      async (current) => {
        prepared = plan.subtrees.length === 0 && plan.slots.length > 0 && this.#model
          ? await new SlotGenerationPreparer(this.#modules, this.#model)
              .prepare(current, plan.slots)
          : await this.#prepare(current);
        return prepared.generation;
      },
    );
    this.#accept(requirePrepared(prepared));
    return snapshot;
  }

  #accept(prepared: PreparedRuntimeGeneration): void {
    this.#ownership = prepared.ownership;
    this.#model = prepared.model;
  }

  async #prepare(current: RuntimeSnapshot): Promise<PreparedRuntimeGeneration> {
    const resolver = await NodePackageResolver.create(this.#projectRoot);
    const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
    const configResolver =
      typeof this.#config === 'function'
        ? this.#config
        : await new ConfigComposer()
            .compose(graph, this.#config)
            .then((composed) => (node: PluginGraphNode) => composed.views.get(node.id));
    const assembler = new GenerationAssembler(
      graph,
      this.#modules,
      configResolver,
      current.generation + 1,
      this.#environment,
      this.#installResources,
    );
    return assembler.prepare();
  }
}

class GenerationAssembler {
  readonly #scopeDisposers = new DisposeStack();
  readonly #scopes = new Map<PluginId, Scope>();
  readonly #tree = new Map<PluginId, PluginNodeSnapshot>();
  readonly #config = new Map<PluginId, unknown>();
  readonly #resources = new Map<PluginId, ReadonlyMap<TokenId, unknown>>();
  readonly #capabilities = new Map<CapabilityId, CapabilitySlot>();
  readonly #projections = new Map<FeatureId, unknown>();
  readonly #catalog = new FeatureCatalog();
  readonly #rootsByFeature = new Map<FeatureId, CapabilityRoot[]>();
  readonly #featureIdsByPackageRoot = new Map<string, FeatureId>();
  readonly #projectionDisposers: Dispose[] = [];
  readonly #host: NodeDiscoveryHost;

  constructor(
    private readonly graph: ProjectGraph,
    private readonly modules: ModuleRuntime,
    private readonly configResolver: PluginConfigResolver,
    private readonly generation: number,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
  ) {
    this.#host = new NodeDiscoveryHost(modules);
  }

  async prepare(): Promise<PreparedRuntimeGeneration> {
    try {
      // Prepare is deliberately ordered: providers define discovery, setup
      // creates owner scopes, then definitions can be projected against both.
      await this.#loadProviders(this.graph.root);
      await this.#setupPlugin(this.graph.root);
      await this.#discoverAndProject();
      this.#scopeDisposers.seal();
      const state = this.#state();
      const snapshot = createSnapshotView(this.generation, state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.graph,
        snapshot,
        this.#featureIdsByPackageRoot,
      );
      const assets = GenerationAssets.create(
        () => this.#scopeDisposers.dispose(),
        this.#projectionDisposers,
      );
      return {
        generation: {
          snapshot: state,
          dispose: () => assets.dispose(),
        },
        ownership,
        model: {
          graph: this.graph,
          providers: new Map(
            this.#catalog.values().map((provider) => [provider.id, provider]),
          ),
          rootsByFeature: new Map(
            [...this.#rootsByFeature].map(([feature, roots]) => [
              feature,
              Object.freeze([...roots]),
            ]),
          ),
          featureIdsByPackageRoot: new Map(this.#featureIdsByPackageRoot),
          assets,
        },
      };
    } catch (error) {
      await disposePreparedParts(
        () => this.#scopeDisposers.dispose(),
        this.#projectionDisposers,
        error,
      );
      throw error;
    }
  }

  async #loadProviders(node: PluginGraphNode): Promise<void> {
    for (const requirement of node.features) {
      const manifest = requirement.package.packageJson.zhin as ZhinFeatureManifest;
      const module = await this.modules.load<ModuleNamespace>(
        resolve(requirement.package.root, manifest.entry),
      );
      const provider = module.default as FeatureProvider | undefined;
      if (!provider || provider.protocol !== 1) {
        throw new TypeError(
          `${requirement.package.name} does not default-export a Feature provider`,
        );
      }
      this.#catalog.add(provider);
      const packageRoot = resolve(requirement.package.root);
      const existingFeature = this.#featureIdsByPackageRoot.get(packageRoot);
      if (existingFeature && existingFeature !== provider.id) {
        throw new Error(
          `Feature package ${requirement.package.name} changed identity within one generation`,
        );
      }
      this.#featureIdsByPackageRoot.set(packageRoot, provider.id);
      const roots = this.#rootsByFeature.get(provider.id) ?? [];
      roots.push({ owner: node.id, packageRoot: node.package.root });
      this.#rootsByFeature.set(provider.id, roots);
    }
    for (const child of node.children) await this.#loadProviders(child);
  }

  async #setupPlugin(node: PluginGraphNode): Promise<void> {
    const manifest = node.package.packageJson.zhin as ZhinPluginManifest;
    if (manifest.runtime === 'isolated') {
      throw new Error(`Isolated Plugin runtime is not implemented: ${node.package.name}`);
    }
    const module = await this.modules.load<ModuleNamespace>(
      resolve(node.package.root, manifest.entry),
    );
    const definition = module.default as PluginDefinition | undefined;
    if (!definition || typeof definition.name !== 'string') {
      throw new TypeError(`${node.package.name} does not default-export a Plugin definition`);
    }

    const parentScope = node.parent ? this.#scopes.get(node.parent) : undefined;
    if (node.parent && !parentScope) throw new Error(`Missing parent scope for ${node.id}`);
    const scope = new Scope(node.id, parentScope);
    this.#scopes.set(node.id, scope);
    this.#scopeDisposers.add(() => scope.disposers.dispose());

    if (!node.parent) {
      scope.provide(runtimeEnvironmentToken, this.environment);
      await this.installResources?.({
        resources: scope,
        lifecycle: scope.disposers,
      });
    }

    for (const token of definition.requires ?? []) {
      if (!scope.has(token)) {
        throw new Error(`Missing resource ${token.id} for Plugin ${node.id}`);
      }
    }

    const config = Object.freeze(this.configResolver(node) ?? {});
    const view: ConfigView<unknown> = { get: () => config };
    const plugin: PluginInstanceView = Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      parent: node.parent,
      root: rootPluginId(),
      role: node.parent ? 'child' : 'root',
    });
    const returned = await definition.setup?.({
      plugin,
      config: view,
      resources: scope,
      lifecycle: scope.disposers,
    });
    if (returned) scope.disposers.add(returned);
    scope.seal();

    this.#tree.set(
      node.id,
      Object.freeze({
        id: node.id,
        instanceKey: node.instanceKey,
        packageName: node.package.name,
        packageRoot: node.package.root,
        parent: node.parent,
        children: Object.freeze(node.children.map((child) => child.id)),
        metadata: definition.metadata,
      }),
    );
    this.#config.set(node.id, config);
    this.#resources.set(node.id, scope.snapshot());

    for (const child of node.children) await this.#setupPlugin(child);
  }

  async #discoverAndProject(): Promise<void> {
    const discovery = new FeatureDiscovery(this.#host);
    const providers = this.#catalog.values();
    for (const provider of providers) {
      const roots = this.#rootsByFeature.get(provider.id) ?? [];
      const slots = await discovery.discover(provider, roots);
      for (const slot of slots) this.#capabilities.set(slot.id, slot);
    }

    for (const provider of providers) {
      const slots = [...this.#capabilities.values()].filter((slot) => slot.feature === provider.id);
      const projection = await provider.runtime.project(slots, {
        snapshot: this.#candidateSnapshot(),
      });
      this.#projections.set(provider.id, projection.value);
      if (projection.dispose) this.#projectionDisposers.push(projection.dispose);
    }
  }

  #state(): SnapshotState {
    return {
      root: rootPluginId(),
      tree: this.#tree,
      config: this.#config,
      resources: this.#resources,
      capabilities: this.#capabilities,
      projections: this.#projections,
    };
  }

  #candidateSnapshot(): RuntimeSnapshot {
    return createSnapshotView(this.generation, this.#state());
  }
}

interface ModuleNamespace {
  readonly default?: unknown;
}

function emptyState(): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}

function requirePrepared(
  prepared: PreparedRuntimeGeneration | undefined,
): PreparedRuntimeGeneration {
  if (!prepared) throw new Error('RootController committed without a prepared generation');
  return prepared;
}

async function disposePreparedParts(
  disposeScopes: Dispose,
  projectionDisposers: readonly Dispose[],
  prepareError?: unknown,
): Promise<void> {
  const rollback = new DisposeStack();
  rollback.add(disposeScopes);
  for (const dispose of projectionDisposers) rollback.add(dispose);
  try {
    await rollback.dispose();
  } catch (disposeError) {
    if (prepareError !== undefined) {
      throw new AggregateError(
        [prepareError, disposeError],
        'Generation prepare and rollback both failed',
        { cause: disposeError },
      );
    }
    throw disposeError;
  }
}
