import { resolve } from 'node:path';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  capabilityId,
  createGenerationAdmissionGate,
  createToken,
  createPluginDatabaseHost,
  createPluginScheduleHost,
  databaseHostToken,
  databaseRootHostToken,
  featureId,
  rootPluginId,
  scheduleHostToken,
  scheduleRootHostToken,
  unwrapPluginDatabaseHost,
  unwrapPluginScheduleHost,
  type CapabilityId,
  type ConfigView,
  type Dispose,
  type FeatureId,
  type GenerationHandoff,
  type GenerationAdmissionGate,
  type GenerationHandoffRegistry,
  type PluginDefinition,
  type PluginId,
  type PluginInstanceView,
  type PluginNodeSnapshot,
  type PluginSetupContext,
  type SetupCapabilityRegistration,
  type TokenId,
} from '@zhin.js/plugin-runtime';
import { runtimeEnvironmentToken, type RuntimeEnvironment } from './environment.js';
import {
  EnvStoreFactory,
  envStoreToken,
  type EnvironmentLayers,
} from './environment-store.js';
import type { ZhinPluginManifest } from './manifest.js';
import type { ModuleRuntime } from './module-runtime.js';
import type { PluginGraphNode } from './project-graph.js';
import type { IsolatedPluginRuntimePort } from './isolation.js';
import {
  createPrimaryConfig,
  primaryConfigToken,
  type PrimaryConfig,
} from './primary-config.js';
import type { RuntimeConfigDocument } from './config-composer.js';

export type PluginConfigResolver = (node: PluginGraphNode) => unknown;

export interface RootResourceContext {
  /** Exact shadow generation being assembled; never inferred from a latest snapshot. */
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
  readonly handoff: GenerationHandoffRegistry;
  /** Candidate-wide gate atomically switched by SnapshotStore at commit. */
  readonly admission: GenerationAdmissionGate;
  readonly config: PrimaryConfig;
  /**
   * Adds a root-owned capability to this shadow generation. The definition is
   * validated and projected with convention/setup capabilities; it is never
   * visible before the generation commits.
   */
  addFeature<TDefinition>(
    feature: FeatureId | string,
    localName: string,
    definition: TDefinition,
  ): void;
}

export type RootResourceInstaller = (
  context: RootResourceContext,
) => void | Promise<void>;

export interface PluginAssemblySeed {
  readonly scopes: ReadonlyMap<PluginId, Scope>;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;
  readonly config: ReadonlyMap<PluginId, unknown>;
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
}

/** Assembles Plugin setup into mutable shadow maps without publishing them. */
export class PluginScopeAssembler {
  readonly scopes: Map<PluginId, Scope>;
  readonly tree: Map<PluginId, PluginNodeSnapshot>;
  readonly config: Map<PluginId, unknown>;
  readonly resources: Map<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly #setupCapabilities = new Map<CapabilityId, SetupCapabilityRegistration>();
  readonly #created: PluginId[] = [];
  readonly #handoffs = new GenerationHandoffStack();
  readonly #admission = createGenerationAdmissionGate();
  readonly #envStores: EnvStoreFactory;
  #setupFeatureAliases: ReadonlyMap<string, FeatureId> = new Map();

  constructor(
    private readonly modules: ModuleRuntime,
    private readonly configResolver: PluginConfigResolver,
    private readonly environment: RuntimeEnvironment,
    private readonly primaryConfigDocument: RuntimeConfigDocument,
    private readonly generation: number,
    private readonly installResources?: RootResourceInstaller,
    environmentLayers: EnvironmentLayers = {},
    seed?: PluginAssemblySeed,
    private readonly isolation?: IsolatedPluginRuntimePort,
  ) {
    this.#envStores = new EnvStoreFactory(environment, environmentLayers);
    this.scopes = new Map(seed?.scopes);
    this.tree = new Map(seed?.tree);
    this.config = new Map(seed?.config);
    this.resources = new Map(seed?.resources);
  }

