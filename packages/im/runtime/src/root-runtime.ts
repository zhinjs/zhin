import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  applyConfigPatches, ConfigDocumentDivergenceError, RootController, rootPluginId,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch,
  type ControlErrorHandler, type FeatureId, type GenerationCommitListener,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot,
  type SnapshotReader, type Token,
} from '@zhin.js/plugin-runtime';
import { HOST_RESOURCE_CONFIG_KEYS, type JsonSchema } from './config-composer.js';
import type {
  ConfigApplicationGroup, ConfigApplicationResult, RootConfigUpdateHandler,
  RootPluginConfigurationSelection, RuntimeControlContext,
} from './configuration-application.js';
import { copyConfigurationPaths } from './configuration-paths.js';
import { defineRuntimeEnvironment, type RuntimeEnvironment } from './environment.js';
import {
  defineEnvironmentLayers, type EnvironmentLayers, type EnvironmentLayersPort,
} from './environment-store.js';
import { HmrCoordinator, type HmrCoordinatorOptions } from './hmr-coordinator.js';
import type { GenerationInvalidationPlan, ProcessInvalidationPlan } from './invalidation-planner.js';
import type { IsolatedPluginRuntimePort } from './isolation.js';
import type { ManifestWarning } from './manifest.js';
import type { ModuleRuntime } from './module-runtime.js';
import { emitManifestWarning } from './package-resolver.js';
import type { PluginConfigResolver, RootResourceInstaller } from './plugin-scope-assembler.js';
import { RootProcessRestartExecutor, type ProcessRestartAdapter } from './process-restart.js';
import {
  bindConfigurationResources, cloneConfigPatches, ConfigurationSupersededError,
  guardConfigurationSource, inspectRuntimeProject, isConfigDocumentPort,
  patchedPluginOrder, planRuntimeInputs, preparedConfigurationGroups,
  rejectedApplicationGroups, requireConfigDocumentSnapshot, selectPluginConfiguration,
  validateConfigUpdateHandlerDeclarations, validateConfigurationHandlers,
  type ConfigurationHandlerContext, type InspectedProject,
  type RuntimeInputCandidate, type RuntimeInputState,
} from './root-runtime-config.js';
import {
  emptyState, executeReloadWithEvents, GenerationAssembler,
  describeHmrReload, isProcessPlan, prepareInvalidatedGeneration,
  type HmrReloadReport, type PreparedRebuild, type ReloadEventRequest, type SubtreePreparation,
} from './root-runtime-diagnostics.js';
import { projectFileWatchesOf } from './project-file-watches.js';
import type {
  PreparedRuntimeGeneration, RuntimeGenerationModel, RuntimeGenerationState,
} from './runtime-generation.js';
import { SourceOwnershipIndex } from './source-ownership.js';
import { normalizeSourcePath } from './source-path.js';
import { SubtreeGenerationPreparer, SubtreeTopologyChangedError } from './subtree-generation-preparer.js';
import { TopologyGenerationPreparer } from './topology-generation-preparer.js';

export type {
  PluginConfigResolver,
  RootResourceContext,
  RootResourceInstaller,
} from './plugin-scope-assembler.js';
export { ConfigurationSupersededError } from './root-runtime-config.js';

export interface RootRuntimeOptions {
  readonly projectRoot: string;
  readonly modules: ModuleRuntime;
  readonly environment: RuntimeEnvironment;
  readonly environmentVariables?: EnvironmentLayers;
  readonly environmentSource?: EnvironmentLayersPort;
  readonly config?: PluginConfigResolver | RuntimeConfigDocument | ConfigDocumentPort;
  /** Explicit v2 instance declaration when config is supplied by a custom resolver. */
  readonly application?: RuntimeConfigDocument;
  readonly installResources?: RootResourceInstaller;
  readonly isolation?: IsolatedPluginRuntimePort;
  readonly onControlError?: ControlErrorHandler;
  readonly disabledPluginInstanceKeys?: readonly string[];
  readonly configUpdates?: readonly RootConfigUpdateHandler[];
  readonly pluginConfigurationSelection?: RootPluginConfigurationSelection;
  /**
   * Receives manifest problems the loader tolerates (invalid marketplace-only metadata, unknown
   * display-name locales), once per distinct problem for this runtime. Defaults to a Node process
   * warning (`ZhinManifestWarning`).
   */
  readonly onManifestWarning?: (warning: ManifestWarning) => void;
}

