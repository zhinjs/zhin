import {
  AiHttpTransport, createSdkProviderAdapter, sdkEntryFromProvider, createLlmApiRuntime, type AIProvider,
} from '@zhin.js/ai';
import { createModelCatalog, ModelLeaseRuntime, ModelCatalogError, type ModelCatalogConfig, type ModelConnection, type ModelExecutionSource, type ModelLease, type ResolvedInvocation } from '@zhin.js/ai/model-catalog';
import { compileModelPolicy } from '../model-policy/policy.js';
import { compileRuntimePolicyRefsOverride, normalizeRuntimePolicyRefsOverride, runtimePolicyBelongsToRoot } from '../model-policy/runtime-policy.js';
import type { EffectiveModelPolicy, ModelPolicyConfig, ModelPurpose } from '../model-policy/types.js';
import { compileModelRuntimeConfig, legacyModelPresetId, LEGACY_PERCEPTION_PRESET, legacyConnectionBaseUrl } from './compiler.js';
import { configurationRestartReasons, versionConfiguration } from './configuration-version.js';
import type { NormalizedAiRoutingConfig } from '../config/normalize-ai-config.js';
import type { AgentBindingConfig, ProviderInstanceConfig } from '../config/types.js';
import { ModelRuntimeError, type ModelExecutionBundle, type ModelExecutionLease, type ModelExecutionScope, type ModelRuntimeServiceOptions,
  type ModelTurnResolveInput, type ResolvePresetOptions, type ResolvedModelExecutionScope,
  type HostModelSelection, type ResolvedHostProvider, type HostProviderLease } from './types.js';

type Resource = Omit<ModelExecutionBundle, 'invocation'> & {
  readonly scopedRuntimes: Map<string, ModelExecutionBundle['llmRuntime']>;
};
interface ModelRuntimeConstruction {
  readonly compiled: ReturnType<typeof compileModelRuntimeConfig>;
  readonly leases: ModelLeaseRuntime<Resource>;
}
export type ModelRuntimeConfigurationUpdate =
  | { readonly kind: 'ready'; readonly runtime: ModelRuntimeService }
  | { readonly kind: 'restart-required'; readonly reasons: readonly string[] };
function mergeCatalogs(base: ModelCatalogConfig, personal?: ModelCatalogConfig): ModelCatalogConfig {
  if (!personal) return base;
  const addition = createModelCatalog(personal).config;
  const merge = <T>(left: Readonly<Record<string, T>>, right: Readonly<Record<string, T>>): Record<string, T> => {
    const result = Object.assign(Object.create(null), left) as Record<string, T>;
    for (const [key, value] of Object.entries(right)) {
      if (Object.hasOwn(result, key) && JSON.stringify(result[key]) !== JSON.stringify(value)) throw new ModelRuntimeError('catalog-conflict');
      result[key] = value;
    }
    return result;
  };
  return { connections: merge(base.connections, addition.connections), models: merge(base.models, addition.models), presets: merge(base.presets, addition.presets) };
}
function bundle(lease: ModelLease<Resource>): ModelExecutionBundle {
  const { provider, llmRuntime } = lease.resource;
  const definition = lease.invocation.model;
  const cacheKey = JSON.stringify(definition);
  const cached = lease.resource.scopedRuntimes.get(cacheKey);
  if (cached) return Object.freeze({ provider, llmRuntime: cached, invocation: lease.invocation });
  const entry = sdkEntryFromProvider(provider);
  const config = { ...llmRuntime.providerConfig(provider.name), sdk: lease.invocation.connection.sdk,
    input: definition.capabilities.input ?? ['text'] as const,
    ...(definition.contextWindow !== undefined ? { contextWindow: definition.contextWindow } : {}),
    ...(definition.maxOutputTokens !== undefined ? { maxOutputTokens: definition.maxOutputTokens } : {}) };
  const models = [definition.model];
  const scoped = createLlmApiRuntime([{ ...entry, config, models }], () => models, (model, context) => {
    if (model.provider !== provider.name || model.id !== definition.model || model.sdk !== lease.invocation.connection.sdk) {
      throw new ModelCatalogError('invalid-config');
    }
    if (definition.capabilities.streaming === false
      || (definition.capabilities.toolCalling === false && (context.tools?.length ?? 0) > 0)) {
      throw new ModelCatalogError('unsupported-capability');
    }
  });
  lease.resource.scopedRuntimes.set(cacheKey, scoped);
  return Object.freeze({ provider, llmRuntime: scoped, invocation: lease.invocation });
}

