import { resolve } from 'node:path';
import type { CapabilityRoot } from '@zhin.js/feature-kit';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  capabilityId,
  createGenerationAdmissionGate,
  createToken,
  projectLocaleToken,
  resolveLocale,
  PluginDatabaseHost,
  PluginOutboundHost,
  PluginScheduleHost,
  databaseHostToken,
  databaseRootHostToken,
  outboundHostToken,
  outboundRootHostToken,
  featureId,
  rootPluginId,
  scheduleHostToken,
  scheduleRootHostToken,
  type CapabilityId,
  type ConfigView,
  type Dispose,
  type FeatureId,
  type GenerationHandoff,
  type GenerationAdmissionGate,
  type GenerationHandoffRegistry,
  type RuntimeSnapshot,
  type RuntimeConfigDocument,
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
  projectPrimaryConfigResources,
  primaryConfigToken,
  type PrimaryConfig,
} from './primary-config.js';

export interface PluginConfigResolver {
  (node: PluginGraphNode): unknown;
  schema?(node: PluginGraphNode): Readonly<Record<string, unknown>> | undefined;
  /** Set by RootRuntime's actual composition branch, not by Plugin config values. */
  compositionMode?: NonNullable<PrimaryConfig['compositionMode']>;
}

export interface RootResourceContext {
  /** Whether this generation has loaded a provider for the requested Feature. */
  readonly hasFeature?: (feature: FeatureId | string) => boolean;
  /** Exact shadow generation being assembled; never inferred from a latest snapshot. */
  readonly generation: number;
  /** Exact projected candidate, available during handoff activation, never the committed previous generation. */
  readonly readCandidateSnapshot?: () => RuntimeSnapshot;
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
  #candidateSnapshot?: RuntimeSnapshot;
  readonly #primaryConfig: PrimaryConfig;
  #setupFeatureAliases: ReadonlyMap<string, FeatureId> = new Map();
  #setupFeatureRoots: ReadonlyMap<FeatureId, readonly CapabilityRoot[]> = new Map();

  constructor(
    private readonly modules: ModuleRuntime,
    private readonly configResolver: PluginConfigResolver,
    private readonly environment: RuntimeEnvironment,
    primaryConfigDocument: RuntimeConfigDocument,
    private readonly generation: number,
    private readonly installResources?: RootResourceInstaller,
    environmentLayers: EnvironmentLayers = {},
    seed?: PluginAssemblySeed,
    private readonly isolation?: IsolatedPluginRuntimePort,
  ) {
    this.#envStores = new EnvStoreFactory(environment, environmentLayers);
    this.#primaryConfig = createPrimaryConfig(primaryConfigDocument, this.#envStores.create(rootPluginId()), configResolver.compositionMode);
    this.scopes = new Map(seed?.scopes);
    this.tree = new Map(seed?.tree);
    this.config = new Map(seed?.config);
    this.resources = projectPrimaryConfigResources(seed?.resources ?? new Map(), this.#primaryConfig);
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

  installSetupFeatureAliases(aliases: ReadonlyMap<string, FeatureId>, roots: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>): void {
    this.#setupFeatureAliases = new Map(aliases);
    this.#setupFeatureRoots = new Map(roots);
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
    // New setup operations shadow a retained parent's construction-time value;
    // operation contexts read the immutable projection from their own snapshot.
    scope.provide(primaryConfigToken, this.#primaryConfig);
    scope.provide(projectLocaleToken, resolveLocale(this.#primaryConfig.get('locale')));
    const register = <TDefinition>(
      feature: FeatureId | string,
      localName: string,
      capabilityDefinition: TDefinition,
    ): void => this.#registerSetupCapability(node, manifest, feature, localName, capabilityDefinition);

    if (!node.parent) {
      scope.provide(runtimeEnvironmentToken, this.environment);
      scope.provide(rootGenerationAdmissionToken, this.#admission);
      const config = this.#primaryConfig;
      await this.installResources?.({
        hasFeature: (feature) => this.#setupFeatureRoots.get(featureId(String(feature)))?.some(root => root.owner === node.id) ?? false,
        generation: this.generation,
        readCandidateSnapshot: () => {
          if (!this.#candidateSnapshot) throw new Error('Candidate snapshot is not projected yet');
          return this.#candidateSnapshot;
        },
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
    // Schema composition is Host-owned even when Plugin execution is isolated.
    // Commit the validated JSON declaration with both kinds of Plugin snapshot.
    const configSchema = this.configResolver.schema?.(node);
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
      metadata = mergePluginMetadata(manifest, prepared.descriptor.metadata, node.id);
    } else {
      const module = await this.modules.load<ModuleNamespace>(
        resolve(node.package.root, manifest.entry),
      );
      signal.throwIfAborted();
      const definition = module.default as PluginDefinition | undefined;
      if (!definition || typeof definition.name !== 'string') {
        throw new TypeError(`${node.package.name} does not default-export a Plugin definition`);
      }
      metadata = mergePluginMetadata(manifest, definition.metadata, node.id);
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
    }
    scope.seal();

    this.tree.set(node.id, Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      packageName: node.package.name,
      packageRoot: node.package.root,
      ...(typeof node.package.packageJson.version === 'string' ? { packageVersion: node.package.packageJson.version } : {}),
      parent: node.parent,
      children: Object.freeze(node.children.map((child) => child.id)),
      metadata,
      ...(configSchema ? { configSchema } : {}),
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

  bindCandidateSnapshot(snapshot: RuntimeSnapshot): void {
    if (snapshot.generation !== this.generation || this.#candidateSnapshot) {
      throw new Error('Candidate snapshot does not match this Plugin assembly');
    }
    this.#candidateSnapshot = snapshot;
  }

  generationHandoff(): GenerationHandoff | undefined {
    return this.#handoffs.seal();
  }

  setupCapabilities(): readonly Readonly<SetupCapabilityRegistration>[] {
    return Object.freeze([...this.#setupCapabilities.values()]);
  }

  /** Root resources are process-owned; every Plugin Scope receives an owner-bound facade. */
  private installOwnerScopedHosts(scope: Scope, owner: PluginId): void {
    const root = this.scopes.get(rootPluginId());
    if (!root) throw new Error('Missing root resource scope');
    // A retired subtree must close its facades even when the parent remains active.
    const admission = createGenerationAdmissionGate();
    if (root.has(outboundRootHostToken)) {
      scope.provide(outboundHostToken, new PluginOutboundHost(owner, root.use(outboundRootHostToken), admission));
    }
    const database = root.has(databaseRootHostToken)
      ? root.use(databaseRootHostToken)
      : undefined;
    if (database) {
      scope.provide(
        databaseHostToken,
        new PluginDatabaseHost(owner, database, admission),
      );
    }
    const schedule = root.has(scheduleRootHostToken)
      ? root.use(scheduleRootHostToken)
      : undefined;
    if (schedule) {
      scope.provide(
        scheduleHostToken,
        new PluginScheduleHost(owner, schedule, admission),
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

function mergePluginMetadata(
  manifest: ZhinPluginManifest,
  code: PluginDefinition['metadata'],
  owner: PluginId,
): PluginDefinition['metadata'] {
  for (const key of ['displayName', 'icon'] as const) {
    if (manifest.metadata?.[key] !== undefined && code?.[key] !== undefined) {
      throw new TypeError(`Plugin ${owner} declares metadata.${key} in both manifest and code`);
    }
  }
  return manifest.metadata || code ? Object.freeze({ ...code, ...manifest.metadata }) : undefined;
}
