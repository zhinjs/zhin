import { isDeepStrictEqual } from 'node:util';
import {
  applyConfigPatches, createSnapshotView, FEATURE_OVERRIDES_KEY, GenerationHandoffStack, isRootPrivateToken, rootPluginId,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch, type ControlErrorHandler,
  type FeatureId, type PluginId, type PreparedGeneration, type RuntimeConfigDocument,
  type RuntimeSnapshot, type SnapshotReader, type Token,
} from '@zhin.js/plugin-runtime';
import { APPLICATION_PLUGIN_RESERVED_KEYS } from './application-plugin-declaration.js';
import {
  ConfigComposer, ConfigValidationError, HOST_RESOURCE_CONFIG_KEYS,
  type ComposedConfig, type JsonSchema,
} from './config-composer.js';
import type {
  ConfigApplicationGroup, RootConfigUpdateHandler, RootPluginConfigurationSelection,
} from './configuration-application.js';
import { changedConfigurationPaths, copyConfigurationPaths, readConfigurationPath } from './configuration-paths.js';
import type { RuntimeEnvironment } from './environment.js';
import {
  createEnvStore, defineEnvironmentLayers,
  type EnvironmentLayers, type EnvironmentLayersPort,
} from './environment-store.js';
import type { ProcessInvalidationPlan } from './invalidation-planner.js';
import type { ModuleRuntime } from './module-runtime.js';
import { NodePackageResolver } from './package-resolver.js';
import { immutableConfigSchema } from './plugin-config-schema.js';
import type { PluginConfigResolver, RootResourceInstaller } from './plugin-scope-assembler.js';
import { primaryConfigToken, type PrimaryConfig } from './primary-config.js';
import { ProjectGraphService, type PluginGraphNode, type ProjectGraph } from './project-graph.js';
import type { RuntimeGenerationModel, RuntimeGenerationState } from './runtime-generation.js';
import { RuntimeInputPlanner } from './runtime-input-planner.js';
import { normalizeSourcePath } from './source-path.js';
import { TopologyTransactionPlanner } from './topology-transaction.js';

export class ConfigurationSupersededError extends Error {
  readonly code = 'configuration_superseded';
  constructor() { super('Configuration source changed during application'); this.name = 'ConfigurationSupersededError'; }
}

export interface InspectedProject {
  readonly graph: ProjectGraph;
  readonly configResolver: PluginConfigResolver;
  readonly primaryConfigDocument: RuntimeConfigDocument;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
  readonly composed?: ComposedConfig;
}

