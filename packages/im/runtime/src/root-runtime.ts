import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  DisposeStack,
  GenerationHandoffStack,
  RootController,
  createSnapshotView,
  rootPluginId,
  type CapabilityId,
  type CapabilitySlot,
  type ControlErrorHandler,
  type Dispose,
  type FeatureId,
  type GenerationCommitListener,
  type PluginId,
  type PreparedGeneration,
  type RuntimeSnapshot,
  type SnapshotReader,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  FeatureCatalog,
  FeatureDiscovery,
  type CapabilityRoot,
  type FeatureProvider,
} from '@zhin.js/feature-kit';
import type { ZhinFeatureManifest } from './manifest.js';
import { ConfigComposer, type RuntimeConfigDocument } from './config-composer.js';
import {
  ConfigDocumentDivergenceError,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type PreparedConfigDocument,
} from './config-document.js';
import {
  ConfigPatchPlanner,
  type ConfigPatch,
  type ConfigPatchPlan,
} from './config-patch-planner.js';
import { defineRuntimeEnvironment, type RuntimeEnvironment } from './environment.js';
import {
  createEnvStore,
  defineEnvironmentLayers,
  type EnvironmentLayers,
} from './environment-store.js';
import {
  FeatureProjector,
  composeGenerationHandoffs,
  type ProjectionState,
} from './feature-projector.js';
import { GenerationAssets } from './generation-assets.js';
import type { IsolatedPluginRuntimePort } from './isolation.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodeDiscoveryHost } from './node-discovery-host.js';
import { NodePackageResolver } from './package-resolver.js';
import {
  PluginScopeAssembler,
  type PluginConfigResolver,
  type RootResourceInstaller,
} from './plugin-scope-assembler.js';
import {
  ProjectGraphService,
  type PluginGraphNode,
  type ProjectGraph,
} from './project-graph.js';
import { HmrCoordinator, type HmrCoordinatorOptions } from './hmr-coordinator.js';
import type {
  GenerationInvalidationPlan,
  ProcessInvalidationPlan,
} from './invalidation-planner.js';
import {
  prepareRuntimeGeneration,
  type PreparedRuntimeGeneration,
  type RuntimeGenerationModel,
  type RuntimeGenerationState,
} from './runtime-generation.js';
import {
  RootProcessRestartExecutor,
  type ProcessRestartAdapter,
} from './process-restart.js';
import { SlotGenerationPreparer } from './slot-generation-preparer.js';
import {
  capabilityDeltaFromSlots,
  capabilityDeltaIds,
  ConventionCapabilityDeltaResolver,
  filterCapabilityDelta,
  mergeCapabilityDeltas,
  type CapabilityDelta,
} from './convention-capability-delta.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import {
  addCapabilitySlot,
  featureSetupAliases,
  mergeSetupCapabilities,
} from './setup-capabilities.js';
import {
  SubtreeGenerationPreparer,
  SubtreeTopologyChangedError,
} from './subtree-generation-preparer.js';
import { TopologyGenerationPreparer } from './topology-generation-preparer.js';
import { RestartBoundaryPlanner } from './restart-boundary.js';

export type {
  PluginConfigResolver,
  RootResourceContext,
  RootResourceInstaller,
} from './plugin-scope-assembler.js';

export interface RootRuntimeOptions {
  readonly projectRoot: string;
  readonly modules: ModuleRuntime;
  readonly environment: RuntimeEnvironment;
  readonly environmentVariables?: EnvironmentLayers;
  readonly config?: PluginConfigResolver | RuntimeConfigDocument | ConfigDocumentPort;
  readonly installResources?: RootResourceInstaller;
  readonly isolation?: IsolatedPluginRuntimePort;
  readonly onControlError?: ControlErrorHandler;
}

export type RootHmrOptions = Omit<HmrCoordinatorOptions, 'modules' | 'ownership' | 'runtime'>;

interface InspectedProject {
  readonly graph: ProjectGraph;
  readonly configResolver: PluginConfigResolver;
  readonly primaryConfigDocument: RuntimeConfigDocument;
}