/** One immutable deployment compiler and one revision-aware execution resource owner. */
export class ModelRuntimeService {
  readonly #compiled: ReturnType<typeof compileModelRuntimeConfig>;
  readonly #policy: ReturnType<typeof compileModelPolicy>;
  readonly #leases: ModelLeaseRuntime<Resource>;
  readonly #compatibility: NormalizedAiRoutingConfig;
  readonly #execution: ModelExecutionSource<Resource>;
  readonly #ownsLeases: boolean;
  readonly #plans = new WeakSet<ResolvedModelExecutionScope>();
  readonly #hostModels = new WeakSet<ResolvedInvocation>();
  readonly #hostProviders = new WeakMap<ResolvedHostProvider, ResolvedInvocation>();
  readonly #transferredProviders = new WeakSet<AIProvider>();
  private readonly options: ModelRuntimeServiceOptions;
  #closed = false;

  constructor(options: ModelRuntimeServiceOptions, /** @internal */ construction?: ModelRuntimeConstruction) {
    this.options = { ...options, config: structuredClone(options.config) };
    if (options.runtimePolicySnapshot && (!options.rootId || options.rootId !== options.rootId.trim())) throw new ModelRuntimeError('invalid-config');
    this.#compiled = construction?.compiled ?? compileModelRuntimeConfig(this.options.config, options.hostOwnerId, options.hostProviders);
    this.#policy = compileModelPolicy(this.#compiled.policyConfig);
    this.#compatibility = this.#compatibilityRouting();
    const configuredMcp = new Set(this.#compatibility.mcpServerNames);
    if (configuredMcp.size !== this.#compatibility.mcpServerNames.length) throw new ModelRuntimeError('invalid-config');
    for (const binding of Object.values(this.#compatibility.agents)) {
      if (binding.mcpServers?.some(name => typeof name !== 'string' || !name.trim() || !configuredMcp.has(name))) throw new ModelRuntimeError('invalid-config');
    }
    this.#execution = {
      secrets: { resolve: async connection => {
        if (connection.ownerId === options.hostOwnerId) {
          const data = this.#compiled.hostFactoryData.get(connection.id);
          if (data && connection.secretRef === `legacy:secret:${encodeURIComponent(data.alias)}` && data.config?.apiKey) return data.config.apiKey;
        }
        return options.secretResolver?.(connection);
      } },
      factory: { create: async (connection, secret) => this.#createResource(connection, secret) },
    };
    this.#ownsLeases = construction === undefined;
    this.#leases = construction?.leases ?? new ModelLeaseRuntime(this.#execution);
  }

  /** Prepare an immutable view; no active binding, secret resolver or provider is touched.
   * The replacement borrows this Root Scope's pool, rather than owning an independent
   * pool. Retain the original owner until that Scope retires; retiring a configuration
   * snapshot must not dispose the Scope owner. Dispose a borrowed view only to close it.
   */
  prepareConfiguration(config: ModelRuntimeServiceOptions['config']): ModelRuntimeConfigurationUpdate {
    this.#assertOpen();
    // A registered provider is a startup owner, not authority over a later authored definition.
    const nextOptions = { ...this.options, config: structuredClone(config), hostProviders: undefined };
    const candidate = compileModelRuntimeConfig(nextOptions.config, this.options.hostOwnerId);
    const reasons = configurationRestartReasons(this.options.config, nextOptions.config, this.#compiled, candidate);
    if (reasons.length) return Object.freeze({ kind: 'restart-required', reasons });
    return Object.freeze({ kind: 'ready', runtime: new ModelRuntimeService(nextOptions, {
      compiled: versionConfiguration(this.#compiled, candidate), leases: this.#leases,
    }) });
  }

  getCatalogConfig(): ModelCatalogConfig { return this.#compiled.catalogConfig; }
  getPolicyConfig(): ModelPolicyConfig { return this.#compiled.policyConfig; }
  /** Authoring baseline preserves omission as inheritance rather than exposing a baked summary reference. */
  getPolicyBaseline(): ModelPolicyConfig {
    if (!this.#compiled.summaryInheritsChat) return this.#compiled.policyConfig;
    const { summary: _inherited, ...defaults } = this.#compiled.policyConfig.defaults;
    return Object.freeze({ ...this.#compiled.policyConfig, defaults: Object.freeze(defaults) });
  }
  getCompatibilityRouting(): NormalizedAiRoutingConfig { return this.#compatibility; }
  presetForLegacyModel(alias: string, requested?: string): string {
    const data = [...this.#compiled.hostFactoryData.values()].find(entry => entry.alias === alias);
    const model = requested ?? data?.config?.defaultModel ?? data?.config?.models?.[0];
    if (!model) throw new ModelRuntimeError('migration-model-missing');
    const presetId = legacyModelPresetId(alias, model);
    if (!Object.hasOwn(this.#compiled.catalogConfig.presets, presetId)) throw new ModelRuntimeError('invalid-config');
    return presetId;
  }
  #compatibilityRouting(): NormalizedAiRoutingConfig {
    const providers: Record<string, ProviderInstanceConfig> = Object.create(null);
    const agents: Record<string, AgentBindingConfig> = Object.create(null);
    const catalog = createModelCatalog(this.#compiled.catalogConfig);
    for (const connection of Object.values(catalog.config.connections)) {
      if (connection.ownerId !== this.options.hostOwnerId) continue;
      const alias = this.#compiled.hostFactoryData.get(connection.id)?.executionAlias ?? connection.id;
      providers[alias] = { sdk: connection.sdk, ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
        models: Object.values(catalog.config.models).filter(model => model.connectionId === connection.id).map(model => model.model) };
    }
    for (const [name, presetId] of Object.entries(this.#compiled.bindingPresets)) {
      const invocation = catalog.resolve(presetId, { ownerId: this.options.hostOwnerId, hostOwnerId: this.options.hostOwnerId });
      const alias = this.#compiled.hostFactoryData.get(invocation.connection.id)?.executionAlias ?? invocation.connection.id;
      const original = this.options.config.agents?.[name];
      agents[name] = { provider: alias, model: invocation.model.model,
        ...(original?.mcpServers ? { mcpServers: [...original.mcpServers] } : {}),
        ...(original?.nickname !== undefined ? { nickname: original.nickname } : {}),
        ...(original?.permission ? { permission: structuredClone(original.permission) as AgentBindingConfig['permission'] } : {}) };
    }
    const mcpServerNames = (this.options.config.mcpServers ?? []).map(server => server.name);
    return { providers, agents, mcpServerNames };
  }
  presetForBinding(name: string): string {
    const preset = this.#compiled.bindingPresets[name];
    if (!preset) throw new ModelRuntimeError('unknown-binding');
    return preset;
  }

  async resolvePreset(presetId: string, options: ResolvePresetOptions): Promise<ResolvedInvocation> {
    this.#assertOpen();
    const ownerId = options.ownerId;
    const catalog = await this.#catalog(ownerId);
    return catalog.resolve(presetId, { ownerId, hostOwnerId: this.options.hostOwnerId }, options.requirements);
  }

  /** Capture the deployment reviewer/judge model, independent of personal and runtime chat overrides. */
  resolveHostModel(selection?: HostModelSelection): ResolvedInvocation {
    this.#assertOpen();
    const catalog = createModelCatalog(this.#compiled.catalogConfig);
    const owner = { ownerId: this.options.hostOwnerId, hostOwnerId: this.options.hostOwnerId };
    let invocation: ResolvedInvocation;
    if (selection && 'presetId' in selection) invocation = catalog.resolve(selection.presetId, owner);
    else if (!selection || 'bindingName' in selection) invocation = catalog.resolve(this.presetForBinding(selection?.bindingName ?? 'zhin'), owner);
    else {
      const alias = selection.providerAlias ?? this.#compatibility.agents.zhin?.provider;
      const requested = selection.model ?? (alias ? this.#compatibility.providers[alias]?.models?.[0] : undefined);
      const connectionId = [...this.#compiled.hostFactoryData].find(([, data]) => data.executionAlias === alias)?.[0];
      const model = Object.values(catalog.config.models).find(model => model.connectionId === connectionId && model.model === requested);
      if (!model) throw new ModelRuntimeError('invalid-config');
      // Judges select a model directly, not preset options or a session policy.
      invocation = Object.freeze({ connection: catalog.config.connections[model.connectionId]!, model,
        preset: Object.freeze({ id: `host:judge:${encodeURIComponent(model.id)}`, modelId: model.id }) });
    }
    this.#hostModels.add(invocation);
    return invocation;
  }

  /** Standalone Host subagents use deployment routing, never a parent's personal chat selection. */
  resolveHostScope(selection?: HostModelSelection): ResolvedModelExecutionScope {
    const chat = this.resolveHostModel(selection);
    const catalog = createModelCatalog(this.#compiled.catalogConfig);
    const owner = { ownerId: this.options.hostOwnerId, hostOwnerId: this.options.hostOwnerId };
    const perception = this.#policy.config.defaults.perception;
    const refs = Object.freeze({ ...this.#policy.config.defaults, chat: chat.preset.id });
    const policy: EffectiveModelPolicy = Object.freeze({ refs,
      sources: Object.freeze(Object.fromEntries(Object.keys(refs).map(purpose => [purpose,
        Object.freeze({ level: 'default' as const, rootId: this.options.rootId ?? this.options.hostOwnerId })]))) });
    const resolved = Object.freeze({ chat, policy,
      ...(perception ? { perception: catalog.resolve(perception, owner) } : {}),
      ...(perception === LEGACY_PERCEPTION_PRESET && this.#compiled.perceptionFallbackPresets.length
        ? { perceptionFallbacks: Object.freeze(this.#compiled.perceptionFallbackPresets.map(preset => catalog.resolve(preset, owner))) } : {}),
    });
    this.#plans.add(resolved);
    return resolved;
  }

  async acquireResolvedHostModel(invocation: ResolvedInvocation, signal?: AbortSignal): Promise<ModelExecutionLease> {
    this.#assertOpen();
    if (!this.#hostModels.has(invocation)) throw new ModelRuntimeError('invalid-config');
    const lease = await this.#leases.acquire(invocation, { signal, execution: this.#execution });
    return Object.freeze({ ...bundle(lease), release: () => lease.release() });
  }

  /** Provider-only operations retain their explicit model input; only the deployment connection is selected here. */
  resolveHostProvider(alias: string): ResolvedHostProvider {
    this.#assertOpen();
    const entry = [...this.#compiled.hostFactoryData].find(([, data]) => data.executionAlias === alias);
    const connection = entry && this.#compiled.catalogConfig.connections[entry[0]];
    if (!connection || connection.ownerId !== this.options.hostOwnerId) throw new ModelRuntimeError('host-connection-unavailable');
    const defaults = Object.freeze({ ...this.options.config.imageGeneration, ...entry[1].config?.imageGeneration });
    const plan = Object.freeze({ connection, defaults });
    // The pool leases connections. This private placeholder never selects a model,
    // changes the chat allowlist, or escapes to prompts; each operation keeps its own input.
    const model = Object.freeze({ id: 'host:provider', connectionId: connection.id, model: 'host:provider', capabilities: {} });
    this.#hostProviders.set(plan, Object.freeze({ connection, model, preset: Object.freeze({ id: 'host:provider', modelId: model.id }) }));
    return plan;
  }

  async acquireResolvedHostProvider(plan: ResolvedHostProvider, signal?: AbortSignal): Promise<HostProviderLease> {
    this.#assertOpen();
    const invocation = this.#hostProviders.get(plan);
    if (!invocation) throw new ModelRuntimeError('invalid-config');
    const lease = await this.#leases.acquire(invocation, { signal, execution: this.#execution });
    return Object.freeze({ provider: lease.resource.provider, defaults: plan.defaults, release: () => lease.release() });
  }

  validateRuntimePolicyOverride(input: unknown, rootId: string) {
    const refsOverride = normalizeRuntimePolicyRefsOverride(input);
    if (!runtimePolicyBelongsToRoot(refsOverride, rootId)) throw new ModelRuntimeError('invalid-config');
    const catalog = createModelCatalog(this.#compiled.catalogConfig);
    const fields = [refsOverride.defaults, ...Object.values(refsOverride.adapters ?? {}),
      ...(refsOverride.endpoints ?? []).map(entry => entry.models), ...(refsOverride.scenes ?? []).map(entry => entry.models)];
    for (const patch of fields) for (const preset of Object.values(patch)) {
      catalog.resolve(preset, { ownerId: this.options.hostOwnerId, hostOwnerId: this.options.hostOwnerId });
    }
    return refsOverride;
  }

  async resolveForTurn(input: ModelTurnResolveInput): Promise<ResolvedModelExecutionScope> {
    this.#assertOpen();
    const runtimePolicy = await this.options.runtimePolicySnapshot?.();
    if (this.options.runtimePolicySnapshot && (!runtimePolicy || !Number.isSafeInteger(runtimePolicy.revision) || runtimePolicy.revision < 0)) throw new ModelRuntimeError('invalid-config');
    const policyRevision = runtimePolicy?.revision;
    const refsOverride = runtimePolicy ? this.validateRuntimePolicyOverride(runtimePolicy.refsOverride, input.rootId) : undefined;
    const summarySource = refsOverride?.defaults.summary !== undefined ? 'runtime' as const
      : this.#compiled.summaryInheritsChat ? 'deployment-chat' as const : 'static' as const;
    const currentPolicy = refsOverride ? compileRuntimePolicyRefsOverride(this.#compiled.policyConfig,
      refsOverride, this.#compiled.summaryInheritsChat) : this.#policy;
    const role = input.bindingName !== undefined && input.bindingName !== 'zhin';
    const resolver = role ? compileModelPolicy({ defaults: { ...currentPolicy.config.defaults, chat: this.presetForBinding(input.bindingName!) } }) : currentPolicy;
    const policy: EffectiveModelPolicy = input.origin ? resolver.resolve({ origin: input.origin, rootId: input.rootId,
      ...(!role && input.sessionSelection ? { session: { chat: input.sessionSelection } } : {}) }) : Object.freeze({
      refs: resolver.config.defaults,
      sources: Object.freeze(Object.fromEntries(Object.keys(resolver.config.defaults).map(purpose => [purpose, Object.freeze({ level: 'default' as const, rootId: input.rootId })]))),
    });
    const ownerId = input.ownerId;
    const chat = policy.refs.chat;
    if (!chat) throw new ModelRuntimeError('chat-preset-missing');
    const catalog = await this.#catalog(ownerId);
    const owner = { ownerId, hostOwnerId: this.options.hostOwnerId };
    const resolved = Object.freeze({ summarySource, ...(policyRevision !== undefined ? { policyRevision } : {}), chat: catalog.resolve(chat, owner),
      ...(policy.refs.perception ? { perception: catalog.resolve(policy.refs.perception, owner) } : {}),
      ...(policy.refs.summary ? { summary: catalog.resolve(policy.refs.summary, owner) } : {}),
      ...(policy.refs.perception === LEGACY_PERCEPTION_PRESET && this.#compiled.perceptionFallbackPresets.length
        ? { perceptionFallbacks: Object.freeze(this.#compiled.perceptionFallbackPresets.map(preset => catalog.resolve(preset, owner))) } : {}), policy });
    this.#plans.add(resolved);
    return resolved;
  }

  async acquireDefaultForTurn(signal?: AbortSignal): Promise<ModelExecutionScope | ModelExecutionLease> {
    this.#assertOpen();
    if (this.options.acquireDeploymentDefault) return this.options.acquireDeploymentDefault(signal);
    return this.options.rootId !== undefined
      ? this.acquireForTurn({ rootId: this.options.rootId, ownerId: this.options.hostOwnerId }, signal)
      : this.acquirePreset(this.presetForBinding('zhin'), { ownerId: this.options.hostOwnerId }, signal);
  }

  /** Capture explicit reference strings at construction, without freezing future Host connection revisions. */
  createServiceAgentAcquirer(selection: HostModelSelection): (signal?: AbortSignal) => Promise<ModelExecutionLease> {
    this.#assertOpen();
    const reference = Object.freeze({ ...selection });
    if (this.options.acquireDeploymentSelection) return signal => {
      this.#assertOpen();
      return this.options.acquireDeploymentSelection!(reference, signal);
    };
    // Standalone embedders preserve synchronous selection validation and their fixed-view contract.
    const presetId = 'presetId' in reference ? reference.presetId : 'bindingName' in reference ? this.presetForBinding(reference.bindingName)
      : this.presetForLegacyModel(reference.providerAlias ?? this.#compatibility.agents.zhin!.provider, reference.model);
    return signal => this.acquirePreset(presetId, { ownerId: this.options.hostOwnerId }, signal);
  }

  async acquirePreset(presetId: string, options: ResolvePresetOptions, signal?: AbortSignal): Promise<ModelExecutionLease> {
    const invocation = await this.resolvePreset(presetId, options);
    this.#assertOpen();
    this.#assertTransport(invocation);
    const lease = await this.#leases.acquire(invocation, { signal, execution: this.#execution });
    return Object.freeze({ ...bundle(lease), release: () => lease.release() });
  }

  async acquireForTurn(input: ModelTurnResolveInput, signal?: AbortSignal): Promise<ModelExecutionScope> {
    const resolved = await this.resolveForTurn(input);
    return this.acquireResolvedForTurn(resolved, signal);
  }

  /** Execute only after leaving configuration admission; factory/secret work may be asynchronous. */
  async acquireResolvedForTurn(resolved: ResolvedModelExecutionScope, signal?: AbortSignal): Promise<ModelExecutionScope> {
    this.#assertOpen();
    if (!this.#plans.has(resolved)) throw new ModelRuntimeError('invalid-config');
    const acquired: ModelLease<Resource>[] = [];
    for (const invocation of [resolved.chat, resolved.perception, resolved.summary, ...(resolved.perceptionFallbacks ?? [])]) {
      if (invocation) this.#assertTransport(invocation);
    }
    const perceptionFallbacks: ModelExecutionBundle[] = [];
    const bundles: Partial<Record<ModelPurpose, ModelExecutionBundle>> = {};
    try {
      // One catalog/policy snapshot was resolved above before the first asynchronous operation.
      for (const purpose of ['chat', 'perception', 'summary'] as const) {
        const invocation = resolved[purpose];
        if (!invocation) continue;
        const lease = await this.#leases.acquire(invocation, { signal, execution: this.#execution });
        acquired.push(lease);
        bundles[purpose] = bundle(lease);
      }
      for (const invocation of resolved.perceptionFallbacks ?? []) {
        const lease = await this.#leases.acquire(invocation, { signal, execution: this.#execution });
        acquired.push(lease);
        perceptionFallbacks.push(bundle(lease));
      }
    } catch (error) {
      await Promise.all(acquired.map(lease => lease.release().catch(() => undefined)));
      throw error;
    }
    let release: Promise<void> | undefined;
    return Object.freeze({ chat: bundles.chat!, ...(bundles.perception ? { perception: bundles.perception } : {}),
      ...(bundles.summary ? { summary: bundles.summary } : {}),
      ...(perceptionFallbacks.length ? { perceptionFallbacks: Object.freeze(perceptionFallbacks) } : {}), policy: resolved.policy, summarySource: resolved.summarySource, ...(resolved.policyRevision !== undefined ? { policyRevision: resolved.policyRevision } : {}),
      release: () => release ??= Promise.all(acquired.map(lease => lease.release())).then(() => undefined) });
  }

  async #createResource(connection: ModelConnection, secret: string | undefined) {
    const isHost = connection.ownerId === this.options.hostOwnerId;
    const legacy = isHost ? this.#compiled.hostFactoryData.get(connection.id) : undefined;
    const candidate = legacy?.origin === 'legacy' ? legacy.provider : undefined;
    const original = candidate ? sdkEntryFromProvider(candidate).config : undefined;
    const borrowed = candidate && !this.#transferredProviders.has(candidate) && original?.sdk === connection.sdk
      && legacyConnectionBaseUrl(original) === connection.baseUrl
      && original.apiKey === secret ? candidate : undefined;
    const alias = legacy?.executionAlias ?? connection.id;
    // The immutable invocation creates a model-restricted runtime in bundle(), without rereading a catalog.
    const models = isHost ? Object.values(this.#compiled.catalogConfig.models).filter(model => model.connectionId === connection.id).map(model => model.model) : [];
    const { apiKey: _legacyKey, baseUrl: _legacyUrl, host: _legacyHost, sdk: _legacySdk, models: _legacyModels, accountId: _legacyAccount, ...privateConfig } = legacy?.config ?? {};
    const config = { ...privateConfig, sdk: connection.sdk, ...(connection.baseUrl !== undefined ? { baseUrl: connection.baseUrl } : {}),
      ...(secret !== undefined ? { apiKey: secret } : {}),
      // Legacy Cloudflare accountId was also an adapter admission signal. Its URL
      // is already canonical above; explicit catalogs never inherit this routing field.
      ...(legacy?.origin === 'legacy' && _legacyAccount ? { accountId: _legacyAccount } : {}), models };
    const personalFetch = isHost ? undefined : this.options.personalFetchFactory?.(connection);
    if (!isHost && typeof personalFetch !== 'function') throw new ModelRuntimeError('personal-transport-unavailable');
    const transport = isHost
      ? this.options.hostTransportFactory?.(connection) ?? new AiHttpTransport()
      : new AiHttpTransport({ fetch: personalFetch });
    const provider = borrowed ?? createSdkProviderAdapter(alias, config, transport);
    if (!provider) {
      await transport.dispose();
      throw new ModelRuntimeError('host-connection-unavailable');
    }
    try {
      const entry = sdkEntryFromProvider(provider);
      // Entries and configs stay private to execution. A fresh runtime isolates SDK caches by lease connection.
      const llmRuntime = createLlmApiRuntime([{ ...entry, config, models }], () => models);
      const scopedRuntimes: Resource['scopedRuntimes'] = new Map();
      const disposeTransferred = borrowed ? this.options.takeHostProviderOwnership?.(borrowed) : undefined;
      if (borrowed && disposeTransferred) this.#transferredProviders.add(borrowed);
      return { resource: Object.freeze({ provider, llmRuntime, scopedRuntimes }), dispose: async () => {
        scopedRuntimes.clear();
        if (disposeTransferred) await disposeTransferred();
        if (!borrowed && 'dispose' in provider && typeof provider.dispose === 'function') await provider.dispose();
        if (borrowed) await transport.dispose();
      } };
    } catch (error) {
      if (!borrowed && 'dispose' in provider && typeof provider.dispose === 'function') await provider.dispose();
      if (borrowed) await transport.dispose();
      throw error;
    }
  }

  #assertTransport(invocation: ResolvedInvocation): void {
    if (invocation.connection.ownerId !== this.options.hostOwnerId && !this.options.personalFetchFactory) {
      throw new ModelRuntimeError('personal-transport-unavailable');
    }
  }
  async #catalog(ownerId: string) {
    const personal = ownerId === this.options.hostOwnerId ? undefined : await this.options.personalCatalogSnapshot?.(ownerId);
    return createModelCatalog(mergeCatalogs(this.#compiled.catalogConfig, personal));
  }
  #assertOpen(): void {
    if (this.#closed) throw new ModelRuntimeError('disposed');
  }
  dispose(): Promise<void> {
    this.#closed = true;
    return this.#ownsLeases ? this.#leases.dispose() : Promise.resolve();
  }
}