export interface RuntimeInputCandidate {
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

export interface RuntimeInputState {
  readonly document?: RuntimeConfigDocument;
  readonly configSnapshot?: ConfigDocumentSnapshot;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
}

export function validateConfigUpdateHandlerDeclarations(handlers: readonly RootConfigUpdateHandler[]): void {
  const ownedPaths: Array<readonly string[]> = [];
  const handlerIds = new Set<string>();
  for (const handler of handlers) {
    if (!handler.id || handlerIds.has(handler.id)) throw new TypeError('Configuration update handler ids must be unique');
    handlerIds.add(handler.id);
    for (const path of handler.paths) {
      if (!path.length || !HOST_RESOURCE_CONFIG_KEYS.includes(path[0]!) || path.some(part => !part || ['__proto__', 'constructor', 'prototype'].includes(part))) {
        throw new TypeError('Configuration update paths must name safe Host fields');
      }
      if (ownedPaths.some(previous => isPathWithin(path, previous) || isPathWithin(previous, path))) {
        throw new TypeError('Configuration update paths overlap');
      }
      ownedPaths.push(path);
    }
  }
}

export function createConfigViewResolver(
  environment: RuntimeEnvironment,
  views: ReadonlyMap<PluginId, unknown>,
  environmentLayers: EnvironmentLayers,
  schemas?: ReadonlyMap<PluginId, Readonly<Record<string, unknown>>>,
): PluginConfigResolver {
  const resolver: PluginConfigResolver = (node) => {
    const view = views.get(node.id);
    if (view === undefined) return undefined;
    return createEnvStore(node.id, environment, environmentLayers).expandMissingAsEmpty(view);
  };
  resolver.schema = (node) => schemas?.get(node.id);
  resolver.compositionMode = 'document';
  return resolver;
}

export function buildCommittedConfigComposer(snapshot: RuntimeSnapshot): ConfigComposer {
  return new ConfigComposer([], undefined, new Map([...snapshot.tree.values()].flatMap(node =>
    node.configSchema ? [[node.id, node.configSchema] as const] : [],
  )));
}

export function readCommittedPrimaryConfig(snapshot: RuntimeSnapshot): PrimaryConfig | undefined {
  return snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig | undefined;
}

export function hasPrimaryConfigChanged(snapshot: RuntimeSnapshot, document: RuntimeConfigDocument): boolean {
  return !isDeepStrictEqual(readCommittedPrimaryConfig(snapshot)?.document, document);
}

export interface InspectProjectContext {
  readonly projectRoot: string;
  readonly modules: ModuleRuntime;
  readonly environment: RuntimeEnvironment;
  readonly disabledPluginInstanceKeys: readonly string[];
  readonly configResolver?: PluginConfigResolver;
  readonly snapshot: RuntimeSnapshot;
  readonly getConfigDocument: () => RuntimeConfigDocument | undefined;
  readonly getConfigSnapshot: () => ConfigDocumentSnapshot | undefined;
  readonly refreshConfigDocument: () => Promise<void>;
  readonly onInitialSchemas: (schemas: ReadonlyMap<string, JsonSchema>) => void;
  /** Live committed snapshot for Plugin `configFor` / `isEnabledFor` (ADR 0050). */
  readonly readCommittedSnapshot?: () => RuntimeSnapshot;
}

export async function inspectRuntimeProject(
  ctx: InspectProjectContext,
  document: RuntimeConfigDocument | undefined,
  environmentLayers: Readonly<EnvironmentLayers>,
  pluginOrder?: readonly string[],
): Promise<InspectedProject> {
  if (document === undefined && ctx.snapshot.generation === 0) await ctx.refreshConfigDocument();
  const activeDocument = document ?? ctx.getConfigDocument();
  const configSnapshot = ctx.getConfigSnapshot();
  const resolver = await NodePackageResolver.create(ctx.projectRoot);
  const graph = await new ProjectGraphService(resolver, {
    disabledPluginInstanceKeys: ctx.disabledPluginInstanceKeys,
  }).inspect(ctx.projectRoot, activeDocument, pluginOrder ?? (ctx.snapshot.generation > 0 && activeDocument
    ? effectivePluginOrder(activeDocument, configSnapshot?.pluginOrder) : configSnapshot?.pluginOrder));
  if (ctx.configResolver) {
    const customResolver = ctx.configResolver;
    const schemas = new Map(graphNodes(graph.root).flatMap(node => {
      const schema = customResolver.schema?.(node);
      return schema ? [[node.id, immutableConfigSchema(schema)] as const] : [];
    }));
    const configResolver: PluginConfigResolver = node => customResolver(node);
    configResolver.schema = node => schemas.get(node.id);
    configResolver.compositionMode = 'custom';
    if (ctx.readCommittedSnapshot) configResolver.readCommittedSnapshot = ctx.readCommittedSnapshot;
    if (ctx.snapshot.generation === 0) {
      ctx.onInitialSchemas(new Map(graphNodes(graph.root).flatMap(node => {
        const schema = schemas.get(node.id);
        return schema ? [[node.package.root, schema] as const] : [];
      })));
    }
    return {
      graph, configResolver,
      primaryConfigDocument: Object.freeze(structuredClone(activeDocument ?? {})),
      environmentLayers,
    };
  }
  const composed = await new ConfigComposer(ctx.disabledPluginInstanceKeys, ctx.modules).compose(graph, activeDocument);
  if (ctx.snapshot.generation === 0) {
    ctx.onInitialSchemas(new Map(graphNodes(graph.root).flatMap(node => {
      const schema = composed.ownSchemas.get(node.id);
      return schema ? [[node.package.root, schema] as const] : [];
    })));
  }
  const configResolver = createConfigViewResolver(ctx.environment, composed.views, environmentLayers, composed.ownSchemas);
  if (ctx.readCommittedSnapshot) configResolver.readCommittedSnapshot = ctx.readCommittedSnapshot;
  return {
    graph,
    configResolver,
    primaryConfigDocument: composed.document,
    environmentLayers,
    composed,
  };
}

export function selectPluginConfiguration(
  selector: RootPluginConfigurationSelection | undefined,
  previousDocument: RuntimeConfigDocument | undefined,
  environment: RuntimeEnvironment,
  environmentLayers: Readonly<EnvironmentLayers>,
  desired: RuntimeConfigDocument,
): Readonly<{ document: RuntimeConfigDocument; groups: readonly ConfigApplicationGroup[] }> {
  if (!selector) return { document: desired, groups: [] };
  const previous = requireConfigDocument(previousDocument);
  const envStore = createEnvStore(rootPluginId(), environment, environmentLayers);
  const selected = selector.select({ previous, next: desired, expand: <T>(value: T): T => envStore.expandMissingAsEmpty(value) });
  let document = desired;
  const groups: ConfigApplicationGroup[] = [];
  const seen = new Set<string>();
  for (const { instanceKey, reasonCode } of selected) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(instanceKey) || APPLICATION_PLUGIN_RESERVED_KEYS.includes(instanceKey)
      || !reasonCode || seen.has(instanceKey)) {
      throw new TypeError('Host Plugin selection must name unique safe instance aliases and reasons');
    }
    seen.add(instanceKey);
    const paths = [[instanceKey], ['plugins', instanceKey]];
    document = copyConfigurationPaths(document, previous, paths);
    if (readConfigurationPath(document, ['plugins', instanceKey]) === undefined && Array.isArray(document.disable_plugins)) {
      document = applyConfigPatches(document, [{ op: 'set', path: ['disable_plugins'], value: document.disable_plugins.filter(key => key !== instanceKey) }]);
    }
    if (paths.some(path => !isDeepStrictEqual(readConfigurationPath(previous, path), readConfigurationPath(desired, path)))) {
      groups.push(configGroup(`plugin-host:${instanceKey}`, paths, 'restart-process', 'restart-pending', reasonCode));
    }
  }
  return { document, groups };
}

