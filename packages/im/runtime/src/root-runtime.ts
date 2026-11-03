import { pluginEventInstances, type PluginEventInstance } from './plugin-events.js';
import { normalizeSourcePath } from './source-path.js';
import { resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  DisposeStack,
  GenerationHandoffStack,
  RootController,
  applyConfigPatches,
  ConfigDocumentDivergenceError,
  createSnapshotView,
  isRootPrivateToken,
  rootPluginId,
  type CapabilityId,
  type CapabilitySlot,
  type ControlErrorHandler,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type Dispose,
  type FeatureId,
  type GenerationCommitListener,
  type PluginId,
  type PreparedGeneration,
  type RuntimeConfigDocument,
  type RuntimeSnapshot,
  type SnapshotReader,
  type SnapshotState,
  type SnapshotLease,
  type PrepareTransaction,
  type HmrReloadScope,
  type HmrOutcome,
  type HmrEventDetails,
  type HmrResumeDetails,
  type Token,
} from '@zhin.js/plugin-runtime';
import {
  FeatureCatalog,
  FeatureDiscovery,
  type CapabilityRoot,
  type FeatureProvider,
} from '@zhin.js/feature-kit';
import type { ZhinFeatureManifest } from './manifest.js';
import { ConfigComposer, HOST_RESOURCE_CONFIG_KEYS, type ComposedConfig, type JsonSchema } from './config-composer.js';
import { createPrimaryConfig, primaryConfigToken, type PrimaryConfig } from './primary-config.js';
import { immutableConfigSchema } from './plugin-config-schema.js';
import { defineRuntimeEnvironment, type RuntimeEnvironment } from './environment.js';
import {
  createEnvStore,
  defineEnvironmentLayers,
  type EnvironmentLayers,
  type EnvironmentLayersPort,
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
import { RuntimeInputPlanner } from './runtime-input-planner.js';
import { TopologyTransactionPlanner } from './topology-transaction.js';
import type { ConfigApplicationResult, ConfigApplicationGroup, RootConfigUpdateHandler, RootPluginConfigurationSelection, RuntimeControlContext } from './configuration-application.js';
import { changedConfigurationPaths, copyConfigurationPaths, readConfigurationPath } from './configuration-paths.js';
import { APPLICATION_PLUGIN_RESERVED_KEYS } from './application-plugin-declaration.js';

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
}

export type RootHmrOptions = Omit<HmrCoordinatorOptions, 'modules' | 'ownership' | 'runtime'>;

export class ConfigurationSupersededError extends Error {
  readonly code = 'configuration_superseded';
  constructor() { super('Configuration source changed during application'); this.name = 'ConfigurationSupersededError'; }
}

interface InspectedProject {
  readonly graph: ProjectGraph;
  readonly configResolver: PluginConfigResolver;
  readonly primaryConfigDocument: RuntimeConfigDocument;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
  readonly composed?: ComposedConfig;
}

/** Facts for one existing Controller transaction; does not own commit or rollback. */
interface ReloadEventRequest {
  readonly target: PluginId | string;
  readonly trigger: HmrEventDetails['trigger'];
  readonly changed: readonly string[];
  readonly planned: HmrReloadScope;
  readonly prepare: PrepareTransaction<RuntimeGenerationState>;
  readonly restartRequired?: () => boolean;
}

interface RuntimeInputCandidate {
  readonly document: RuntimeConfigDocument;
  readonly configSnapshot?: ConfigDocumentSnapshot;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
  readonly inputSources: ReadonlySet<string>;
  readonly roots: readonly PluginId[];
  readonly inspected: InspectedProject;
  readonly topologyChanged: boolean;
  readonly primaryConfigChanged: boolean;
  readonly applicationGroups?: readonly ConfigApplicationGroup[];
  readonly rootResources?: ReadonlyMap<Token<unknown>, unknown>;
  readonly configUpdates?: Readonly<{ config: ReadonlyMap<PluginId, unknown>; projections: ReadonlyMap<FeatureId, unknown> }>;
}