export class RootRuntime {
  readonly #projectRoot: string;
  readonly #modules: ModuleRuntime;
  readonly #environment: RuntimeEnvironment;
  readonly #environmentLayers: Readonly<EnvironmentLayers>;
  readonly #configResolver?: PluginConfigResolver;
  readonly #configPort?: ConfigDocumentPort;
  #configSnapshot?: ConfigDocumentSnapshot;
  #configDocument?: RuntimeConfigDocument;
  readonly #installResources?: RootResourceInstaller;
  readonly #isolation?: IsolatedPluginRuntimePort;
  #configPatchTail: Promise<unknown> = Promise.resolve();
  #stopResult?: Promise<void>;
  readonly #controller: RootController<RuntimeGenerationState>;

  constructor(options: RootRuntimeOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#modules = options.modules;
    this.#environment = defineRuntimeEnvironment(options.environment);
    this.#environmentLayers = defineEnvironmentLayers(options.environmentVariables);
    if (typeof options.config === 'function') this.#configResolver = options.config;
    else if (isConfigDocumentPort(options.config)) this.#configPort = options.config;
    else this.#configDocument = structuredClone(options.config ?? {});
    this.#installResources = options.installResources;
    this.#isolation = options.isolation;
    this.#controller = new RootController(
      emptyState(),
      options.onControlError,
      Object.freeze({ ownership: SourceOwnershipIndex.empty() }),
    );
  }

  get snapshot(): RuntimeSnapshot {
    return this.#controller.snapshot;
  }

  get snapshots(): SnapshotReader {
    return this.#controller.snapshots;
  }

  onGenerationCommit(listener: GenerationCommitListener<RuntimeGenerationState>): () => void {
    return this.#controller.onGenerationCommit(listener);
  }

  get sourceOwnership(): SourceOwnershipIndex {
    return this.#controller.committed.state.ownership;
  }

  async start(): Promise<RuntimeSnapshot> {
    if (this.#configPort) {
      const snapshot = await this.#configPort.read();
      this.#configSnapshot = snapshot;
      this.#configDocument = structuredClone(snapshot.document);
    }
    const snapshot = await this.#controller.start(async (current, signal) => {
      return (await this.#prepare(current, signal)).generation;
    });
    return snapshot;
  }

  async reload(target: PluginId | string = rootPluginId()): Promise<RuntimeSnapshot> {
    const snapshot = await this.#controller.reload(target, async (current, signal) => {
      return (await this.#prepare(current, signal)).generation;
    });
    return snapshot;
  }

  patchConfig(patches: readonly ConfigPatch[]): Promise<RuntimeSnapshot> {
    const operations = cloneConfigPatches(patches);
    const result = this.#configPatchTail.then(
      () => this.#applyConfigPatches(operations),
      () => this.#applyConfigPatches(operations),
    );
    this.#configPatchTail = result.catch(() => undefined);
    return result;
  }

  createHmrCoordinator(options: RootHmrOptions): HmrCoordinator {
    return new HmrCoordinator({
      ...options,
      modules: this.#modules,
      ownership: () => this.sourceOwnership,
      runtime: {
        reload: async (plan) => {
          const result = await this.#reloadPlan(plan);
          return isProcessPlan(result) ? result : undefined;
        },
      },
    });
  }

  createProcessRestartExecutor(adapter: ProcessRestartAdapter): RootProcessRestartExecutor {
    return new RootProcessRestartExecutor(this, adapter);
  }

  stop(): Promise<void> {
    if (this.#stopResult) return this.#stopResult;
    const result = (async () => {
      try {
        await this.#controller.stop();
      } finally {
        await this.#modules.close();
      }
    })();
    this.#stopResult = result;
    return result;
  }

  async #reloadPlan(
    plan: GenerationInvalidationPlan,
  ): Promise<RuntimeSnapshot | ProcessInvalidationPlan> {
    let restart: ProcessInvalidationPlan | undefined;
    const snapshot = await this.#controller.reload(
      plan.subtrees[0] ?? plan.slots[0] ?? rootPluginId(),
      async (current, signal) => {
        let prepared: PreparedRuntimeGeneration | undefined;
        const resolved = await this.#resolveCapabilityDelta(current, plan);
        const effective = resolved.plan;
        if (this.#model && effective.manifestSources.length > 0) {
          const inspected = await this.#inspectProject();
          restart = new RestartBoundaryPlanner().plan(
            this.#model.graph,
            inspected.graph,
            effective.changed,
          );
          if (restart) return undefined;
          prepared = effective.subtrees.includes(rootPluginId())
            ? await this.#prepareInspected(current, inspected, signal)
            : await new TopologyGenerationPreparer(
              this.#modules,
              this.#model,
              inspected.graph,
              inspected.configResolver,
              inspected.primaryConfigDocument,
              this.#environment,
              this.#installResources,
              this.#environmentLayers,
              this.#isolation,
            ).prepare(current, signal, { ...effective, capabilities: resolved.capabilities });
        } else if (effective.subtrees.length === 0 && resolved.capabilities.size > 0 && this.#model) {
          prepared = await new SlotGenerationPreparer(this.#modules, this.#model)
            .prepare(current, resolved.capabilities, signal);
        } else if (this.#model && this.#canPrepareSubtrees(effective)) {
          const inspected = await this.#inspectProject();
          prepared = await this.#prepareSubtrees(current, inspected, effective.subtrees, signal);
        } else {
          prepared = await this.#prepare(current, signal);
        }
        return prepared?.generation;
      },
    );
    if (restart) return restart;
    return snapshot;
  }

  get #model(): RuntimeGenerationModel | undefined {
    return this.#controller.committed.state.model;
  }

  async #resolveCapabilityDelta(
    current: RuntimeSnapshot,
    plan: GenerationInvalidationPlan,
  ): Promise<{ readonly plan: GenerationInvalidationPlan; readonly capabilities: CapabilityDelta }> {
    const known = capabilityDeltaFromSlots(current, plan.slots);
    if (!this.#model || (plan.fallbacks.length === 0 && plan.slots.length === 0)) {
      return { plan, capabilities: known };
    }
    const discovered = await new ConventionCapabilityDeltaResolver(
      this.#modules,
      this.#model,
      current,
    ).resolve(plan.fallbacks, plan.slots);
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

  #canPrepareSubtrees(plan: GenerationInvalidationPlan): boolean {
    if (plan.subtrees.length === 0 || plan.subtrees.includes(rootPluginId())) return false;
    return plan.changed.every((source) => {
      const records = this.sourceOwnership.recordsFor(source);
      return records.length > 0 && records.every(
        (record) => record.role === 'plugin' || record.role === 'schema',
      );
    });
  }

  async #prepare(
    current: RuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    const inspected = await this.#inspectProject();
    signal.throwIfAborted();
    return this.#prepareInspected(current, inspected, signal);
  }

  async #inspectProject(): Promise<InspectedProject> {
    const resolver = await NodePackageResolver.create(this.#projectRoot);
    const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
    await this.#refreshConfigDocument();
    if (this.#configResolver) {
      return {
        graph,
        configResolver: this.#configResolver,
        primaryConfigDocument: Object.freeze({}),
      };
    }
    const composed = await new ConfigComposer().compose(graph, this.#configDocument);
    return {
      graph,
      configResolver: this.#configViewResolver(composed.views),
      primaryConfigDocument: composed.document,
    };
  }

  /**
   * The config file itself is watched, so an external edit triggers a full
   * reload. Re-read through the port before composing: without this the reload
   * would rebuild the whole generation from the stale in-memory document read
   * at start, the edit would silently not apply, and the next patchConfig
   * would hit a revision conflict. On drift the file is authoritative.
   */
  async #refreshConfigDocument(): Promise<void> {
    if (!this.#configPort) return;
    const snapshot = await this.#configPort.read();
    if (snapshot.revision === this.#configSnapshot?.revision) return;
    this.#configSnapshot = snapshot;
    this.#configDocument = structuredClone(snapshot.document);
  }

  #configViewResolver(
    views: ReadonlyMap<PluginId, unknown>,
  ): PluginConfigResolver {
    const env = createEnvStore(rootPluginId(), this.#environment, this.#environmentLayers);
    return (node) => {
      const view = views.get(node.id);
      if (view === undefined) return undefined;
      return env.expandMissingAsEmpty(view);
    };
  }

  async #applyConfigPatches(patches: readonly ConfigPatch[]): Promise<RuntimeSnapshot> {
    if (!this.#configDocument) {
      throw new Error('Config patches require a document-backed RootRuntime config');
    }
    // Adopt any external edit before planning so the port's revision check
    // cannot conflict and the patch applies on top of the on-disk document.
    await this.#refreshConfigDocument();
    const currentDocument = requireConfigDocument(this.#configDocument);
    let plan: ConfigPatchPlan | undefined;
    let documentTransaction: PreparedConfigDocument | undefined;
    let committedDocument: ConfigDocumentSnapshot | undefined;
    const snapshot = await this.#controller.reload(rootPluginId(), async (current, signal) => {
      let prepared: PreparedRuntimeGeneration;
      signal.throwIfAborted();
      const resolver = await NodePackageResolver.create(this.#projectRoot);
      const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
      const planned = await new ConfigPatchPlanner().plan(graph, currentDocument, patches);
      plan = planned;
      if (!planned.documentChanged) return undefined;
      try {
        if (this.#configPort) {
          const currentSnapshot = requireConfigDocumentSnapshot(this.#configSnapshot);
          // Port preparation must remain inert; validation and shadow setup can
          // still reject this candidate without touching the backing document.
          documentTransaction = await this.#configPort.prepare(currentSnapshot, patches);
          if (!isDeepStrictEqual(documentTransaction.document, planned.candidate)) {
            throw new ConfigDocumentDivergenceError();
          }
        }
        // Host-level sections (http/database/ai/...) never land in a Plugin
        // view, so their patches plan zero roots. With a Root Resource
        // installer the whole generation must still be rebuilt; only an
        // installer-less runtime may take the commit-only shortcut.
        if (!this.#installResources && planned.roots.length === 0) {
          if (documentTransaction) committedDocument = await documentTransaction.commit();
          return undefined;
        }
        const inspected: InspectedProject = {
          graph,
          configResolver: this.#configViewResolver(planned.views),
          primaryConfigDocument: planned.document,
        };
        // Root resources may consume any Primary Config section. Reinstall them
        // when present so a committed patch cannot leave Host services on the
        // previous generation's document.
        if (!this.#installResources && this.#model && !planned.roots.includes(rootPluginId())) {
          prepared = await this.#prepareSubtrees(current, inspected, planned.roots, signal);
        } else {
          prepared = await this.#prepareInspected(current, inspected, signal);
        }
        return documentTransaction
          ? withConfigDocumentHandoff(
              prepared.generation,
              documentTransaction,
              (committed) => { committedDocument = committed; },
            )
          : prepared.generation;
      } catch (error) {
        // A prepared document transaction is inert until handoff; roll it back
        // before any shadow-phase failure escapes so the port never leaks a
        // pending write.
        if (documentTransaction) await documentTransaction.rollback().catch(() => undefined);
        throw error;
      }
    });
    const completed = requireConfigPatchPlan(plan);
    this.#configDocument = completed.candidate;
    if (committedDocument) this.#configSnapshot = committedDocument;
    return snapshot;
  }

  #prepareInspected(
    current: RuntimeSnapshot,
    inspected: InspectedProject,
    signal: AbortSignal,
  ): Promise<PreparedRuntimeGeneration> {
    const assembler = new GenerationAssembler(
      inspected.graph,
      this.#modules,
      inspected.configResolver,
      inspected.primaryConfigDocument,
      current.generation + 1,
      this.#environment,
      this.#installResources,
      this.#environmentLayers,
      this.#isolation,
    );
    return assembler.prepare(signal);
  }

  async #prepareSubtrees(
    current: RuntimeSnapshot,
    inspected: InspectedProject,
    roots: readonly PluginId[],
    signal: AbortSignal,
  ): Promise<PreparedRuntimeGeneration> {
    if (!this.#model) return this.#prepareInspected(current, inspected, signal);
    try {
      return await new SubtreeGenerationPreparer(
        this.#modules,
        this.#model,
        inspected.graph,
        inspected.configResolver,
        inspected.primaryConfigDocument,
        this.#environment,
        this.#installResources,
        this.#environmentLayers,
        this.#isolation,
      ).prepare(current, roots, signal);
    } catch (error) {
      if (!(error instanceof SubtreeTopologyChangedError)) throw error;
      return this.#prepareInspected(current, inspected, signal);
    }
  }
}

