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
  type DisposeStack as DisposeStackType,
  type FeatureId,
  type PluginDefinition,
  type PluginId,
  type PluginInstanceView,
  type PluginNodeSnapshot,
  type PreparedGeneration,
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
import {
  ConfigComposer,
  type RuntimeConfigDocument,
} from './config-composer.js';
import {
  runtimeEnvironmentToken,
  type RuntimeEnvironment,
} from './environment.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import { NodePackageResolver } from './package-resolver.js';
import {
  ProjectGraphService,
  type PluginGraphNode,
  type ProjectGraph,
} from './project-graph.js';

export type PluginConfigResolver = (node: PluginGraphNode) => unknown;
export interface RootResourceContext {
  readonly resources: Scope;
  readonly lifecycle: DisposeStackType;
}
export type RootResourceInstaller = (
  context: RootResourceContext,
) => void | Promise<void>;

export interface RootRuntimeOptions {
  readonly projectRoot: string;
  readonly modules: ModuleRuntime;
  readonly environment: RuntimeEnvironment;
  readonly config?: PluginConfigResolver | RuntimeConfigDocument;
  readonly installResources?: RootResourceInstaller;
}

export class RootRuntime {
  readonly controller: RootController;
  readonly #projectRoot: string;
  readonly #modules: ModuleRuntime;
  readonly #environment: RuntimeEnvironment;
  readonly #config: PluginConfigResolver | RuntimeConfigDocument;
  readonly #installResources?: RootResourceInstaller;

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

  start(): Promise<RuntimeSnapshot> {
    return this.controller.start((current) => this.#prepare(current));
  }

  reload(target: PluginId | string = rootPluginId()): Promise<RuntimeSnapshot> {
    return this.controller.reload(target, (current) => this.#prepare(current));
  }

  async stop(): Promise<void> {
    try {
      await this.controller.stop();
    } finally {
      await this.#modules.close();
    }
  }

  async #prepare(current: RuntimeSnapshot): Promise<PreparedGeneration> {
    const resolver = await NodePackageResolver.create(this.#projectRoot);
    const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
    const configResolver = typeof this.#config === 'function'
      ? this.#config
      : await new ConfigComposer().compose(graph, this.#config)
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
  readonly #disposers = new DisposeStack();
  readonly #scopes = new Map<PluginId, Scope>();
  readonly #tree = new Map<PluginId, PluginNodeSnapshot>();
  readonly #config = new Map<PluginId, unknown>();
  readonly #resources = new Map<PluginId, ReadonlyMap<TokenId, unknown>>();
  readonly #capabilities = new Map<CapabilityId, CapabilitySlot>();
  readonly #projections = new Map<FeatureId, unknown>();
  readonly #catalog = new FeatureCatalog();
  readonly #rootsByFeature = new Map<FeatureId, CapabilityRoot[]>();
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

  async prepare(): Promise<PreparedGeneration> {
    try {
      await this.#loadProviders(this.graph.root);
      await this.#setupPlugin(this.graph.root);
      await this.#discoverAndProject();
      this.#disposers.seal();
      return {
        snapshot: this.#state(),
        dispose: () => this.#disposers.dispose(),
      };
    } catch (error) {
      try {
        await this.#disposers.dispose();
      } catch (disposeError) {
        throw new AggregateError(
          [error, disposeError],
          'Generation prepare and rollback both failed',
          { cause: disposeError },
        );
      }
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
    this.#disposers.add(() => scope.disposers.dispose());

    if (!node.parent) {
      scope.provide(runtimeEnvironmentToken, this.environment);
      await this.installResources?.({ resources: scope, lifecycle: scope.disposers });
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

    this.#tree.set(node.id, Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      packageName: node.package.name,
      packageRoot: node.package.root,
      parent: node.parent,
      children: Object.freeze(node.children.map((child) => child.id)),
      metadata: definition.metadata,
    }));
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
      const slots = [...this.#capabilities.values()].filter(
        (slot) => slot.feature === provider.id,
      );
      const projection = await provider.runtime.project(slots, {
        snapshot: this.#candidateSnapshot(),
      });
      this.#projections.set(provider.id, projection.value);
      if (projection.dispose) this.#disposers.add(projection.dispose);
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