export interface ConfigurationHandlerContext {
  readonly snapshot: RuntimeSnapshot;
  readonly snapshots: SnapshotReader;
  readonly environment: RuntimeEnvironment;
  readonly environmentLayers: Readonly<EnvironmentLayers>;
  readonly configDocument?: RuntimeConfigDocument;
  readonly configUpdates: readonly RootConfigUpdateHandler[];
  readonly installResources?: RootResourceInstaller;
  readonly pluginConfigurationSelection?: RootPluginConfigurationSelection;
  readonly onControlError: ControlErrorHandler;
}

export async function validateConfigurationHandlers(
  ctx: ConfigurationHandlerContext,
  desired: RuntimeConfigDocument,
  signal: AbortSignal,
  environment: EnvironmentLayers = ctx.environmentLayers,
): Promise<void> {
  const lease = ctx.snapshot.generation ? ctx.snapshots.acquire() : undefined;
  const store = createEnvStore(rootPluginId(), ctx.environment, environment);
  const previous = readCommittedPrimaryConfig(ctx.snapshot)?.document ?? ctx.configDocument ?? {};
  try {
    for (const handler of ctx.configUpdates) {
      await handler.validate?.({
        current: ctx.snapshot, previous, next: desired, signal,
        expand: <T>(value: T): T => store.expandMissingAsEmpty(value),
        hasEnvironmentValue: name => { const value = store.get(name); return typeof value === 'string' && value.length > 0; },
        readRootResource: <T>(token: Token<T>) => lease ? ctx.snapshots.rootResource?.(lease, token) : undefined,
      });
    }
  } finally { lease?.release(); }
}