  removeSubtrees(roots: readonly PluginId[]): void {
    // Seeded Scopes belong to a committed generation. Removing a map entry
    // only prepares the shadow view; GenerationAssets owns eventual disposal.
    for (const owner of [...this.scopes.keys()]) {
      if (!roots.some((root) => isWithin(owner, root))) continue;
      this.scopes.delete(owner);
      this.tree.delete(owner);
      this.config.delete(owner);
      this.resources.delete(owner);
    }
  }

  installSetupFeatureAliases(aliases: ReadonlyMap<string, FeatureId>): void {
    this.#setupFeatureAliases = new Map(aliases);
  }

  async setupTree(node: PluginGraphNode, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const manifest = node.package.packageJson.zhin as ZhinPluginManifest;
    const parentScope = node.parent ? this.scopes.get(node.parent) : undefined;
    if (node.parent && !parentScope) throw new Error(`Missing parent scope for ${node.id}`);
    const scope = new Scope(node.id, parentScope);
    this.scopes.set(node.id, scope);
    this.#created.push(node.id);
    // Every owner shadows the inherited EnvStore with its exact overlay view.
    const environment = this.#envStores.create(node.id);
    scope.provide(envStoreToken, environment);
    const register = <TDefinition>(
      feature: FeatureId | string,
      localName: string,
      capabilityDefinition: TDefinition,
    ): void => this.#registerSetupCapability(node, manifest, feature, localName, capabilityDefinition);

    if (!node.parent) {
      scope.provide(runtimeEnvironmentToken, this.environment);
      scope.provide(rootGenerationAdmissionToken, this.#admission);
      const config = createPrimaryConfig(this.primaryConfigDocument, environment);
      scope.provide(primaryConfigToken, config);
      await this.installResources?.({
        generation: this.generation,
        signal,
        resources: scope,
        lifecycle: scope.disposers,
        handoff: this.#handoffs,
        admission: this.#admission,
        config,
        addFeature: register,
      });
    }
    if (node.parent) this.installOwnerScopedHosts(scope, node.id);

    const config = Object.freeze(this.configResolver(node) ?? {});
    const view: ConfigView<unknown> = { get: () => config };
    const plugin: PluginInstanceView = Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      parent: node.parent,
      root: rootPluginId(),
      role: node.parent ? 'child' : 'root',
    });
    let metadata: PluginDefinition['metadata'];
    if (manifest.runtime === 'isolated') {
      if (!node.parent) throw new Error('Root Plugin cannot use runtime: isolated');
      if (node.features.length > 0) {
        throw new Error(`Isolated Plugin ${node.id} cannot mount Host Feature providers`);
      }
      if (!this.isolation) {
        throw new Error(`Isolated Plugin runtime adapter is required: ${node.package.name}`);
      }
      const prepared = await this.isolation.prepare({
        owner: node.id,
        parent: node.parent,
        packageName: node.package.name,
        entry: resolve(node.package.root, manifest.entry),
        config,
        environment: this.environment,
      }, signal);
      signal.throwIfAborted();
      // Ownership transfers to the shadow Scope immediately. Every later
      // validation or binding failure is then covered by normal rollback.
      scope.disposers.add(prepared.dispose);
      if (!prepared.descriptor.name) {
        throw new TypeError(`Isolated Plugin ${node.package.name} returned an invalid descriptor`);
      }
      for (const binding of prepared.resources ?? []) {
        scope.provide(binding.token, binding.value);
      }
      if (prepared.handoff) this.#handoffs.add(prepared.handoff);
      metadata = prepared.descriptor.metadata;
    } else {
      const module = await this.modules.load<ModuleNamespace>(
        resolve(node.package.root, manifest.entry),
      );
      signal.throwIfAborted();
      const definition = module.default as PluginDefinition | undefined;
      if (!definition || typeof definition.name !== 'string') {
        throw new TypeError(`${node.package.name} does not default-export a Plugin definition`);
      }
      for (const token of definition.requires ?? []) {
        if (!scope.has(token)) {
          throw new Error(`Missing resource ${token.id} for Plugin ${node.id}`);
        }
      }
      const setupContext: Record<string, unknown> = {
        signal,
        plugin,
        config: view,
        resources: scope,
        lifecycle: scope.disposers,
        handoff: this.#handoffs,
        addFeature: register,
      };
      for (const [method, feature] of this.#setupFeatureAliases) {
        setupContext[method] = (name: string, value: unknown) =>
          register(feature, name, value);
      }
      const returned = await definition.setup?.(
        Object.freeze(setupContext) as unknown as PluginSetupContext,
      );
      signal.throwIfAborted();
      if (returned) scope.disposers.add(returned);
      metadata = definition.metadata;
    }
    scope.seal();