interface RuntimeInputState {
  readonly document?: RuntimeConfigDocument;
  readonly configSnapshot?: ConfigDocumentSnapshot;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
}

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
  readonly #configUpdates: readonly RootConfigUpdateHandler[];
  readonly #pluginConfigurationSelection?: RootPluginConfigurationSelection;
  readonly #controlContexts = new WeakSet<RuntimeControlContext>();
  #applicationRevision = 0;
  #operationSequence = 0;
  readonly #operationNamespace = randomUUID();
  #configurationApplication: ConfigApplicationResult = Object.freeze({ operationId: `config:${this.#operationNamespace}:0`, sourceRevision: '', saved: false,
    generation: 0, applicationRevision: 0, groups: Object.freeze([]) });

  constructor(options: RootRuntimeOptions) {
    this.#pluginConfigurationSelection = options.pluginConfigurationSelection;
    this.#configUpdates = Object.freeze([...(options.configUpdates ?? [])]);
    const ownedPaths: Array<readonly string[]> = [];
    const handlerIds = new Set<string>();
    for (const handler of this.#configUpdates) {
      if (!handler.id || handlerIds.has(handler.id)) throw new TypeError('Configuration update handler ids must be unique');
      handlerIds.add(handler.id);
      for (const path of handler.paths) {
        if (!path.length || !HOST_RESOURCE_CONFIG_KEYS.includes(path[0]!) || path.some(part => !part || ['__proto__', 'constructor', 'prototype'].includes(part))) {
          throw new TypeError('Configuration update paths must name safe Host fields');
        }
        if (ownedPaths.some(previous => isPathWithin(path, previous) || isPathWithin(previous, path))) throw new TypeError('Configuration update paths overlap');
        ownedPaths.push(path);
      }
    }
    this.#onControlError = options.onControlError ?? (() => undefined);
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
    }
    else if (isConfigDocumentPort(options.config)) this.#configPort = options.config;
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

  get snapshot(): RuntimeSnapshot {
    return this.#controller.snapshot;
  }

  get snapshots(): SnapshotReader {
    return this.#controller.snapshots;
  }

  get configurationApplication(): ConfigApplicationResult { return this.#configurationApplication; }

  isConfigurationSource(source: string): boolean { return this.#runtimeInputSources.has(normalizeSourcePath(source)); }

  applyConfiguration(expectedSourceRevision?: string): Promise<ConfigApplicationResult> {
    return this.#enqueueControl(async () => { await this.#applyConfigPatches([], expectedSourceRevision); return this.#configurationApplication; });
  }

  validateConfiguration(document: RuntimeConfigDocument): Promise<void> {
    const candidate = structuredClone(document);
    return this.#enqueueControl(async () => {
      const environment = this.#environmentSource
        ? defineEnvironmentLayers(await this.#environmentSource.read()) : this.#environmentLayers;
      const inspected = await this.#inspectProject(candidate, environment);
      await this.#validateConfigurationHandlers(inspected.primaryConfigDocument, new AbortController().signal, environment);
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
      const context: RuntimeControlContext = Object.freeze({ lease,
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

  /** Metadata readiness is independent of account login and generation activation. */
  whenConfigurationReady(): Promise<void> {
    return this.#configurationReady;
  }

  onGenerationCommit(listener: GenerationCommitListener<RuntimeGenerationState>): () => void {
    return this.#controller.onGenerationCommit(listener);
  }

  get sourceOwnership(): SourceOwnershipIndex {
    return this.#controller.committed.state.ownership;
  }

  start(): Promise<RuntimeSnapshot> {
    return this.#enqueueControl(() => this.#start());
  }

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
      const result = await this.#reloadWithEvents({ target, trigger: 'manual', changed: [],
        planned: { fullRoot: true, plugins: [rootPluginId()], capabilities: [] },
        prepare: async (current, signal) => {
          const source = this.#configPort ? await this.#configPort.read() : this.#configSnapshot;
          const desired = source?.document ?? this.#desiredDocument ?? this.#configDocument!;
          await this.#inspectProject(desired, this.#environmentLayers, source?.pluginOrder);
          // A manual full Root reload may adopt plugin edits, but it must not
          // transfer the old Root owner's versioned resources or pending Host values.
          const selected = this.#selectPluginConfiguration(desired);
          selectionGroups = selected.groups;
          const effective = this.#installResources ? copyConfigurationPaths(selected.document, this.#configDocument!, HOST_RESOURCE_CONFIG_KEYS.map(key => [key])) : selected.document;
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
    if (this.#controlExecution.getStore()?.active) return Promise.reject(new Error('Recursive Runtime control requires its explicit trusted control context'));
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

  /** Hold real old/current instances through notification; the Controller alone publishes candidates. */
  async #reloadWithEvents(request: ReloadEventRequest): Promise<RuntimeSnapshot> {
    const previous = this.snapshots.acquire();
    const oldInstances = pluginEventInstances(this.#model?.scopes);
    const attempted = new Set<PluginEventInstance>();
    let active: SnapshotLease | undefined;
    let outcome: HmrOutcome = 'rejected';
    const facts = (instance: PluginEventInstance, currentInstances: ReadonlySet<PluginEventInstance>, generation: number): HmrEventDetails => Object.freeze({
      trigger: request.trigger, changed: Object.freeze([...request.changed]),
      planned: Object.freeze({ ...request.planned, plugins: Object.freeze([...request.planned.plugins]), capabilities: Object.freeze([...request.planned.capabilities]) }),
      previousGeneration: previous.value.generation, activeGeneration: generation,
      receiver: Object.freeze({ owner: instance.owner, creationGeneration: instance.creationGeneration,
        state: currentInstances.has(instance) ? 'current' : 'replaced' }),
    });
    try {
      const snapshot = await this.#controller.reload(request.target, async (current, signal) => {
        const currentInstances = new Set(oldInstances);
        const results = await Promise.allSettled(oldInstances.map(instance => {
          attempted.add(instance);
          return instance.channel.dispatch('hmr.pause', Object.freeze({ signal, details: facts(instance, currentInstances, current.generation) }));
        }));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Plugin pause handlers rejected reload');
        signal.throwIfAborted();
        const prepared = await request.prepare(current, signal);
        if (!prepared) return undefined;
        const root = current.root;
        const currentState = this.#controller.committed.state;
        const sameOwner = currentState.model?.scopes.get(root) === prepared.state.model?.scopes.get(root);
        return sameOwner && currentState.rootResources?.size
          ? { ...prepared, state: { ...prepared.state,
            rootResources: new Map([...currentState.rootResources, ...(prepared.state.rootResources ?? [])]) } }
          : prepared;
      });
      outcome = request.restartRequired?.() ? 'restart-required'
        : snapshot.generation === previous.value.generation ? 'unchanged' : 'committed';
      return snapshot;
    } catch (error) {
      outcome = this.#stopResult ? 'cancelled' : 'rejected';
      throw error;
    } finally {
      // Acquire before another await: retirement may proceed, but these instances must survive notification.
      try { active = this.snapshots.acquire(); } catch { if (this.#stopResult) outcome = 'cancelled'; }
      const current = new Set(pluginEventInstances(this.#model?.scopes));
      const recipients = new Set([...attempted, ...(active ? current : [])]);
      const replaced = Object.freeze(oldInstances.filter(instance => !current.has(instance)).map(instance => instance.owner));
      const results = await Promise.allSettled([...recipients].map(instance => {
        const details: HmrResumeDetails = Object.freeze({
          ...facts(instance, current, active?.value.generation ?? this.snapshot.generation),
          outcome, replaced, ...(!active && this.#stopResult ? { reason: 'root-stopping' as const } : {}),
        });
        return instance.channel.dispatch('hmr.resume', Object.freeze({ signal: previous.stopSignal, details }));
      }));
      for (const result of results) if (result.status === 'rejected') {
        try { this.#onControlError(result.reason); } catch { /* Diagnostics cannot reverse a committed transaction. */ }
      }
      active?.release();
      previous.release();
    }
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
          return isProcessPlan(result) ? result : undefined;
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
    return this.#enqueueControl(() => this.#reloadPlanInQueue(plan));
  }

  async #reloadPlanInQueue(
    plan: GenerationInvalidationPlan,
  ): Promise<RuntimeSnapshot | ProcessInvalidationPlan> {
    let inputs: RuntimeInputCandidate | undefined;
    const previousInputs = this.#runtimeInputState();
    const previousGeneration = this.snapshot.generation;
    let restart: ProcessInvalidationPlan | undefined;
    const snapshot = await this.#reloadWithEvents({
      target: plan.subtrees[0] ?? plan.slots[0] ?? rootPluginId(),
      trigger: 'source', changed: plan.changed,
      planned: { fullRoot: plan.subtrees.includes(rootPluginId()), plugins: plan.subtrees, capabilities: plan.slots },
      restartRequired: () => restart !== undefined,
      prepare: async (current, signal) => {
        const candidate = await this.#planRuntimeInputs(plan.changed, signal);
        if (candidate && 'kind' in candidate) { restart = candidate; return undefined; }
        inputs = candidate;
        const plannedInputs = inputs;
        const effectiveInputPlan = plannedInputs
          ? Object.freeze({ ...plan,
              subtrees: collapseInvalidationSubtrees([...plan.subtrees, ...plannedInputs.roots]),
              fallbacks: Object.freeze(plan.fallbacks.filter(fallback => !plannedInputs.inputSources.has(normalizeSourcePath(fallback.source)))),
            })
          : plan;
        let prepared: PreparedRuntimeGeneration | undefined;
        const resolved = await this.#resolveCapabilityDelta(current, effectiveInputPlan);
        const effective = resolved.plan;
        if (
          inputs
          && effective.manifestSources.length === 0
          && effective.subtrees.length === 0
          && effective.slots.length === 0
          && resolved.capabilities.size === 0
          && !inputs.topologyChanged
          && !inputs.primaryConfigChanged
        ) return undefined;
        if (this.#model && (effective.manifestSources.length > 0 || inputs?.topologyChanged)) {
          const inspected = inputs?.inspected ?? await this.#inspectProject(
            inputs?.document,
            inputs?.environmentLayers,
          );
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
              inspected.environmentLayers,
              this.#isolation,
              inputs?.configUpdates,
            ).prepare(current, signal, { ...effective, capabilities: resolved.capabilities });
        } else if (effective.subtrees.length === 0 && resolved.capabilities.size > 0 && this.#model) {
          prepared = await new SlotGenerationPreparer(this.#modules, this.#model,
            inputs?.primaryConfigChanged
              ? createPrimaryConfig(inputs.inspected.primaryConfigDocument,
                createEnvStore(rootPluginId(), this.#environment, inputs.environmentLayers), inputs.inspected.configResolver.compositionMode)
              : undefined, inputs?.configUpdates)
            .prepare(current, resolved.capabilities, signal);
        } else if (this.#model && this.#canPrepareSubtrees(effective)) {
          const inspected = inputs?.inspected ?? await this.#inspectProject(
            inputs?.document,
            inputs?.environmentLayers,
          );
          prepared = await this.#prepareSubtrees(current, inspected, effective.subtrees, signal, inputs?.configUpdates);
        } else if (this.#model && inputs?.primaryConfigChanged && effective.subtrees.length === 0 && resolved.capabilities.size === 0) {
          prepared = await this.#prepareSubtrees(current, inputs.inspected, [], signal, inputs.configUpdates);
        } else {
          prepared = await this.#prepare(
            current,
            signal,
            inputs?.document,
            inputs?.environmentLayers,
          );
        }
        if (!prepared) return undefined;
        if (inputs) inputs = { ...inputs, applicationGroups: this.#preparedConfigurationGroups(
          inputs.applicationGroups ?? [], inputs.configUpdates, prepared.generation) };
        const adoptedInputs = inputs;
        return adoptedInputs ? this.#guardConfigurationSource(await this.#bindConfigurationResources(prepared.generation, adoptedInputs.rootResources), adoptedInputs.configSnapshot)
          : prepared.generation;
      },
    }).catch(error => {
      this.#restoreRuntimeInputs(previousInputs);
      if (inputs) this.#recordApplication(this.#rejectedApplicationGroups(inputs.applicationGroups ?? [], error), true,
        previousGeneration, inputs.configSnapshot?.revision);
      throw error;
    });
    if (restart) return restart;
    if (inputs) {
      this.#adoptRuntimeInputs(inputs);
      this.#recordApplication(inputs.applicationGroups ?? [], true, previousGeneration);
    }
    return snapshot;
  }

  get #model(): RuntimeGenerationModel | undefined {
    return this.#controller.committed.state.model;
  }

  async #planRuntimeInputs(
    changed: readonly string[],
    signal: AbortSignal,
    explicit?: Readonly<{ document: RuntimeConfigDocument; snapshot?: ConfigDocumentSnapshot; pluginOrder?: readonly string[]; inspection?: InspectedProject }>,
  ): Promise<RuntimeInputCandidate | ProcessInvalidationPlan | undefined> {
    const inputSources = new Set(
      changed.map((source) => normalizeSourcePath(source)).filter((source) => this.#runtimeInputSources.has(source)),
    );
    if ((!explicit && inputSources.size === 0) || !this.#model) return undefined;
    const configChanged = !!explicit || (this.#configPort?.sources?.some(
      (source) => inputSources.has(normalizeSourcePath(source)),
    ) ?? false);
    const environmentChanged = !!this.#environmentSource && (configChanged || (this.#environmentSource.sources.some(
      (source) => inputSources.has(normalizeSourcePath(source)),
    )));
    const configSnapshot = explicit?.snapshot ?? (configChanged ? await this.#configPort?.read() : undefined);
    const desired = explicit?.document ?? configSnapshot?.document ?? this.#configSnapshot?.document ?? this.#desiredDocument ?? requireConfigDocument(this.#configDocument);
    let environmentLayers = environmentChanged && this.#environmentSource
      ? defineEnvironmentLayers(await this.#environmentSource.read())
      : this.#environmentLayers;
    const pluginOrder = explicit?.pluginOrder ?? configSnapshot?.pluginOrder ?? this.#configSnapshot?.pluginOrder;
    const validated = explicit?.inspection && isDeepStrictEqual(explicit.inspection.environmentLayers, environmentLayers)
      ? explicit.inspection : undefined;
    const desiredInspection = validated ?? await this.#inspectProject(desired, environmentLayers, pluginOrder);
    if (!validated) await this.#validateConfigurationHandlers(desiredInspection.primaryConfigDocument, signal, environmentLayers);
    const selected = await this.#selectConfiguration(desiredInspection.primaryConfigDocument, signal, desired, environmentLayers);
    const document = selected.document;
    const environmentGroups: ConfigApplicationGroup[] = [];
    // Host installers capture expanded startup values. Until an environment
    // update is proved safe for every Host consumer, preserve its effective layer.
    if (environmentChanged && this.#installResources && !isDeepStrictEqual(this.#environmentLayers, environmentLayers)) {
      environmentLayers = this.#environmentLayers;
      environmentGroups.push(configGroup('environment', [], 'restart-process', 'restart-pending', 'environment-host-consumers'));
    }
    const unchangedDesired = isDeepStrictEqual(document, desired) && isDeepStrictEqual(environmentLayers, desiredInspection.environmentLayers);
    const inspected = unchangedDesired ? desiredInspection : await this.#inspectProject(document, environmentLayers, effectivePluginOrder(document, pluginOrder));
    // The mixed effective projection is a distinct candidate: a valid desired
    // document alone cannot prove that retained Host settings satisfy new refs.
    if (!unchangedDesired) await this.#validateConfigurationHandlers(inspected.primaryConfigDocument, signal, environmentLayers);
    const inputPlan = await new RuntimeInputPlanner(
      new ConfigComposer(this.#disabledPluginInstanceKeys, this.#modules),
      this.#committedConfigComposer(),
    ).plan({
      graph: this.#model.graph,
      nextGraph: inspected.graph,
      environment: this.#environment,
      previousDocument: requireConfigDocument(this.#configDocument),
      nextDocument: document,
      previousEnvironment: this.#environmentLayers,
      nextEnvironment: environmentLayers,
      ...(inspected.composed && this.#committedPrimaryConfig() ? { composed: inspected.composed,
        committed: { expandedDocument: this.#committedPrimaryConfig()!.expanded, expandedViews: this.snapshot.config } } : {}),
    });
    const updates = await this.#preparePureConfigViews(inspected, inputPlan.roots, signal);
    return Object.freeze({
      document,
      configSnapshot,
      environmentLayers,
      inputSources,
      roots: updates.roots,
      inspected,
      topologyChanged: new TopologyTransactionPlanner().plan(this.#model.graph, inspected.graph).changed,
      primaryConfigChanged: this.#primaryConfigChanged(inspected.primaryConfigDocument),
      applicationGroups: [...selected.groups, ...environmentGroups,
        ...(!isDeepStrictEqual(this.#configDocument, document) && inputPlan.roots.length ? [configGroup('plugins', changedConfigurationPaths(this.#configDocument, document)
          .filter(path => !HOST_RESOURCE_CONFIG_KEYS.includes(path[0]!)), updates.roots.length ? 'reload-plugin' : 'in-place', 'applied')] : []),
      ], rootResources: selected.rootResources,
      configUpdates: updates,
    });
  }

  async #selectConfiguration(desired: RuntimeConfigDocument, signal: AbortSignal, rawDesired: RuntimeConfigDocument,
    desiredEnvironment: EnvironmentLayers): Promise<Readonly<{
    document: RuntimeConfigDocument; groups: readonly ConfigApplicationGroup[]; rootResources: ReadonlyMap<Token<unknown>, unknown>;
  }>> {
    const previous = this.#committedPrimaryConfig()?.document ?? requireConfigDocument(this.#configDocument);
    const pluginSelection = this.#selectPluginConfiguration(rawDesired);
    let rawDocument = pluginSelection.document;
    const groups: ConfigApplicationGroup[] = [...pluginSelection.groups];
    const rootResources = new Map<Token<unknown>, unknown>();
    const changed = HOST_RESOURCE_CONFIG_KEYS.flatMap(key => changedConfigurationPaths(previous[key], desired[key], [key]));
    if (!this.#installResources) {
      if (changed.length) groups.push(configGroup('host-document', changed, 'in-place', 'applied'));
      return { document: rawDocument, groups, rootResources };
    }
    let document = copyConfigurationPaths(desired, previous, HOST_RESOURCE_CONFIG_KEYS.map(key => [key]));
    rawDocument = copyConfigurationPaths(rawDocument, this.#configDocument ?? {}, HOST_RESOURCE_CONFIG_KEYS.map(key => [key]));
    const accepted: Array<readonly string[]> = [];
    for (const handler of this.#configUpdates) {
      if (!handler.paths.some(path => !isDeepStrictEqual(readConfigurationPath(previous, path), readConfigurationPath(desired, path)))) continue;
      const candidate = copyConfigurationPaths(document, desired, handler.paths);
      const lease = this.snapshots.acquire();
      try {
        const environment = createEnvStore(rootPluginId(), this.#environment, this.#environmentLayers);
        const effectiveEnv = createEnvStore(rootPluginId(), this.#environment, this.#environmentLayers);
        const desiredEnv = createEnvStore(rootPluginId(), this.#environment, desiredEnvironment);
        const prepared = await handler.prepare({ current: lease.value, previous: document, next: candidate, desired, signal,
          environmentValueIsCurrent: name => (effectiveEnv.get(name) || undefined) === (desiredEnv.get(name) || undefined),
          expand: <T>(value: T): T => environment.expandMissingAsEmpty(value),
          hasEnvironmentValue: name => { const value = environment.get(name); return typeof value === 'string' && value.length > 0; },
          readRootResource: <T>(token: Token<T>) => this.snapshots.rootResource?.(lease, token) });
        if (!prepared || prepared.effect === 'restart-process') {
          groups.push(configGroup(handler.id, handler.paths, 'restart-process', 'restart-pending', prepared?.reasonCode ?? 'unsupported-update'));
          accepted.push(...handler.paths);
          continue;
        }
        for (const [token, value] of prepared.rootResources) {
          if (!isRootPrivateToken(token)) throw new TypeError('Configuration bindings must use genuine Root-private tokens');
          rootResources.set(token, value);
        }
        document = candidate;
        rawDocument = copyConfigurationPaths(rawDocument, rawDesired, handler.paths);
        accepted.push(...handler.paths);
        groups.push(configGroup(handler.id, handler.paths, prepared.effect, 'applied'));
      } catch {
        accepted.push(...handler.paths);
        groups.push(configGroup(handler.id, handler.paths, 'replace-resource', 'failed', 'preparation-failed'));
      } finally { lease.release(); }
    }
    for (const path of changed.filter(path => !accepted.some(owned => isPathWithin(path, owned)))) {
      groups.push(configGroup(`host:${path.join('/')}`, [path], 'restart-process', 'restart-pending', 'host-update-unavailable'));
    }
    return { document: rawDocument, groups, rootResources };
  }

  #selectPluginConfiguration(desired: RuntimeConfigDocument): Readonly<{ document: RuntimeConfigDocument; groups: readonly ConfigApplicationGroup[] }> {
    const selector = this.#pluginConfigurationSelection;
    if (!selector) return { document: desired, groups: [] };
    const previous = requireConfigDocument(this.#configDocument);
    const environment = createEnvStore(rootPluginId(), this.#environment, this.#environmentLayers);
    const selected = selector.select({ previous, next: desired, expand: <T>(value: T): T => environment.expandMissingAsEmpty(value) });
    let document = desired;
    const groups: ConfigApplicationGroup[] = [];
    const seen = new Set<string>();
    for (const { instanceKey, reasonCode } of selected) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(instanceKey) || APPLICATION_PLUGIN_RESERVED_KEYS.includes(instanceKey)
        || !reasonCode || seen.has(instanceKey)) throw new TypeError('Host Plugin selection must name unique safe instance aliases and reasons');
      seen.add(instanceKey);
      const paths = [[instanceKey], ['plugins', instanceKey]];
      document = copyConfigurationPaths(document, previous, paths);
      // Disabling an existing account is independent and takes effect now. Only
      // remove a disabled alias when masking a new declaration made it absent.
      if (readConfigurationPath(document, ['plugins', instanceKey]) === undefined && Array.isArray(document.disable_plugins)) {
        document = applyConfigPatches(document, [{ op: 'set', path: ['disable_plugins'], value: document.disable_plugins.filter(key => key !== instanceKey) }]);
      }
      if (paths.some(path => !isDeepStrictEqual(readConfigurationPath(previous, path), readConfigurationPath(desired, path)))) {
        groups.push(configGroup(`plugin-host:${instanceKey}`, paths, 'restart-process', 'restart-pending', reasonCode));
      }
    }
    return { document, groups };
  }

  async #validateConfigurationHandlers(desired: RuntimeConfigDocument, signal: AbortSignal, environment: EnvironmentLayers = this.#environmentLayers): Promise<void> {
    const lease = this.snapshot.generation ? this.snapshots.acquire() : undefined;
    const store = createEnvStore(rootPluginId(), this.#environment, environment);
    try {
      for (const handler of this.#configUpdates) await handler.validate?.({ current: this.snapshot,
        previous: this.#committedPrimaryConfig()?.document ?? this.#configDocument ?? {}, next: desired, signal,
        expand: <T>(value: T): T => store.expandMissingAsEmpty(value),
        hasEnvironmentValue: name => { const value = store.get(name); return typeof value === 'string' && value.length > 0; },
        readRootResource: <T>(token: Token<T>) => lease ? this.snapshots.rootResource?.(lease, token) : undefined,
      });
    } finally { lease?.release(); }
  }

  async #preparePureConfigViews(inspected: InspectedProject, roots: readonly PluginId[], signal: AbortSignal) {
    const config = new Map<PluginId, unknown>();
    const projections = new Map<FeatureId, unknown>();
    const retained = new Set<PluginId>();
    if (!this.#model) return { config, projections, roots };
    for (const node of graphNodes(inspected.graph.root)) {
      if (!roots.includes(node.id) || roots.some(root => root !== node.id && isWithinInvalidationRoot(node.id, root))) continue;
      const declaration = this.snapshot.tree.get(node.id)?.configUpdate;
      const view = inspected.configResolver(node);
      if (!declaration || changedConfigurationPaths(this.snapshot.config.get(node.id), view)
        .some(path => !declaration.featurePaths.some(owned => isPathWithin(path, owned)))) continue;
      const features = new Set([...this.snapshot.capabilities.values()].filter(slot => slot.owner === node.id).map(slot => slot.feature));
      const retainedFeatures = [...features].filter(id => this.#model!.providers.get(id)?.runtime.retain === 'when-owner-unchanged');
      if (!retainedFeatures.length || retainedFeatures.some(id => !this.#model!.providers.get(id)?.runtime.prepareConfigUpdate)) continue;
      const nextConfig = new Map([...this.snapshot.config, ...config, [node.id, inspected.configResolver(node)] as const]);
      const prepared = new Map<FeatureId, unknown>();
      for (const id of retainedFeatures) {
        const provider = this.#model.providers.get(id)!;
        const value = await provider.runtime.prepareConfigUpdate!(projections.get(id) ?? this.snapshot.projections.get(id), {
          snapshot: createSnapshotView(this.snapshot.generation + 1, { ...this.snapshot, config: nextConfig }), signal,
        }, [node.id]);
        if (value === undefined) break;
        prepared.set(id, value);
      }
      if (prepared.size !== retainedFeatures.length) continue;
      retained.add(node.id); config.set(node.id, nextConfig.get(node.id));
      for (const [feature, value] of prepared) projections.set(feature, value);
    }
    return { config, projections, roots: roots.filter(root => !retained.has(root)) };
  }

  #recordApplication(groups: readonly ConfigApplicationGroup[], saved: boolean, previousGeneration: number,
    sourceRevision = this.#configSnapshot?.revision ?? ''): void {
    if (this.snapshot.generation !== previousGeneration) this.#applicationRevision += 1;
    this.#configurationApplication = Object.freeze({ operationId: `config:${this.#operationNamespace}:${++this.#operationSequence}`, sourceRevision,
      saved, generation: this.snapshot.generation, applicationRevision: this.#applicationRevision, groups: Object.freeze([...groups]) });
  }

  #rejectedApplicationGroups(groups: readonly ConfigApplicationGroup[], error: unknown): readonly ConfigApplicationGroup[] {
    return groups.map(group => group.status !== 'applied' ? group : { ...group,
      status: this.#controller.state === 'failed' ? 'unknown' : error instanceof ConfigurationSupersededError ? 'superseded' : 'failed',
      reasonCode: this.#controller.state === 'failed' ? 'generation-integrity-failed' : error instanceof ConfigurationSupersededError ? 'source-revision-changed' : 'activation-failed',
    });
  }

  #preparedConfigurationGroups(groups: readonly ConfigApplicationGroup[], updates: RuntimeInputCandidate['configUpdates'],
    prepared: PreparedGeneration<RuntimeGenerationState>): readonly ConfigApplicationGroup[] {
    if (!updates?.config.size) return groups;
    const replacedOwner = [...updates.config.keys()].some(owner => this.#model?.scopes.get(owner) !== prepared.state.model?.scopes.get(owner));
    const replacedFeature = [...updates.projections].some(([feature, value]) => prepared.snapshot.projections.get(feature) !== value);
    if (!replacedOwner && !replacedFeature) return groups;
    // Source/manifest changes can legitimately replace a Feature or ancestor in
    // the same transaction. The config-only facade is only a retained seed,
    // never a promise that can override the real prepared projection/lifetime.
    return groups.map(group => group.id === 'plugins' && group.effect === 'in-place' ? { ...group,
      effect: replacedOwner ? 'reload-plugin' : 'replace-resource', reasonCode: 'concurrent-runtime-replacement' } : group);
  }

  #guardConfigurationSource(generation: PreparedGeneration<RuntimeGenerationState>, source?: ConfigDocumentSnapshot): PreparedGeneration<RuntimeGenerationState> {
    if (!source || !this.#configPort) return generation;
    const handoffs = new GenerationHandoffStack();
    if (generation.handoff) handoffs.add(generation.handoff);
    handoffs.add({ activateNext: async signal => {
      signal.throwIfAborted();
      if ((await this.#configPort!.read()).revision !== source.revision) throw new ConfigurationSupersededError();
    } });
    return { ...generation, handoff: handoffs.seal() };
  }

  async #bindConfigurationResources(generation: PreparedGeneration<RuntimeGenerationState>, resources?: ReadonlyMap<Token<unknown>, unknown>): Promise<PreparedGeneration<RuntimeGenerationState>> {
    const previousScope = this.#model?.scopes.get(this.snapshot.root);
    const nextScope = generation.state.model?.scopes.get(this.snapshot.root);
    if (previousScope !== nextScope) {
      // A new Root owns a new resource pool. Its installer must seed bindings
      // from the effective candidate; a prepared old-owner version cannot move.
      if ([...(resources?.keys() ?? [])].some(token => !nextScope?.has(token))) {
        await generation.dispose();
        throw new Error('A replaced Root owner did not provide its versioned configuration binding');
      }
      return { ...generation, state: { ...generation.state, rootResources: undefined } };
    }
    return { ...generation, state: { ...generation.state, rootResources: resources } };
  }

  #adoptRuntimeInputs(candidate: RuntimeInputCandidate): void {
    this.#configDocument = structuredClone(candidate.document);
    if (candidate.configSnapshot) this.#configSnapshot = candidate.configSnapshot;
    this.#environmentLayers = candidate.environmentLayers;
  }

  #runtimeInputState(): RuntimeInputState {
    return Object.freeze({
      document: this.#configDocument,
      configSnapshot: this.#configSnapshot,
      environmentLayers: this.#environmentLayers,
    });
  }

  #restoreRuntimeInputs(state: RuntimeInputState): void {
    this.#configDocument = state.document;
    this.#configSnapshot = state.configSnapshot;
    this.#environmentLayers = state.environmentLayers;
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
      if (this.#runtimeInputSources.has(normalizeSourcePath(source))) return true;
      const records = this.sourceOwnership.recordsFor(source);
      return records.length > 0 && records.every(
        (record) => record.role === 'plugin' || record.role === 'schema',
      );
    });
  }

  async #prepare(
    current: RuntimeSnapshot,
    signal: AbortSignal,
    document?: RuntimeConfigDocument,
    environmentLayers?: Readonly<EnvironmentLayers>,
  ): Promise<PreparedRuntimeGeneration> {
    signal.throwIfAborted();
    const inspected = await this.#inspectProject(document, environmentLayers);
    signal.throwIfAborted();
    return this.#prepareInspected(current, inspected, signal);
  }

  async #inspectProject(
    document?: RuntimeConfigDocument,
    environmentLayers: Readonly<EnvironmentLayers> = this.#environmentLayers,
    pluginOrder?: readonly string[],
  ): Promise<InspectedProject> {
    // Source reloads use the effective document. A saved pending Host change
    // must never be pulled in implicitly while rebuilding unrelated code.
    if (document === undefined && this.snapshot.generation === 0) await this.#refreshConfigDocument();
    const activeDocument = document ?? this.#configDocument;
    const resolver = await NodePackageResolver.create(this.#projectRoot);
    const graph = await new ProjectGraphService(resolver, {
      disabledPluginInstanceKeys: this.#disabledPluginInstanceKeys,
    }).inspect(this.#projectRoot, activeDocument, pluginOrder ?? (this.snapshot.generation > 0 && activeDocument
      ? effectivePluginOrder(activeDocument, this.#configSnapshot?.pluginOrder) : this.#configSnapshot?.pluginOrder));
    if (this.#configResolver) {
      const customResolver = this.#configResolver;
      const schemas = new Map(graphNodes(graph.root).flatMap(node => {
        const schema = customResolver.schema?.(node);
        return schema ? [[node.id, immutableConfigSchema(schema)] as const] : [];
      }));
      const configResolver: PluginConfigResolver = node => customResolver(node);
      configResolver.schema = node => schemas.get(node.id);
      configResolver.compositionMode = 'custom';
      if (this.snapshot.generation === 0) {
        this.#initialConfigSchemas = new Map(graphNodes(graph.root).flatMap(node => {
          const schema = schemas.get(node.id);
          return schema ? [[node.package.root, schema] as const] : [];
        }));
        this.#resolveConfigurationReady();
      }
      return {
        graph,
        configResolver,
        primaryConfigDocument: Object.freeze(structuredClone(activeDocument ?? {})),
        environmentLayers,
      };
    }
    const composed = await new ConfigComposer(this.#disabledPluginInstanceKeys, this.#modules)
      .compose(graph, activeDocument);
    if (this.snapshot.generation === 0) {
      this.#initialConfigSchemas = new Map(graphNodes(graph.root).flatMap(node => {
        const schema = composed.ownSchemas.get(node.id);
        return schema ? [[node.package.root, schema] as const] : [];
      }));
      this.#resolveConfigurationReady();
    }
    return {
      graph,
      configResolver: this.#configViewResolver(composed.views, environmentLayers, composed.ownSchemas),
      primaryConfigDocument: composed.document,
      environmentLayers,
      composed,
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
    environmentLayers: EnvironmentLayers = this.#environmentLayers,
    schemas?: ReadonlyMap<PluginId, Readonly<Record<string, unknown>>>,
  ): PluginConfigResolver {
    const resolver: PluginConfigResolver = (node) => {
      const view = views.get(node.id);
      if (view === undefined) return undefined;
      return createEnvStore(node.id, this.#environment, environmentLayers)
        .expandMissingAsEmpty(view);
    };
    resolver.schema = (node) => schemas?.get(node.id);
    resolver.compositionMode = 'document';
    return resolver;
  }

  #committedConfigComposer(): ConfigComposer {
    return new ConfigComposer([], undefined, new Map([...this.snapshot.tree.values()].flatMap(node =>
      node.configSchema ? [[node.id, node.configSchema] as const] : [],
    )));
  }

  #committedPrimaryConfig(): PrimaryConfig | undefined {
    return this.snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig | undefined;
  }

  #primaryConfigChanged(document: RuntimeConfigDocument): boolean {
    return !isDeepStrictEqual(this.#committedPrimaryConfig()?.document, document);
  }

  async #applyConfigPatches(patches: readonly ConfigPatch[], expectedSourceRevision?: string): Promise<RuntimeSnapshot> {
    if (this.#configResolver || !this.#configDocument) throw new Error('Config patches require a document-backed RootRuntime config');
    const previousGeneration = this.snapshot.generation;
    const currentSource = this.#configPort ? await this.#configPort.read() : this.#configSnapshot;
    if (expectedSourceRevision !== undefined && expectedSourceRevision !== (currentSource?.revision ?? '')) throw new ConfigurationSupersededError();
    const sourceDocument = currentSource?.document ?? this.#desiredDocument ?? this.#configDocument;
    const candidate = applyConfigPatches(sourceDocument, patches);
    const pluginOrder = patchedPluginOrder(currentSource?.pluginOrder, candidate, patches);
    // Reject the complete invalid candidate before saving anything. Preparation
    // of SDK resources is deliberately separate from this structural preflight.
    const desiredEnvironment = this.#environmentSource ? defineEnvironmentLayers(await this.#environmentSource.read()) : this.#environmentLayers;
    const desiredInspection = await this.#inspectProject(candidate, desiredEnvironment, pluginOrder);
    await this.#validateConfigurationHandlers(desiredInspection.primaryConfigDocument, new AbortController().signal, desiredEnvironment);
    if (this.#configPort && patches.length && (!isDeepStrictEqual(sourceDocument, candidate) || patches.some(patch => patch.path[0] === 'plugins'))) {
      const transaction = await this.#configPort.prepare(requireConfigDocumentSnapshot(currentSource), patches);
      if (!isDeepStrictEqual(transaction.document, candidate)) { await transaction.rollback(); throw new ConfigDocumentDivergenceError(); }
      // A committed source is never automatically restored after an application
      // failure: direct external edits already have these save/apply semantics.
      this.#configSnapshot = await transaction.commit();
    } else if (currentSource) this.#configSnapshot = currentSource;
    this.#desiredDocument = structuredClone(candidate);
    let groups: readonly ConfigApplicationGroup[] = [];
    let appliedInputs: RuntimeInputCandidate | undefined;
    try {
      const snapshot = await this.#reloadWithEvents({ target: rootPluginId(), trigger: 'manual', changed: [],
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
            prepared = await new TopologyGenerationPreparer(this.#modules, this.#model!, inspected.graph, inspected.configResolver,
              inspected.primaryConfigDocument, this.#environment, this.#installResources, inspected.environmentLayers, this.#isolation, planned.configUpdates).prepare(current, signal);
          } else if (!updates.roots.includes(rootPluginId())) {
            prepared = await this.#prepareSubtrees(current, inspected, updates.roots, signal, updates);
          } else prepared = await this.#prepareInspected(current, inspected, signal);
          if (!prepared) return undefined;
          groups = this.#preparedConfigurationGroups(groups, planned.configUpdates, prepared.generation);
          return this.#guardConfigurationSource(await this.#bindConfigurationResources(prepared.generation, planned.rootResources), planned.configSnapshot);
        },
      });
      if (appliedInputs) this.#adoptRuntimeInputs(appliedInputs);
      this.#recordApplication(groups, true, previousGeneration);
      return snapshot;
    } catch (error) {
      this.#recordApplication(this.#rejectedApplicationGroups(groups, error), true, previousGeneration);
      throw error;
    }
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
      inspected.environmentLayers,
      this.#isolation,
    );
    return assembler.prepare(signal);
  }

  async #prepareSubtrees(
    current: RuntimeSnapshot,
    inspected: InspectedProject,
    roots: readonly PluginId[],
    signal: AbortSignal,
    configUpdates?: Readonly<{ config: ReadonlyMap<PluginId, unknown>; projections: ReadonlyMap<FeatureId, unknown> }>,
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
        inspected.environmentLayers,
        this.#isolation,
        configUpdates,
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