export async function selectRuntimeConfiguration(
  ctx: ConfigurationHandlerContext,
  desired: RuntimeConfigDocument,
  signal: AbortSignal,
  rawDesired: RuntimeConfigDocument,
  desiredEnvironment: EnvironmentLayers,
): Promise<Readonly<{ document: RuntimeConfigDocument; groups: readonly ConfigApplicationGroup[]; rootResources: ReadonlyMap<Token<unknown>, unknown> }>> {
  const previous = readCommittedPrimaryConfig(ctx.snapshot)?.document ?? requireConfigDocument(ctx.configDocument);
  const pluginSelection = selectPluginConfiguration(ctx.pluginConfigurationSelection, ctx.configDocument, ctx.environment, ctx.environmentLayers, rawDesired);
  let rawDocument = pluginSelection.document;
  const groups: ConfigApplicationGroup[] = [...pluginSelection.groups];
  const rootResources = new Map<Token<unknown>, unknown>();
  const changed = HOST_RESOURCE_CONFIG_KEYS.flatMap(key => changedConfigurationPaths(previous[key], desired[key], [key]));
  if (!ctx.installResources) {
    if (changed.length) groups.push(configGroup('host-document', changed, 'in-place', 'applied'));
    return { document: rawDocument, groups, rootResources };
  }
  let document = copyConfigurationPaths(desired, previous, HOST_RESOURCE_CONFIG_KEYS.map(key => [key]));
  rawDocument = copyConfigurationPaths(rawDocument, ctx.configDocument ?? {}, HOST_RESOURCE_CONFIG_KEYS.map(key => [key]));
  const accepted: Array<readonly string[]> = [];
  for (const handler of ctx.configUpdates) {
    if (!handler.paths.some(path => !isDeepStrictEqual(readConfigurationPath(previous, path), readConfigurationPath(desired, path)))) continue;
    const candidate = copyConfigurationPaths(document, desired, handler.paths);
    const lease = ctx.snapshots.acquire();
    try {
      const environment = createEnvStore(rootPluginId(), ctx.environment, ctx.environmentLayers);
      const effectiveEnv = createEnvStore(rootPluginId(), ctx.environment, ctx.environmentLayers);
      const desiredEnv = createEnvStore(rootPluginId(), ctx.environment, desiredEnvironment);
      const prepared = await handler.prepare({
        current: lease.value, previous: document, next: candidate, desired, signal,
        environmentValueIsCurrent: name => (effectiveEnv.get(name) || undefined) === (desiredEnv.get(name) || undefined),
        expand: <T>(value: T): T => environment.expandMissingAsEmpty(value),
        hasEnvironmentValue: name => { const value = environment.get(name); return typeof value === 'string' && value.length > 0; },
        readRootResource: <T>(token: Token<T>) => ctx.snapshots.rootResource?.(lease, token),
      });
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
    } catch (error) {
      try {
        void Promise.resolve(ctx.onControlError(Object.assign(new Error('Host configuration preparation failed'), {
          code: 'configuration_preparation_failed', handler: handler.id,
          errorKind: error instanceof ConfigValidationError ? 'validation' : error instanceof TypeError ? 'type'
            : error instanceof RangeError ? 'range' : 'unknown',
        }))).catch(() => undefined);
      } catch { /* Diagnostics cannot reverse a configuration outcome. */ }
      accepted.push(...handler.paths);
      groups.push(configGroup(handler.id, handler.paths, 'replace-resource', 'failed', 'preparation-failed'));
    } finally { lease.release(); }
  }
  for (const path of changed.filter(path => !accepted.some(owned => isPathWithin(path, owned)))) {
    groups.push(configGroup(`host:${path.join('/')}`, [path], 'restart-process', 'restart-pending', 'host-update-unavailable'));
  }
  return { document: rawDocument, groups, rootResources };
}