function collapseInvalidationSubtrees(values: readonly PluginId[]): readonly PluginId[] {
  const sorted = [...new Set(values)].sort((left, right) => left.length - right.length);
  return Object.freeze(sorted.filter((candidate, index) =>
    !sorted.slice(0, index).some((root) => isWithinInvalidationRoot(candidate, root)),
  ));
}

function isWithinInvalidationRoot(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}

function withConfigDocumentHandoff<TState>(
  generation: PreparedGeneration<TState>,
  document: PreparedConfigDocument,
  committed: (snapshot: ConfigDocumentSnapshot) => void,
): PreparedGeneration<TState> {
  const handoffs = new GenerationHandoffStack();
  if (generation.handoff) handoffs.add(generation.handoff);
  // File commit follows Resource activation, so reverse compensation restores
  // the document before it deactivates the shadow generation.
  handoffs.add({
    async activateNext(signal) {
      signal.throwIfAborted();
      committed(await document.commit());
      signal.throwIfAborted();
    },
    deactivateNext: () => document.rollback(),
  });
  return { ...generation, handoff: handoffs.seal() };
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function' && typeof candidate.prepare === 'function';
}

function requireConfigDocumentSnapshot(
  snapshot: ConfigDocumentSnapshot | undefined,
): ConfigDocumentSnapshot {
  if (!snapshot) throw new Error('ConfigDocumentPort has not been read');
  return snapshot;
}