export type RootHmrOptions = Omit<HmrCoordinatorOptions, 'modules' | 'ownership' | 'runtime'>;

export class RootRuntime {
  readonly #projectRoot: string;
  readonly #modules: ModuleRuntime;
  readonly #environment: RuntimeEnvironment;
  #environmentLayers: Readonly<EnvironmentLayers>;
  readonly #environmentSource?: EnvironmentLayersPort;
  readonly #runtimeInputSources: ReadonlySet<string>;
  readonly #configResolver?: PluginConfigResolver;
  readonly #configPort?: ConfigDocumentPort;
  #configSnapshot?: ConfigDocumentSnapshot;
  #configDocument?: RuntimeConfigDocument;
  #desiredDocument?: RuntimeConfigDocument;
  readonly #installResources?: RootResourceInstaller;
  readonly #isolation?: IsolatedPluginRuntimePort;
  #controlTail: Promise<unknown> = Promise.resolve();
  readonly #controlExecution = new AsyncLocalStorage<{ active: boolean }>();
  #stopResult?: Promise<void>;
  #initialConfigSchemas: ReadonlyMap<string, JsonSchema> = new Map();
  #resolveConfigurationReady!: () => void;
  #rejectConfigurationReady!: (reason: unknown) => void;
  readonly #configurationReady = new Promise<void>((resolve, reject) => {
    this.#resolveConfigurationReady = resolve;
    this.#rejectConfigurationReady = reject;
  });
  readonly #controller: RootController<RuntimeGenerationState>;
  readonly #disabledPluginInstanceKeys: readonly string[];
  readonly #onControlError: ControlErrorHandler;
  readonly #onManifestWarning: (warning: ManifestWarning) => void;
  readonly #configUpdates: readonly RootConfigUpdateHandler[];
  readonly #pluginConfigurationSelection?: RootPluginConfigurationSelection;
  readonly #controlContexts = new WeakSet<RuntimeControlContext>();
  #applicationRevision = 0;
  #operationSequence = 0;
  readonly #operationNamespace = randomUUID();
  #configurationApplication: ConfigApplicationResult = Object.freeze({
    operationId: `config:${this.#operationNamespace}:0`, sourceRevision: '', saved: false,
    generation: 0, applicationRevision: 0, groups: Object.freeze([]),
  });

  constructor(options: RootRuntimeOptions) {
    this.#pluginConfigurationSelection = options.pluginConfigurationSelection;
    this.#configUpdates = Object.freeze([...(options.configUpdates ?? [])]);
    validateConfigUpdateHandlerDeclarations(this.#configUpdates);
    this.#onControlError = options.onControlError ?? (() => undefined);
    // Project inspection repeats on every reload: report each distinct manifest problem once.
    const reportedManifestWarnings = new Set<string>();
    const manifestWarningSink = options.onManifestWarning ?? emitManifestWarning;
    this.#onManifestWarning = (warning) => {
      const key = `${warning.source}\u0000${warning.message}`;
      if (reportedManifestWarnings.has(key)) return;
      reportedManifestWarnings.add(key);
      manifestWarningSink(warning);
    };
    void this.#configurationReady.catch(() => undefined);
    this.#projectRoot = normalizeSourcePath(options.projectRoot);
    this.#modules = options.modules;
    this.#environment = defineRuntimeEnvironment(options.environment);
    this.#environmentLayers = defineEnvironmentLayers(options.environmentVariables);
    this.#environmentSource = options.environmentSource;
    if (options.application !== undefined && typeof options.config !== 'function') {
      throw new TypeError('application is only used with a custom config resolver; pass the v2 document as config otherwise');
    }
    if (typeof options.config === 'function') {
      this.#configResolver = options.config;
      this.#configDocument = structuredClone(options.application ?? {});
    } else if (isConfigDocumentPort(options.config)) this.#configPort = options.config;
    else this.#configDocument = structuredClone(options.config ?? {});
    this.#runtimeInputSources = new Set([
      ...(this.#configPort?.sources ?? []),
      ...(this.#environmentSource?.sources ?? []),
    ].map((source) => normalizeSourcePath(source)));
    this.#installResources = options.installResources;
    this.#isolation = options.isolation;
    this.#disabledPluginInstanceKeys = Object.freeze([...(options.disabledPluginInstanceKeys ?? [])]);
    this.#controller = new RootController<RuntimeGenerationState>(
      emptyState(),
      options.onControlError,
      Object.freeze({ ownership: SourceOwnershipIndex.empty() }),
      (state, root, token) => {
        if (state.rootResources?.has(token)) return state.rootResources.get(token);
        const scope = state.model?.scopes.get(root);
        return scope?.has(token) ? scope.use(token) : undefined;
      },
    );
  }

  get snapshot(): RuntimeSnapshot { return this.#controller.snapshot; }
  get snapshots(): SnapshotReader { return this.#controller.snapshots; }
  get configurationApplication(): ConfigApplicationResult { return this.#configurationApplication; }
  isConfigurationSource(source: string): boolean { return this.#runtimeInputSources.has(normalizeSourcePath(source)); }

  applyConfiguration(expectedSourceRevision?: string): Promise<ConfigApplicationResult> {
    return this.#enqueueControl(async () => {
      await this.#applyConfigPatches([], expectedSourceRevision);
      return this.#configurationApplication;
    });
  }

  validateConfiguration(document: RuntimeConfigDocument): Promise<void> {
    const candidate = structuredClone(document);
    return this.#enqueueControl(async () => {
      const environment = this.#environmentSource
        ? defineEnvironmentLayers(await this.#environmentSource.read()) : this.#environmentLayers;
      const inspected = await this.#inspectProject(candidate, environment);
      await validateConfigurationHandlers(
        this.#configHandlerContext(), inspected.primaryConfigDocument, new AbortController().signal, environment,
      );
    });
  }

  /** Trusted composition-root control phase; never await external SDK/model work here. */
  control<T>(operation: (context: RuntimeControlContext) => Promise<T>, existing?: RuntimeControlContext): Promise<T> {
    if (existing) {
      if (!this.#controlContexts.has(existing)) return Promise.reject(new Error('Foreign or expired Runtime control context'));
      return operation(existing);
    }
    return this.#enqueueControl(async () => {
      const lease = this.snapshots.acquire();
      const assertActive = () => {
        if (!this.#controlContexts.has(context) || !lease.active) throw new Error('Runtime control context is no longer active');
      };
      const context: RuntimeControlContext = Object.freeze({
        lease,
        readRootResource: <V>(token: Token<V>): V | undefined => { assertActive(); return this.snapshots.rootResource?.(lease, token); },
        retain: () => {
          assertActive();
          if (!this.snapshots.retain) throw new Error('Runtime snapshot reader cannot retain the exact configuration lease');
          return this.snapshots.retain(lease);
        },
      });
      this.#controlContexts.add(context);
      try { return await operation(context); }
      finally { this.#controlContexts.delete(context); lease.release(); }
    });
  }

  /** Committed metadata, or validated startup declarations while first login is pending. */
  get configurationSchemas(): ReadonlyMap<string, JsonSchema> {
    const snapshot = this.snapshot;
    return snapshot.generation === 0 ? new Map(this.#initialConfigSchemas)
      : new Map([...snapshot.tree.values()].flatMap(node => node.configSchema
        ? [[node.packageRoot, node.configSchema] as const] : []));
  }

  whenConfigurationReady(): Promise<void> { return this.#configurationReady; }

  onGenerationCommit(listener: GenerationCommitListener<RuntimeGenerationState>): () => void {
    return this.#controller.onGenerationCommit(listener);
  }

  get sourceOwnership(): SourceOwnershipIndex { return this.#controller.committed.state.ownership; }

  start(): Promise<RuntimeSnapshot> { return this.#enqueueControl(() => this.#start()); }

  async #start(): Promise<RuntimeSnapshot> {
    try {
      if (this.#environmentSource) {
        this.#environmentLayers = defineEnvironmentLayers(await this.#environmentSource.read());
      }
      if (this.#configPort) {
        const snapshot = await this.#configPort.read();
        this.#configSnapshot = snapshot;
        this.#configDocument = structuredClone(snapshot.document);
      }
      const snapshot = await this.#controller.start(async (current, signal) => {
        return (await this.#prepare(current, signal)).generation;
      });
      this.#desiredDocument = this.#configSnapshot?.document ?? this.#configDocument;
      this.#recordApplication([], true, 0);
      return snapshot;
    } catch (error) {
      this.#rejectConfigurationReady(error);
      throw error;
    }
  }

  async reload(target: PluginId | string = rootPluginId()): Promise<RuntimeSnapshot> {
    return this.#enqueueControl(async () => {
      const previousInputs = this.#runtimeInputState();
      let effectiveDocument = this.#configDocument;
      let selectionGroups: readonly ConfigApplicationGroup[] = [];
      const previousGeneration = this.snapshot.generation;
      const result = await this.#reloadWithEvents({
        target, trigger: 'manual', changed: [],
        planned: { fullRoot: true, plugins: [rootPluginId()], capabilities: [] },
        prepare: async (current, signal) => {
          const source = this.#configPort ? await this.#configPort.read() : this.#configSnapshot;
          const desired = source?.document ?? this.#desiredDocument ?? this.#configDocument!;
          await this.#inspectProject(desired, this.#environmentLayers, source?.pluginOrder);
          const selected = selectPluginConfiguration(
            this.#pluginConfigurationSelection, this.#configDocument, this.#environment, this.#environmentLayers, desired,
          );
          selectionGroups = selected.groups;
          const effective = this.#installResources
            ? copyConfigurationPaths(selected.document, this.#configDocument!, HOST_RESOURCE_CONFIG_KEYS.map(key => [key]))
            : selected.document;
          effectiveDocument = effective;
          const prepared = await this.#prepare(current, signal, effective);
          if (source) this.#configSnapshot = source;
          return prepared.generation;
        },
      }).catch(error => {
        this.#restoreRuntimeInputs(previousInputs);
        throw error;
      });
      this.#configDocument = effectiveDocument;
      if (selectionGroups.length) this.#recordApplication([
        ...this.#configurationApplication.groups.filter(group => group.id !== 'plugins' && !group.id.startsWith('plugin-host:')),
        ...selectionGroups,
      ], true, previousGeneration);
      return result;
    });
  }

  patchConfig(patches: readonly ConfigPatch[]): Promise<RuntimeSnapshot> {
    const operations = cloneConfigPatches(patches);
    return this.#enqueueControl(() => this.#applyConfigPatches(operations));
  }

  /** Serializes source reads and input adoption around the Controller's generation transaction. */
  #enqueueControl<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#controlExecution.getStore()?.active) {
      return Promise.reject(new Error('Recursive Runtime control requires its explicit trusted control context'));
    }
    const execute = () => {
      const ticket = { active: true };
      return this.#controlExecution.run(ticket, async () => {
        try { return await operation(); } finally { ticket.active = false; }
      });
    };
    const result = this.#controlTail.then(execute, execute);
    this.#controlTail = result.catch(() => undefined);
    return result;
  }

  #reloadWithEvents(request: ReloadEventRequest): Promise<RuntimeSnapshot> {
    return executeReloadWithEvents({
      controller: this.#controller,
      snapshots: this.snapshots,
      currentSnapshot: () => this.snapshot,
      currentModel: () => this.#model,
      isStopping: () => this.#stopResult !== undefined,
      onControlError: this.#onControlError,
    }, request);
  }

  createHmrCoordinator(options: RootHmrOptions): HmrCoordinator {
    return new HmrCoordinator({
      ...options,
      modules: this.#modules,
      ownership: () => this.sourceOwnership,
      runtime: {
        handlesSource: (source) => this.#runtimeInputSources.has(normalizeSourcePath(source)),
        reload: async (plan) => {
          const result = await this.#reloadPlan(plan);
          return isProcessPlan(result) ? result : result.report;
        },
      },
    });
  }

  createProcessRestartExecutor(adapter: ProcessRestartAdapter): RootProcessRestartExecutor {
    return new RootProcessRestartExecutor(this, adapter);
  }

  stop(): Promise<void> {
    this.#rejectConfigurationReady(new Error('Runtime stopped before configuration initialization'));
    if (this.#stopResult) return this.#stopResult;
    const result = (async () => {
      try { await this.#controller.stop(); }
      finally { await this.#modules.close(); }
    })();
    this.#stopResult = result;
    return result;
  }

  async #reloadPlan(plan: GenerationInvalidationPlan): Promise<{ snapshot: RuntimeSnapshot; report?: HmrReloadReport } | ProcessInvalidationPlan> {
    return this.#enqueueControl(() => this.#reloadPlanInQueue(plan));
  }

  /**
   * Splits off unclaimed project files that a committed Root installer declared it reads
   * (`watchProjectFiles`, #1250): they are handed to that installer instead of rebuilding the Root.
   */
  #splitProjectFileChanges(plan: GenerationInvalidationPlan): { readonly plan: GenerationInvalidationPlan; readonly files: readonly string[] } {
    const watches = projectFileWatchesOf(this.#model?.scopes.get(rootPluginId()));
    if (!watches?.size || plan.fallbacks.length === 0) return { plan, files: [] };
    const files = plan.fallbacks
      .map((fallback) => normalizeSourcePath(fallback.source))
      .filter((source) => !this.#runtimeInputSources.has(source) && watches.matches(source));
    if (files.length === 0) return { plan, files: [] };
    const declared = new Set(files);
    return {
      files: Object.freeze([...declared]),
      plan: Object.freeze({
        ...plan,
        changed: Object.freeze(plan.changed.filter((source) => !declared.has(normalizeSourcePath(source)))),
        fallbacks: Object.freeze(plan.fallbacks.filter((fallback) => !declared.has(normalizeSourcePath(fallback.source)))),
      }),
    };
  }

  async #reloadPlanInQueue(original: GenerationInvalidationPlan): Promise<{ snapshot: RuntimeSnapshot; report?: HmrReloadReport } | ProcessInvalidationPlan> {
    const { plan, files: resourceFiles } = this.#splitProjectFileChanges(original);
    if (resourceFiles.length > 0 && plan.changed.length === 0) {
      // Only declared project files changed: no generation, no Scope rebuilt, no Endpoint touched.
      await projectFileWatchesOf(this.#model?.scopes.get(rootPluginId()))?.notify(resourceFiles);
      return {
        snapshot: this.snapshot,
        report: Object.freeze({
          kind: 'reloaded', rebuilt: 'resource', plugins: Object.freeze([]), capabilities: Object.freeze([]),
          resources: resourceFiles,
        }),
      };
    }
    const previousRoot = this.#model?.scopes.get(rootPluginId());
    let inputs: RuntimeInputCandidate | undefined;
    const previousInputs = this.#runtimeInputState();
    const previousGeneration = this.snapshot.generation;
    const previousScopes = this.#model?.scopes;
    let restart: ProcessInvalidationPlan | undefined;
    let rebuild: PreparedRebuild | undefined;
    const snapshot = await this.#reloadWithEvents({
      target: plan.subtrees[0] ?? plan.slots[0] ?? rootPluginId(),
      trigger: 'source', changed: plan.changed,
      planned: { fullRoot: plan.subtrees.includes(rootPluginId()), plugins: plan.subtrees, capabilities: plan.slots },
      restartRequired: () => restart !== undefined,
      prepare: async (current, signal) => {
        const candidate = await this.#planRuntimeInputs(plan.changed, signal);
        if (candidate && 'kind' in candidate) { restart = candidate; return undefined; }
        inputs = candidate;
        const outcome = await prepareInvalidatedGeneration({
          modules: this.#modules, model: this.#model, environment: this.#environment,
          installResources: this.#installResources, isolation: this.#isolation,
          runtimeInputSources: this.#runtimeInputSources, sourceOwnership: this.sourceOwnership,
          inspectProject: (doc, env) => this.#inspectProject(doc, env),
          prepareFull: (cur, sig, doc, env) => this.#prepare(cur, sig, doc, env),
          prepareInspected: (cur, insp, sig) => this.#prepareInspected(cur, insp, sig),
          prepareSubtrees: (cur, insp, roots, sig, updates) => this.#prepareSubtreesReported(cur, insp, roots, sig, updates),
        }, current, signal, plan, inputs);
        if (outcome.restart) { restart = outcome.restart; return undefined; }
        if (!outcome.prepared) return undefined;
        rebuild = outcome.rebuild;
        if (inputs) {
          inputs = {
            ...inputs,
            applicationGroups: preparedConfigurationGroups(
              inputs.applicationGroups ?? [], inputs.configUpdates, this.#model, outcome.prepared.generation,
            ),
          };
        }
        const adoptedInputs = inputs;
        return adoptedInputs
          ? guardConfigurationSource(
            await bindConfigurationResources(this.snapshot.root, this.#model, outcome.prepared.generation, adoptedInputs.rootResources),
            this.#configPort, adoptedInputs.configSnapshot,
          )
          : outcome.prepared.generation;
      },
    }).catch(async error => {
      this.#restoreRuntimeInputs(previousInputs);
      if (inputs) this.#recordApplication(
        rejectedApplicationGroups(inputs.applicationGroups ?? [], error, this.#controller.state),
        true, previousGeneration, inputs.configSnapshot?.revision,
      );
      // The declared project files changed whatever happened to the rest of the batch: the
      // retained Root installer still has to re-read them (#1250). Its failure cannot replace
      // the generation error.
      const root = this.#model?.scopes.get(rootPluginId());
      if (resourceFiles.length > 0 && root === previousRoot) {
        try { await projectFileWatchesOf(root)?.notify(resourceFiles); } catch { /* reported by the reload error */ }
      }
      throw error;
    });
    if (restart) return restart;
    if (inputs) {
      this.#adoptRuntimeInputs(inputs);
      this.#recordApplication(inputs.applicationGroups ?? [], true, previousGeneration);
    }
    if (resourceFiles.length > 0) {
      // A replaced Root installer already read the new files during its setup.
      const root = this.#model?.scopes.get(rootPluginId());
      if (root === previousRoot) await projectFileWatchesOf(root)?.notify(resourceFiles);
    }
    const described = rebuild && snapshot.generation !== previousGeneration
      ? describeHmrReload(rebuild, previousScopes, this.#model?.scopes)
      : undefined;
    const report = described && resourceFiles.length > 0
      ? Object.freeze({ ...described, resources: resourceFiles })
      : described;
    return { snapshot, report };
  }

  get #model(): RuntimeGenerationModel | undefined {
    return this.#controller.committed.state.model;
  }

  #configHandlerContext(): ConfigurationHandlerContext {
    return {
      snapshot: this.snapshot, snapshots: this.snapshots,
      environment: this.#environment, environmentLayers: this.#environmentLayers,
      configDocument: this.#configDocument, configUpdates: this.#configUpdates,
      installResources: this.#installResources, pluginConfigurationSelection: this.#pluginConfigurationSelection,
      onControlError: this.#onControlError,
    };
  }

  #planRuntimeInputs(
    changed: readonly string[],
    signal: AbortSignal,
    explicit?: Readonly<{ document: RuntimeConfigDocument; snapshot?: ConfigDocumentSnapshot; pluginOrder?: readonly string[]; inspection?: InspectedProject }>,
  ): Promise<RuntimeInputCandidate | ProcessInvalidationPlan | undefined> {
    return planRuntimeInputs({
      ...this.#configHandlerContext(),
      modules: this.#modules, disabledPluginInstanceKeys: this.#disabledPluginInstanceKeys,
      runtimeInputSources: this.#runtimeInputSources, configPort: this.#configPort,
      configSnapshot: this.#configSnapshot, desiredDocument: this.#desiredDocument,
      environmentSource: this.#environmentSource, model: this.#model,
      inspectProject: (doc, env, order) => this.#inspectProject(doc, env, order),
    }, changed, signal, explicit);
  }

  #recordApplication(
    groups: readonly ConfigApplicationGroup[], saved: boolean, previousGeneration: number,
    sourceRevision = this.#configSnapshot?.revision ?? '',
  ): void {
    if (this.snapshot.generation !== previousGeneration) this.#applicationRevision += 1;
    this.#configurationApplication = Object.freeze({
      operationId: `config:${this.#operationNamespace}:${++this.#operationSequence}`, sourceRevision,
      saved, generation: this.snapshot.generation, applicationRevision: this.#applicationRevision,
      groups: Object.freeze([...groups]),
    });
  }

  #adoptRuntimeInputs(candidate: RuntimeInputCandidate): void {
    this.#configDocument = structuredClone(candidate.document);
    if (candidate.configSnapshot) this.#configSnapshot = candidate.configSnapshot;
    this.#environmentLayers = candidate.environmentLayers;
  }

  #runtimeInputState(): RuntimeInputState {
    return Object.freeze({
      document: this.#configDocument, configSnapshot: this.#configSnapshot, environmentLayers: this.#environmentLayers,
    });
  }

  #restoreRuntimeInputs(state: RuntimeInputState): void {
    this.#configDocument = state.document;
    this.#configSnapshot = state.configSnapshot;
    this.#environmentLayers = state.environmentLayers;
  }

  async #prepare(
    current: RuntimeSnapshot, signal: AbortSignal,
    document?: RuntimeConfigDocument, environmentLayers?: Readonly<EnvironmentLayers>,
  ): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    const inspected = await this.#inspectProject(document, environmentLayers);
    signal.throwIfAborted();
    return this.#prepareInspected(current, inspected, signal);
  }

  #inspectProject(
    document?: RuntimeConfigDocument,
    environmentLayers: Readonly<EnvironmentLayers> = this.#environmentLayers,
    pluginOrder?: readonly string[],
  ): Promise<InspectedProject> {
    return inspectRuntimeProject({
      projectRoot: this.#projectRoot, modules: this.#modules, environment: this.#environment,
      disabledPluginInstanceKeys: this.#disabledPluginInstanceKeys, configResolver: this.#configResolver,
      onManifestWarning: this.#onManifestWarning,
      snapshot: this.snapshot, readCommittedSnapshot: () => this.snapshot, getConfigDocument: () => this.#configDocument,
      getConfigSnapshot: () => this.#configSnapshot, refreshConfigDocument: () => this.#refreshConfigDocument(),
      onInitialSchemas: (schemas) => {
        this.#initialConfigSchemas = schemas;
        this.#resolveConfigurationReady();
      },
    }, document, environmentLayers, pluginOrder);
  }

  async #refreshConfigDocument(): Promise<void> {
    if (!this.#configPort) return;
    const snapshot = await this.#configPort.read();
    if (snapshot.revision === this.#configSnapshot?.revision) return;
    this.#configSnapshot = snapshot;
    this.#configDocument = structuredClone(snapshot.document);
  }

  async #applyConfigPatches(patches: readonly ConfigPatch[], expectedSourceRevision?: string): Promise<RuntimeSnapshot> {
    if (this.#configResolver || !this.#configDocument) throw new Error('Config patches require a document-backed RootRuntime config');
    const previousGeneration = this.snapshot.generation;
    const currentSource = this.#configPort ? await this.#configPort.read() : this.#configSnapshot;
    if (expectedSourceRevision !== undefined && expectedSourceRevision !== (currentSource?.revision ?? '')) throw new ConfigurationSupersededError();
    const sourceDocument = currentSource?.document ?? this.#desiredDocument ?? this.#configDocument;
    const candidate = applyConfigPatches(sourceDocument, patches);
    const pluginOrder = patchedPluginOrder(currentSource?.pluginOrder, candidate, patches);
    const desiredEnvironment = this.#environmentSource ? defineEnvironmentLayers(await this.#environmentSource.read()) : this.#environmentLayers;
    const desiredInspection = await this.#inspectProject(candidate, desiredEnvironment, pluginOrder);
    await validateConfigurationHandlers(this.#configHandlerContext(), desiredInspection.primaryConfigDocument, new AbortController().signal, desiredEnvironment);
    if (this.#configPort && patches.length && (!isDeepStrictEqual(sourceDocument, candidate) || patches.some(patch => patch.path[0] === 'plugins'))) {
      const transaction = await this.#configPort.prepare(requireConfigDocumentSnapshot(currentSource), patches);
      if (!isDeepStrictEqual(transaction.document, candidate)) { await transaction.rollback(); throw new ConfigDocumentDivergenceError(); }
      this.#configSnapshot = await transaction.commit();
    } else if (currentSource) this.#configSnapshot = currentSource;
    this.#desiredDocument = structuredClone(candidate);
    let groups: readonly ConfigApplicationGroup[] = [];
    let appliedInputs: RuntimeInputCandidate | undefined;
    try {
      const snapshot = await this.#reloadWithEvents({
        target: rootPluginId(), trigger: 'manual', changed: [],
        planned: { fullRoot: false, plugins: [], capabilities: [] },
        prepare: async (current, signal) => {
          const planned = await this.#planRuntimeInputs([...this.#runtimeInputSources], signal,
            { document: candidate, snapshot: this.#configSnapshot, pluginOrder, inspection: desiredInspection });
          if (!planned || 'kind' in planned) throw new Error('Configuration application did not produce a candidate');
          appliedInputs = planned;
          groups = planned.applicationGroups ?? [];
          const inspected = planned.inspected;
          const updates = { roots: planned.roots, ...(planned.configUpdates ?? { config: new Map<PluginId, unknown>(), projections: new Map<FeatureId, unknown>() }) };
          const topologyChanged = planned.topologyChanged;
          if (!planned.primaryConfigChanged && !topologyChanged && !planned.roots.length) return undefined;
          let prepared: PreparedRuntimeGeneration | undefined;
          if (topologyChanged && !updates.roots.includes(rootPluginId())) {
            prepared = await new TopologyGenerationPreparer(
              this.#modules, this.#model!, inspected.graph, inspected.configResolver,
              inspected.primaryConfigDocument, this.#environment, this.#installResources,
              inspected.environmentLayers, this.#isolation, planned.configUpdates,
            ).prepare(current, signal);
          } else if (!updates.roots.includes(rootPluginId())) {
            prepared = await this.#prepareSubtrees(current, inspected, updates.roots, signal, updates);
          } else prepared = await this.#prepareInspected(current, inspected, signal);
          if (!prepared) return undefined;
          groups = preparedConfigurationGroups(groups, planned.configUpdates, this.#model, prepared.generation);
          return guardConfigurationSource(
            await bindConfigurationResources(this.snapshot.root, this.#model, prepared.generation, planned.rootResources),
            this.#configPort, planned.configSnapshot,
          );
        },
      });
      if (appliedInputs) this.#adoptRuntimeInputs(appliedInputs);
      this.#recordApplication(groups, true, previousGeneration);
      return snapshot;
    } catch (error) {
      this.#recordApplication(rejectedApplicationGroups(groups, error, this.#controller.state), true, previousGeneration);
      throw error;
    }
  }

  #prepareInspected(current: RuntimeSnapshot, inspected: InspectedProject, signal: AbortSignal): Promise<PreparedRuntimeGeneration> {
    return new GenerationAssembler(
      inspected.graph, this.#modules, inspected.configResolver, inspected.primaryConfigDocument,
      current.generation + 1, this.#environment, this.#installResources, inspected.environmentLayers, this.#isolation,
    ).prepare(signal);
  }

  async #prepareSubtrees(
    current: RuntimeSnapshot, inspected: InspectedProject, roots: readonly PluginId[], signal: AbortSignal,
    configUpdates?: Readonly<{ config: ReadonlyMap<PluginId, unknown>; projections: ReadonlyMap<FeatureId, unknown> }>,
  ): Promise<PreparedRuntimeGeneration> {
    return (await this.#prepareSubtreesReported(current, inspected, roots, signal, configUpdates)).prepared;
  }

  async #prepareSubtreesReported(
    current: RuntimeSnapshot, inspected: InspectedProject, roots: readonly PluginId[], signal: AbortSignal,
    configUpdates?: Readonly<{ config: ReadonlyMap<PluginId, unknown>; projections: ReadonlyMap<FeatureId, unknown> }>,
  ): Promise<SubtreePreparation> {
    if (!this.#model) {
      return { prepared: await this.#prepareInspected(current, inspected, signal), fullRebuildReason: 'no committed generation to reload against' };
    }
    try {
      return {
        prepared: await new SubtreeGenerationPreparer(
          this.#modules, this.#model, inspected.graph, inspected.configResolver,
          inspected.primaryConfigDocument, this.#environment, this.#installResources,
          inspected.environmentLayers, this.#isolation, configUpdates,
        ).prepare(current, roots, signal),
      };
    } catch (error) {
      if (!(error instanceof SubtreeTopologyChangedError)) throw error;
      return {
        prepared: await this.#prepareInspected(current, inspected, signal),
        fullRebuildReason: `the Plugin topology changed under a subtree reload: ${error.message}`,
      };
    }
  }
}
