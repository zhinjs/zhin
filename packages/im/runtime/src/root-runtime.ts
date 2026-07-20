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
  type PluginId,
  type PreparedGeneration,
  type RuntimeSnapshot,
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
import { ProjectGraphService, type PluginGraphNode, type ProjectGraph } from './project-graph.js';
import { HmrCoordinator, type HmrCoordinatorOptions } from './hmr-coordinator.js';
import type {
  GenerationInvalidationPlan,
  ProcessInvalidationPlan,
} from './invalidation-planner.js';
import type {
  PreparedRuntimeGeneration,
  RuntimeGenerationModel,
} from './runtime-generation.js';
import {
  RootProcessRestartExecutor,
  type ProcessRestartAdapter,
} from './process-restart.js';
import { SlotGenerationPreparer } from './slot-generation-preparer.js';
import { SourceOwnershipIndex } from './source-ownership.js';
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
}

export class RootRuntime {
  readonly controller: RootController;
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
  #ownership = SourceOwnershipIndex.empty();
  #model?: RuntimeGenerationModel;
  #configPatchTail: Promise<unknown> = Promise.resolve();

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
    this.controller = new RootController(emptyState(), options.onControlError);
  }

  get snapshot(): RuntimeSnapshot {
    return this.controller.snapshots.current;
  }

  get sourceOwnership(): SourceOwnershipIndex {
    return this.#ownership;
  }

  async start(): Promise<RuntimeSnapshot> {
    if (this.#configPort) {
      const snapshot = await this.#configPort.read();
      this.#configSnapshot = snapshot;
      this.#configDocument = structuredClone(snapshot.document);
    }
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
      ownership: () => this.#ownership,
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

  async stop(): Promise<void> {
    try {
      await this.controller.stop();
    } finally {
      await this.#modules.close();
    }
  }

  async #reloadPlan(
    plan: GenerationInvalidationPlan,
  ): Promise<RuntimeSnapshot | ProcessInvalidationPlan> {
    let prepared: PreparedRuntimeGeneration | undefined;
    let restart: ProcessInvalidationPlan | undefined;
    const snapshot = await this.controller.reload(
      plan.subtrees[0] ?? plan.slots[0] ?? rootPluginId(),
      async (current) => {
        if (this.#model && this.#isManifestTopologyPlan(plan)) {
          const inspected = await this.#inspectProject();
          restart = new RestartBoundaryPlanner().plan(
            this.#model.graph,
            inspected.graph,
            plan.changed,
          );
          if (restart) return undefined;
          prepared = await new TopologyGenerationPreparer(
            this.#modules,
            this.#model,
            inspected.graph,
            inspected.configResolver,
            this.#environment,
            this.#installResources,
            this.#environmentLayers,
            this.#isolation,
          ).prepare(current);
        } else if (plan.subtrees.length === 0 && plan.slots.length > 0 && this.#model) {
          prepared = await new SlotGenerationPreparer(this.#modules, this.#model)
            .prepare(current, plan.slots);
        } else if (this.#model && this.#canPrepareSubtrees(plan)) {
          const inspected = await this.#inspectProject();
          prepared = await this.#prepareSubtrees(current, inspected, plan.subtrees);
        } else {
          prepared = await this.#prepare(current);
        }
        return prepared?.generation;
      },
    );
    if (restart) return restart;
    if (prepared) this.#accept(prepared);
    return snapshot;
  }

  #isManifestTopologyPlan(plan: GenerationInvalidationPlan): boolean {
    let manifest = false;
    for (const source of plan.changed) {
      const records = this.#ownership.recordsFor(source);
      if (records.some((record) => record.role === 'manifest')) manifest = true;
      if (records.some((record) => record.role !== 'manifest')) return false;
    }
    return manifest;
  }

  #accept(prepared: PreparedRuntimeGeneration): void {
    this.#ownership = prepared.ownership;
    this.#model = prepared.model;
  }

  #canPrepareSubtrees(plan: GenerationInvalidationPlan): boolean {
    if (plan.subtrees.length === 0 || plan.subtrees.includes(rootPluginId())) return false;
    return plan.changed.every((source) => {
      const records = this.#ownership.recordsFor(source);
      return records.length > 0 && records.every(
        (record) => record.role === 'plugin' || record.role === 'schema',
      );
    });
  }

  async #prepare(current: RuntimeSnapshot): Promise<PreparedRuntimeGeneration> {
    return this.#prepareInspected(current, await this.#inspectProject());
  }

  async #inspectProject(): Promise<InspectedProject> {
    const resolver = await NodePackageResolver.create(this.#projectRoot);
    const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
    const configResolver =
      this.#configResolver
        ? this.#configResolver
        : await new ConfigComposer()
            .compose(graph, this.#configDocument)
            .then((composed) => this.#configViewResolver(composed.views));
    return { graph, configResolver };
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
    const currentDocument = this.#configDocument;
    let plan: ConfigPatchPlan | undefined;
    let prepared: PreparedRuntimeGeneration | undefined;
    let documentTransaction: PreparedConfigDocument | undefined;
    let committedDocument: ConfigDocumentSnapshot | undefined;
    const snapshot = await this.controller.reload(rootPluginId(), async (current) => {
      const resolver = await NodePackageResolver.create(this.#projectRoot);
      const graph = await new ProjectGraphService(resolver).inspect(this.#projectRoot);
      const planned = await new ConfigPatchPlanner().plan(graph, currentDocument, patches);
      plan = planned;
      if (!planned.documentChanged) return undefined;
      if (this.#configPort) {
        const currentSnapshot = requireConfigDocumentSnapshot(this.#configSnapshot);
        // Port preparation must remain inert; validation and shadow setup can
        // still reject this candidate without touching the backing document.
        documentTransaction = await this.#configPort.prepare(currentSnapshot, patches);
        if (!isDeepStrictEqual(documentTransaction.document, planned.candidate)) {
          throw new ConfigDocumentDivergenceError();
        }
      }
      if (planned.roots.length === 0) {
        if (documentTransaction) committedDocument = await documentTransaction.commit();
        return undefined;
      }
      const inspected: InspectedProject = {
        graph,
        configResolver: this.#configViewResolver(planned.views),
      };
      if (this.#model && !planned.roots.includes(rootPluginId())) {
        prepared = await this.#prepareSubtrees(current, inspected, planned.roots);
      } else {
        prepared = await this.#prepareInspected(current, inspected);
      }
      return documentTransaction
        ? withConfigDocumentHandoff(
            prepared.generation,
            documentTransaction,
            (committed) => { committedDocument = committed; },
          )
        : prepared.generation;
    });
    const completed = requireConfigPatchPlan(plan);
    if (prepared) this.#accept(prepared);
    this.#configDocument = completed.candidate;
    if (committedDocument) this.#configSnapshot = committedDocument;
    return snapshot;
  }

  #prepareInspected(
    current: RuntimeSnapshot,
    inspected: InspectedProject,
  ): Promise<PreparedRuntimeGeneration> {
    const assembler = new GenerationAssembler(
      inspected.graph,
      this.#modules,
      inspected.configResolver,
      current.generation + 1,
      this.#environment,
      this.#installResources,
      this.#environmentLayers,
      this.#isolation,
    );
    return assembler.prepare();
  }

  async #prepareSubtrees(
    current: RuntimeSnapshot,
    inspected: InspectedProject,
    roots: readonly PluginId[],
  ): Promise<PreparedRuntimeGeneration> {
    if (!this.#model) return this.#prepareInspected(current, inspected);
    try {
      return await new SubtreeGenerationPreparer(
        this.#modules,
        this.#model,
        inspected.graph,
        inspected.configResolver,
        this.#environment,
        this.#installResources,
        this.#environmentLayers,
        this.#isolation,
      ).prepare(current, roots);
    } catch (error) {
      if (!(error instanceof SubtreeTopologyChangedError)) throw error;
      return this.#prepareInspected(current, inspected);
    }
  }
}

function withConfigDocumentHandoff(
  generation: PreparedGeneration,
  document: PreparedConfigDocument,
  committed: (snapshot: ConfigDocumentSnapshot) => void,
): PreparedGeneration {
  const handoffs = new GenerationHandoffStack();
  if (generation.handoff) handoffs.add(generation.handoff);
  // File commit follows Resource activation, so reverse compensation restores
  // the document before it deactivates the shadow generation.
  handoffs.add({
    async activateNext() {
      committed(await document.commit());
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
  readonly #projectionDisposers: Dispose[] = [];
  readonly #host: NodeDiscoveryHost;
  readonly #plugins: PluginScopeAssembler;

  constructor(
    private readonly graph: ProjectGraph,
    private readonly modules: ModuleRuntime,
    private readonly configResolver: PluginConfigResolver,
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
      installResources,
      environmentLayers,
      undefined,
      isolation,
    );
  }

  async prepare(): Promise<PreparedRuntimeGeneration> {
    try {
      // Prepare is deliberately ordered: providers define discovery, setup
      // creates owner scopes, then definitions can be projected against both.
      await this.#loadProviders(this.graph.root);
      await this.#plugins.setupTree(this.graph.root);
      await this.#discover();
      const projected = await new FeatureProjector(this.#catalog.values())
        .project(this.generation, this.#projectionState());
      this.#projectionDisposers.push(...projected.disposers);
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
      return {
        generation: {
          snapshot: state,
          dispose: () => assets.dispose(),
          handoff: composeGenerationHandoffs(
            this.#plugins.generationHandoff(),
            projected.handoff,
          ),
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
          scopes: new Map(this.#plugins.scopes),
          assets,
        },
      };
    } catch (error) {
      await disposePreparedParts(
        this.#plugins.createdScopeDisposers().map(([, dispose]) => dispose),
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

  async #discover(): Promise<void> {
    const discovery = new FeatureDiscovery(this.#host);
    for (const provider of this.#catalog.values()) {
      const roots = this.#rootsByFeature.get(provider.id) ?? [];
      const slots = await discovery.discover(provider, roots);
      for (const slot of slots) this.#capabilities.set(slot.id, slot);
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

function requirePrepared(
  prepared: PreparedRuntimeGeneration | undefined,
): PreparedRuntimeGeneration {
  if (!prepared) throw new Error('RootController committed without a prepared generation');
  return prepared;
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