    this.tree.set(node.id, Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      packageName: node.package.name,
      packageRoot: node.package.root,
      parent: node.parent,
      children: Object.freeze(node.children.map((child) => child.id)),
      metadata,
    }));
    this.config.set(node.id, config);
    this.resources.set(node.id, scope.snapshot());

    for (const child of node.children) await this.setupTree(child, signal);
  }

  #registerSetupCapability<TDefinition>(
    node: PluginGraphNode,
    manifest: ZhinPluginManifest,
    feature: FeatureId | string,
    localName: string,
    definition: TDefinition,
  ): void {
    const featureName = featureId(String(feature));
    const id = capabilityId(node.id, featureName, localName);
    if (this.#setupCapabilities.has(id)) {
      throw new Error(`Duplicate setup Capability: ${id}`);
    }
    this.#setupCapabilities.set(id, Object.freeze({
      id,
      owner: node.id,
      feature: featureName,
      localName,
      source: resolve(node.package.root, manifest.entry),
      definition,
    }));
  }

  synchronizeTree(node: PluginGraphNode): void {
    const current = this.tree.get(node.id);
    if (!current) throw new Error(`Missing Plugin tree node: ${node.id}`);
    this.tree.set(node.id, Object.freeze({
      ...current,
      instanceKey: node.instanceKey,
      packageName: node.package.name,
      packageRoot: node.package.root,
      parent: node.parent,
      children: Object.freeze(node.children.map((child) => child.id)),
    }));
    for (const child of node.children) this.synchronizeTree(child);
  }

  createdScopeDisposers(): readonly (readonly [PluginId, Dispose])[] {
    return this.#created.map((owner) => {
      const scope = this.scopes.get(owner);
      if (!scope) throw new Error(`Missing created Scope: ${owner}`);
      return [owner, () => scope.disposers.dispose()] as const;
    });
  }

  generationHandoff(): GenerationHandoff | undefined {
    return this.#handoffs.seal();
  }

  setupCapabilities(): readonly Readonly<SetupCapabilityRegistration>[] {
    return Object.freeze([...this.#setupCapabilities.values()]);
  }

  /**
   * Root resources are process-owned. A Plugin Scope receives only a facade
   * that translates logical table/job names to its owner namespace. The root
   * owner deliberately keeps bare names for backward-compatible projects.
   */
  private installOwnerScopedHosts(scope: Scope, owner: PluginId): void {
    const database = scope.has(databaseRootHostToken)
      ? scope.use(databaseRootHostToken)
      : scope.has(databaseHostToken)
        ? unwrapPluginDatabaseHost(scope.use(databaseHostToken))
        : undefined;
    if (database) {
      scope.provide(
        databaseHostToken,
        createPluginDatabaseHost(owner, database),
      );
    }
    const schedule = scope.has(scheduleRootHostToken)
      ? scope.use(scheduleRootHostToken)
      : scope.has(scheduleHostToken)
        ? unwrapPluginScheduleHost(scope.use(scheduleHostToken))
        : undefined;
    if (schedule) {
      scope.provide(
        scheduleHostToken,
        createPluginScheduleHost(owner, schedule),
      );
    }
  }
}

const rootGenerationAdmissionToken = createToken<GenerationAdmissionGate>(
  'zhin.runtime.root-generation-admission',
);

interface ModuleNamespace {
  readonly default?: unknown;
}

function isWithin(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}