function requireConfigDocument(
  document: RuntimeConfigDocument | undefined,
): RuntimeConfigDocument {
  if (!document) throw new Error('Config patches require a document-backed RootRuntime config');
  return document;
}

function cloneConfigPatches(patches: readonly ConfigPatch[]): readonly ConfigPatch[] {
  return Object.freeze(patches.map((patch) => Object.freeze(
    patch.op === 'set'
      ? { ...patch, path: Object.freeze([...patch.path]), value: structuredClone(patch.value) }
      : { ...patch, path: Object.freeze([...patch.path]) },
  )));
}

function requireConfigPatchPlan(plan: ConfigPatchPlan | undefined): ConfigPatchPlan {
  if (!plan) throw new Error('RootController completed without a Config patch plan');
  return plan;
}

class GenerationAssembler {
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
    private readonly configResolver: PluginConfigResolver,
    private readonly primaryConfigDocument: RuntimeConfigDocument,
    private readonly generation: number,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
    private readonly environmentLayers: EnvironmentLayers = {},
    private readonly isolation?: IsolatedPluginRuntimePort,
  ) {
    this.#host = new NodeDiscoveryHost(modules);
    this.#plugins = new PluginScopeAssembler(
      modules,
      configResolver,
      environment,
      primaryConfigDocument,
      installResources,
      environmentLayers,
      undefined,
      isolation,
    );
  }

  async prepare(signal: AbortSignal): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    try {
      // Prepare is deliberately ordered: providers define discovery, setup
      // creates owner scopes, then definitions can be projected against both.
      await this.#loadProviders(this.graph.root, signal);
      this.#plugins.installSetupFeatureAliases(featureSetupAliases(this.#catalog.values()));
      await this.#plugins.setupTree(this.graph.root, signal);
      await this.#discover(signal);
      const projected = await new FeatureProjector(this.#catalog.values())
        .project(this.generation, this.#projectionState(), signal);
      for (const [feature, dispose] of projected.disposers) {
        this.#projectionDisposers.set(feature, dispose);
      }
      const state = projected.state;
      const snapshot = createSnapshotView(this.generation, state);
      const ownership = SourceOwnershipIndex.fromGeneration(
        this.graph,
        snapshot,
        this.#featureIdsByPackageRoot,
      );
      const assets = GenerationAssets.create(
        this.#plugins.createdScopeDisposers(),
        this.#projectionDisposers,
      );
      return prepareRuntimeGeneration(
        {
          snapshot: state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(
            this.#plugins.generationHandoff(),
            projected.handoff,
          ),
        },
        ownership,
        {
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
      const module = await this.modules.load<ModuleNamespace>(
        resolve(requirement.package.root, manifest.entry),
      );
      signal.throwIfAborted();
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


function isProcessPlan(
  value: RuntimeSnapshot | ProcessInvalidationPlan,
): value is ProcessInvalidationPlan {
  return 'kind' in value && value.kind === 'process';
}

async function disposePreparedParts(
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
      throw new AggregateError(
        [prepareError, disposeError],
        'Generation prepare and rollback both failed',
        { cause: disposeError },
      );
    }
    throw disposeError;
  }
}