export async function preparePureConfigViews(
  snapshot: RuntimeSnapshot,
  model: RuntimeGenerationModel | undefined,
  inspected: InspectedProject,
  roots: readonly PluginId[],
  signal: AbortSignal,
) {
  const config = new Map<PluginId, unknown>();
  const projections = new Map<FeatureId, unknown>();
  const retained = new Set<PluginId>();
  if (!model) return { config, projections, roots };
  for (const node of graphNodes(inspected.graph.root)) {
    if (!roots.includes(node.id) || roots.some(root => root !== node.id && isWithinInvalidationRoot(node.id, root))) continue;
    const declaration = snapshot.tree.get(node.id)?.configUpdate;
    const view = inspected.configResolver(node);
    if (!declaration || changedConfigurationPaths(snapshot.config.get(node.id), view)
      .some(path => !declaration.featurePaths.some(owned => isPathWithin(path, owned)))) continue;
    const features = new Set([...snapshot.capabilities.values()].filter(slot => slot.owner === node.id).map(slot => slot.feature));
    const retainedFeatures = [...features].filter(id => model.providers.get(id)?.runtime.retain === 'when-owner-unchanged');
    if (!retainedFeatures.length || retainedFeatures.some(id => !model.providers.get(id)?.runtime.prepareConfigUpdate)) continue;
    const nextConfig = new Map([...snapshot.config, ...config, [node.id, inspected.configResolver(node)] as const]);
    const prepared = new Map<FeatureId, unknown>();
    for (const id of retainedFeatures) {
      const provider = model.providers.get(id)!;
      const value = await provider.runtime.prepareConfigUpdate!(projections.get(id) ?? snapshot.projections.get(id), {
        snapshot: createSnapshotView(snapshot.generation + 1, { ...snapshot, config: nextConfig }), signal,
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

export interface PlanRuntimeInputsContext extends ConfigurationHandlerContext {
  readonly modules: ModuleRuntime;
  readonly disabledPluginInstanceKeys: readonly string[];
  readonly runtimeInputSources: ReadonlySet<string>;
  readonly configPort?: ConfigDocumentPort;
  readonly configSnapshot?: ConfigDocumentSnapshot;
  readonly desiredDocument?: RuntimeConfigDocument;
  readonly environmentSource?: EnvironmentLayersPort;
  readonly model?: RuntimeGenerationModel;
  readonly inspectProject: (document?: RuntimeConfigDocument, environmentLayers?: Readonly<EnvironmentLayers>, pluginOrder?: readonly string[]) => Promise<InspectedProject>;
}

export async function planRuntimeInputs(
  ctx: PlanRuntimeInputsContext,
  changed: readonly string[],
  signal: AbortSignal,
  explicit?: Readonly<{ document: RuntimeConfigDocument; snapshot?: ConfigDocumentSnapshot; pluginOrder?: readonly string[]; inspection?: InspectedProject }>,
): Promise<RuntimeInputCandidate | ProcessInvalidationPlan | undefined> {
  const inputSources = new Set(changed.map((source) => normalizeSourcePath(source)).filter((source) => ctx.runtimeInputSources.has(source)));
  if ((!explicit && inputSources.size === 0) || !ctx.model) return undefined;
  const configChanged = !!explicit || (ctx.configPort?.sources?.some((source) => inputSources.has(normalizeSourcePath(source))) ?? false);
  const environmentChanged = !!ctx.environmentSource && (configChanged || (ctx.environmentSource.sources.some((source) => inputSources.has(normalizeSourcePath(source)))));
  const configSnapshot = explicit?.snapshot ?? (configChanged ? await ctx.configPort?.read() : undefined);
  const desired = explicit?.document ?? configSnapshot?.document ?? ctx.configSnapshot?.document ?? ctx.desiredDocument ?? requireConfigDocument(ctx.configDocument);
  let environmentLayers = environmentChanged && ctx.environmentSource
    ? defineEnvironmentLayers(await ctx.environmentSource.read())
    : ctx.environmentLayers;
  const pluginOrder = explicit?.pluginOrder ?? configSnapshot?.pluginOrder ?? ctx.configSnapshot?.pluginOrder;
  const validated = explicit?.inspection && isDeepStrictEqual(explicit.inspection.environmentLayers, environmentLayers)
    ? explicit.inspection : undefined;
  const desiredInspection = validated ?? await ctx.inspectProject(desired, environmentLayers, pluginOrder);
  if (!validated) await validateConfigurationHandlers(ctx, desiredInspection.primaryConfigDocument, signal, environmentLayers);
  const selected = await selectRuntimeConfiguration(ctx, desiredInspection.primaryConfigDocument, signal, desired, environmentLayers);
  const document = selected.document;
  const environmentGroups: ConfigApplicationGroup[] = [];
  if (environmentChanged && ctx.installResources && !isDeepStrictEqual(ctx.environmentLayers, environmentLayers)) {
    environmentLayers = ctx.environmentLayers;
    environmentGroups.push(configGroup('environment', [], 'restart-process', 'restart-pending', 'environment-host-consumers'));
  }
  const unchangedDesired = isDeepStrictEqual(document, desired) && isDeepStrictEqual(environmentLayers, desiredInspection.environmentLayers);
  const inspected = unchangedDesired ? desiredInspection : await ctx.inspectProject(document, environmentLayers, effectivePluginOrder(document, pluginOrder));
  if (!unchangedDesired) await validateConfigurationHandlers(ctx, inspected.primaryConfigDocument, signal, environmentLayers);
  const committedPrimary = readCommittedPrimaryConfig(ctx.snapshot);
  const inputPlan = await new RuntimeInputPlanner(
    new ConfigComposer(ctx.disabledPluginInstanceKeys, ctx.modules),
    buildCommittedConfigComposer(ctx.snapshot),
  ).plan({
    graph: ctx.model.graph, nextGraph: inspected.graph, environment: ctx.environment,
    previousDocument: requireConfigDocument(ctx.configDocument), nextDocument: document,
    previousEnvironment: ctx.environmentLayers, nextEnvironment: environmentLayers,
    ...(inspected.composed && committedPrimary ? {
      composed: inspected.composed,
      committed: { expandedDocument: committedPrimary.expanded, expandedViews: ctx.snapshot.config },
    } : {}),
  });
  const updates = await preparePureConfigViews(ctx.snapshot, ctx.model, inspected, inputPlan.roots, signal);
  const pluginPaths = isDeepStrictEqual(ctx.configDocument, document) ? []
    : changedConfigurationPaths(ctx.configDocument, document).filter(path => !HOST_RESOURCE_CONFIG_KEYS.includes(path[0]!));
  // Edits of only the legacy `overrides` blocks (ADR 0050; since ADR 0057 §2 only their one-time
  // removal after the import into the database) apply in place: no owner reloads.
  const overridesOnly = pluginPaths.length > 0 && pluginPaths.every(path => isFeatureOverridePath(document, path));
  return Object.freeze({
    document, configSnapshot, environmentLayers, inputSources, roots: updates.roots, inspected,
    topologyChanged: new TopologyTransactionPlanner().plan(ctx.model.graph, inspected.graph).changed,
    primaryConfigChanged: hasPrimaryConfigChanged(ctx.snapshot, inspected.primaryConfigDocument),
    applicationGroups: [...selected.groups, ...environmentGroups,
      ...((!isDeepStrictEqual(ctx.configDocument, document) && inputPlan.roots.length) || overridesOnly
        ? [configGroup('plugins', pluginPaths, updates.roots.length ? 'reload-plugin' : 'in-place', 'applied')] : []),
    ],
    rootResources: selected.rootResources, configUpdates: updates,
  });
}

/** `<alias>[/<child>...]/overrides/...` of a declared Plugin instance block (the legacy block, ADR 0057 §2). */
export function isFeatureOverridePath(document: RuntimeConfigDocument, path: readonly string[]): boolean {
  const declared = document.plugins && typeof document.plugins === 'object' ? document.plugins : {};
  const index = path.indexOf(FEATURE_OVERRIDES_KEY);
  return index >= 1 && Object.hasOwn(declared, path[0]!) && path.slice(1, index).every(segment => /^[a-z0-9][a-z0-9-]*$/u.test(segment));
}

export function rejectedApplicationGroups(
  groups: readonly ConfigApplicationGroup[],
  error: unknown,
  controllerState: string,
): readonly ConfigApplicationGroup[] {
  return groups.map(group => group.status !== 'applied' ? group : { ...group,
    status: controllerState === 'failed' ? 'unknown' : error instanceof ConfigurationSupersededError ? 'superseded' : 'failed',
    reasonCode: controllerState === 'failed' ? 'generation-integrity-failed' : error instanceof ConfigurationSupersededError ? 'source-revision-changed' : 'activation-failed',
  });
}

export function preparedConfigurationGroups(
  groups: readonly ConfigApplicationGroup[],
  updates: RuntimeInputCandidate['configUpdates'],
  currentModel: RuntimeGenerationModel | undefined,
  prepared: PreparedGeneration<RuntimeGenerationState>,
): readonly ConfigApplicationGroup[] {
  if (!updates?.config.size) return groups;
  const replacedOwner = [...updates.config.keys()].some(owner => currentModel?.scopes.get(owner) !== prepared.state.model?.scopes.get(owner));
  const replacedFeature = [...updates.projections].some(([feature, value]) => prepared.snapshot.projections.get(feature) !== value);
  if (!replacedOwner && !replacedFeature) return groups;
  return groups.map(group => group.id === 'plugins' && group.effect === 'in-place' ? { ...group,
    effect: replacedOwner ? 'reload-plugin' : 'replace-resource', reasonCode: 'concurrent-runtime-replacement' } : group);
}

export function guardConfigurationSource(
  generation: PreparedGeneration<RuntimeGenerationState>,
  configPort: ConfigDocumentPort | undefined,
  source?: ConfigDocumentSnapshot,
): PreparedGeneration<RuntimeGenerationState> {
  if (!source || !configPort) return generation;
  const handoffs = new GenerationHandoffStack();
  if (generation.handoff) handoffs.add(generation.handoff);
  handoffs.add({ activateNext: async signal => {
    signal.throwIfAborted();
    if ((await configPort.read()).revision !== source.revision) throw new ConfigurationSupersededError();
  } });
  return { ...generation, handoff: handoffs.seal() };
}

export async function bindConfigurationResources(
  rootId: PluginId,
  currentModel: RuntimeGenerationModel | undefined,
  generation: PreparedGeneration<RuntimeGenerationState>,
  resources?: ReadonlyMap<Token<unknown>, unknown>,
): Promise<PreparedGeneration<RuntimeGenerationState>> {
  const previousScope = currentModel?.scopes.get(rootId);
  const nextScope = generation.state.model?.scopes.get(rootId);
  if (previousScope !== nextScope) {
    if ([...(resources?.keys() ?? [])].some(token => !nextScope?.has(token))) {
      await generation.dispose();
      throw new Error('A replaced Root owner did not provide its versioned configuration binding');
    }
    return { ...generation, state: { ...generation.state, rootResources: undefined } };
  }
  return { ...generation, state: { ...generation.state, rootResources: resources } };
}

export function isPathWithin(path: readonly string[], parent: readonly string[]): boolean {
  return parent.length <= path.length && parent.every((part, index) => path[index] === part);
}

export function graphNodes(node: PluginGraphNode): readonly PluginGraphNode[] {
  return [node, ...node.children.flatMap(graphNodes)];
}

export function isWithinInvalidationRoot(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}

export function configGroup(
  id: string, paths: readonly (readonly string[])[],
  effect: ConfigApplicationGroup['effect'], status: ConfigApplicationGroup['status'], reasonCode?: string,
): ConfigApplicationGroup {
  return Object.freeze({ id, paths: Object.freeze(paths.map(path => Object.freeze([...path]))), effect, status,
    ...(reasonCode ? { reasonCode } : {}), dependsOn: Object.freeze([]) });
}

export function effectivePluginOrder(document: RuntimeConfigDocument, source: readonly string[] | undefined): readonly string[] | undefined {
  if (!source) return undefined;
  const keys = Object.keys(document.plugins ?? {});
  return Object.freeze([...source.filter(key => keys.includes(key)), ...keys.filter(key => !source.includes(key))]);
}

export function patchedPluginOrder(
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

export function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function' && typeof candidate.prepare === 'function';
}

export function requireConfigDocumentSnapshot(snapshot: ConfigDocumentSnapshot | undefined): ConfigDocumentSnapshot {
  if (!snapshot) throw new Error('ConfigDocumentPort has not been read');
  return snapshot;
}

export function requireConfigDocument(document: RuntimeConfigDocument | undefined): RuntimeConfigDocument {
  if (!document) throw new Error('Config patches require a document-backed RootRuntime config');
  return document;
}

export function cloneConfigPatches(patches: readonly ConfigPatch[]): readonly ConfigPatch[] {
  return Object.freeze(patches.map((patch) => Object.freeze(
    patch.op === 'set'
      ? { ...patch, path: Object.freeze([...patch.path]), value: structuredClone(patch.value) }
      : { ...patch, path: Object.freeze([...patch.path]) },
  )));
}