function isPathWithin(path: readonly string[], parent: readonly string[]): boolean {
  return parent.length <= path.length && parent.every((part, index) => path[index] === part);
}

function configGroup(id: string, paths: readonly (readonly string[])[], effect: ConfigApplicationGroup['effect'],
  status: ConfigApplicationGroup['status'], reasonCode?: string): ConfigApplicationGroup {
  return Object.freeze({ id, paths: Object.freeze(paths.map(path => Object.freeze([...path]))), effect, status,
    ...(reasonCode ? { reasonCode } : {}), dependsOn: Object.freeze([]) });
}

/** Project validated source ordering onto the independently selected effective declarations. */
function effectivePluginOrder(document: RuntimeConfigDocument, source: readonly string[] | undefined): readonly string[] | undefined {
  if (!source) return undefined;
  const keys = Object.keys(document.plugins ?? {});
  return Object.freeze([...source.filter(key => keys.includes(key)), ...keys.filter(key => !source.includes(key))]);
}

/** Preserve known source ordering when a structural port omits optional write metadata. */
function patchedPluginOrder(
  previous: readonly string[] | undefined,
  candidate: RuntimeConfigDocument,
  patches: readonly ConfigPatch[],
): readonly string[] | undefined {
  if (!previous) return undefined;
  let order = [...previous];
  for (const patch of patches) {
    if (patch.path.length === 0 || (patch.path[0] === 'plugins' && patch.path.length === 1)) {
      const value = patch.path.length === 0 && patch.op === 'set'
        ? (patch.value as RuntimeConfigDocument)?.plugins : patch.op === 'set' ? patch.value : {};
      order = value && typeof value === 'object' ? Object.keys(value) : [];
    } else if (patch.path[0] === 'plugins' && patch.path[1]) {
      const key = patch.path[1];
      if (patch.op === 'remove') order = order.filter(alias => alias !== key);
      else if (!order.includes(key)) order.push(key);
    }
  }
  const plugins = candidate.plugins;
  const keys = plugins && typeof plugins === 'object' ? Object.keys(plugins) : [];
  return Object.freeze([...order.filter(key => keys.includes(key)), ...keys.filter(key => !order.includes(key))]);
}

function isWithinInvalidationRoot(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
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
      generation,
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
      this.#plugins.installSetupFeatureAliases(featureSetupAliases(this.#catalog.values()), this.#rootsByFeature);
      await this.#plugins.setupTree(this.graph.root, signal);
      await this.#discover(signal);
      const projected = await new FeatureProjector(this.#catalog.values(), this.#plugins.scopes.get(this.graph.root.id))
        .project(this.generation, this.#projectionState(), signal);
      for (const [feature, dispose] of projected.disposers) {
        this.#projectionDisposers.set(feature, dispose);
      }
      const state = projected.state;
      const snapshot = createSnapshotView(this.generation, state);
      this.#plugins.bindCandidateSnapshot(snapshot);
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

function graphNodes(node: PluginGraphNode): readonly PluginGraphNode[] {
  return [node, ...node.children.flatMap(graphNodes)];
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
