import {
  defaultModelInput, isSdkId, SdkProviderAdapter, sdkEntryFromProvider,
  type AIConfig, type AIProvider, type ProviderInstanceConfig, type ProviderCapabilities,
} from '@zhin.js/ai';
import { normalizeModelCatalogConfig, type CatalogModel, type ModelConnection, type ModelPreset, type ModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import { normalizeProviderEntry, rejectRemovedAiConfigFields } from '../config/normalize-ai-config.js';
import { resolvePerceptionConfig } from '../config/perception-config.js';
import { compileModelPolicy } from '../model-policy/policy.js';
import type { ModelPolicyConfig } from '../model-policy/types.js';
import { ModelRuntimeError, type ModelRuntimeConfig } from './types.js';
import { normalizeHostModelCatalog } from './authoring.js';

export const legacyConnectionId = (alias: string): string => `legacy:connection:${encodeURIComponent(alias)}`;
export const legacyModelId = (alias: string, model: string): string => `legacy:model:${encodeURIComponent(alias)}:${encodeURIComponent(model)}`;
export const legacyAgentPresetId = (name: string): string => `legacy:agent:${encodeURIComponent(name)}`;
export const legacyModelPresetId = (alias: string, model: string): string => `legacy:model-preset:${encodeURIComponent(alias)}:${encodeURIComponent(model)}`;
export const LEGACY_PERCEPTION_PRESET = 'legacy:perception';

type HostProviderSnapshot = ProviderInstanceConfig & { readonly capabilities?: ProviderCapabilities };
interface HostProviderSource {
  readonly alias: string;
  readonly config: HostProviderSnapshot;
  readonly provider?: AIProvider;
}
type HostFactoryData =
  | (HostProviderSource & { readonly origin: 'legacy'; readonly executionAlias: string })
  | { readonly origin: 'explicit'; readonly alias: string; readonly executionAlias: string; readonly config?: HostProviderSnapshot; readonly provider?: never };
export interface CompiledModelRuntime {
  readonly catalogConfig: ModelCatalogConfig;
  readonly policyConfig: ModelPolicyConfig;
  readonly summaryInheritsChat: boolean;
  readonly perceptionFallbackPresets: readonly string[];
  readonly bindingPresets: Readonly<Record<string, string>>;
  /** Internal compiler-to-execution data. Never projected to prompts, journals or config APIs. */
  readonly hostFactoryData: ReadonlyMap<string, HostFactoryData>;
}
export function legacyConnectionBaseUrl(config: ProviderInstanceConfig): string | undefined {
  return config.baseUrl?.trim() || config.host?.trim() || (config.sdk === 'openai-compatible' && config.accountId?.trim()
    ? `https://api.cloudflare.com/client/v4/accounts/${config.accountId.trim()}/ai/v1` : undefined);
}
function legacyLimit(value: number | undefined): number | undefined {
  return typeof value === 'number' && value <= 0 ? undefined : value;
}
function canonical(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value === value.trim(); }

/** Legacy is translated once here. All execution consumers see only catalog/policy references. */
export function compileModelRuntimeConfig(config: ModelRuntimeConfig, hostOwnerId: string, providers?: ReadonlyMap<string, AIProvider>): CompiledModelRuntime {
  if (!canonical(hostOwnerId)) throw new ModelRuntimeError('invalid-config');
  rejectRemovedAiConfigFields(config as AIConfig);
  const connections: Record<string, ModelConnection> = Object.create(null);
  const models: Record<string, CatalogModel> = Object.create(null);
  const presets: Record<string, ModelPreset> = Object.create(null);
  const bindingPresets: Record<string, string> = Object.create(null);
  const perceptionFallbackPresets: string[] = [];
  const sourceFactoryData = new Map<string, HostProviderSource>();
  const rawProviders = config.providers ?? {};
  for (const [alias, raw] of Object.entries(rawProviders)) {
    if (!raw || typeof raw !== 'object') throw new ModelRuntimeError('invalid-config');
    const declared = normalizeProviderEntry(alias, raw);
    const registered = providers?.get(alias);
    const effective = registered instanceof SdkProviderAdapter ? sdkEntryFromProvider(registered).config : declared;
    const value: HostProviderSnapshot = structuredClone(effective);
    if (!isSdkId(value.sdk)) throw new ModelRuntimeError('invalid-config');
    const connectionId = legacyConnectionId(alias);
    const baseUrl = legacyConnectionBaseUrl(value);
    connections[connectionId] = { id: connectionId, ownerId: hostOwnerId, revision: 1, sdk: value.sdk,
      ...(baseUrl ? { baseUrl } : {}), ...(value.apiKey?.trim() ? { secretRef: `legacy:secret:${encodeURIComponent(alias)}` } : {}) };
    sourceFactoryData.set(connectionId, { alias, config: value, provider: providers?.get(alias) });
  }
  const addModel = (alias: string, requested: string | undefined): string => {
    const data = sourceFactoryData.get(legacyConnectionId(alias));
    if (!data) throw new ModelRuntimeError('migration-provider-missing');
    const model = requested?.trim() || data.config.defaultModel?.trim() || data.config.models?.[0]?.trim();
    if (!model) throw new ModelRuntimeError('migration-model-missing');
    const allowlist = (data.config.models ?? []).map(id => id.trim()).filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(model)) throw new ModelRuntimeError('invalid-config');
    const modelId = legacyModelId(alias, model);
    const input = data.config.input ?? data.config.capabilities?.input ?? defaultModelInput(data.config.sdk, model);
    const contextWindow = legacyLimit(data.config.contextWindow);
    const maxOutputTokens = legacyLimit(data.config.maxOutputTokens);
    models[modelId] = { id: modelId, connectionId: legacyConnectionId(alias), model,
      capabilities: { ...data.config.capabilities, input },
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}) };
    return modelId;
  };
  if (config.modelCatalog === undefined) {
    for (const { alias, config: provider } of sourceFactoryData.values()) {
      const configured = [provider.defaultModel, ...(provider.models ?? [])].filter((model): model is string => canonical(model));
      for (const model of configured) {
        const presetId = legacyModelPresetId(alias, model);
        presets[presetId] = { id: presetId, modelId: addModel(alias, model) };
      }
    }
    for (const [name, binding] of Object.entries(config.agents ?? {})) {
      if (binding.preset !== undefined && (binding.provider !== undefined || binding.model !== undefined)) throw new ModelRuntimeError('invalid-config');
      if (binding.preset !== undefined) { bindingPresets[name] = binding.preset; continue; }
      if (!canonical(binding.provider)) throw new ModelRuntimeError('migration-provider-missing');
      const presetId = legacyAgentPresetId(name);
      const modelId = addModel(binding.provider, binding.model);
      presets[presetId] = { id: presetId, modelId };
      const modelPreset = legacyModelPresetId(binding.provider, models[modelId].model);
      presets[modelPreset] = { id: modelPreset, modelId };
      bindingPresets[name] = presetId;
    }

  } else {
    for (const [name, binding] of Object.entries(config.agents ?? {})) {
      if (binding.preset !== undefined && (binding.provider !== undefined || binding.model !== undefined)) throw new ModelRuntimeError('invalid-config');
      if (binding.preset !== undefined) bindingPresets[name] = binding.preset;
      else if (name !== 'zhin' || binding.provider !== undefined || binding.model !== undefined) throw new ModelRuntimeError('invalid-config');
    }
  }
  const perception = resolvePerceptionConfig(config.multimodal?.perception, Object.keys(rawProviders));
  if (perception) {
    presets[LEGACY_PERCEPTION_PRESET] = { id: LEGACY_PERCEPTION_PRESET, modelId: addModel(perception.provider, perception.model) };
    for (const [index, fallback] of (perception.fallbacks ?? []).entries()) {
      const presetId = `legacy:perception-fallback:${index}`;
      presets[presetId] = { id: presetId, modelId: addModel(fallback.provider, fallback.model) };
      perceptionFallbackPresets.push(presetId);
    }
  }
  let catalogConfig: ModelCatalogConfig;
  let legacyConnectionIds: ReadonlySet<string>;
  if (config.modelCatalog) {
    const explicit = normalizeHostModelCatalog(config.modelCatalog, hostOwnerId);
    const referenced = new Set(Object.values(models).map(model => model.connectionId));
    legacyConnectionIds = referenced;
    const legacy = normalizeModelCatalogConfig({ connections: Object.fromEntries(Object.entries(connections).filter(([id]) => referenced.has(id))), models, presets });
    const append = <T>(left: Readonly<Record<string, T>>, right: Readonly<Record<string, T>>): Record<string, T> => {
      const result = Object.assign(Object.create(null), left) as Record<string, T>;
      for (const [id, entry] of Object.entries(right)) {
        if (Object.hasOwn(result, id) && JSON.stringify(result[id]) !== JSON.stringify(entry)) throw new ModelRuntimeError('catalog-conflict');
        result[id] = entry;
      }
      return result;
    };
    catalogConfig = normalizeModelCatalogConfig({ connections: append(explicit.connections, legacy.connections), models: append(explicit.models, legacy.models), presets: append(explicit.presets, legacy.presets) });
  } else {
    catalogConfig = normalizeModelCatalogConfig({ connections, models, presets });
    legacyConnectionIds = new Set(Object.keys(connections));
  }
  if (Object.values(catalogConfig.connections).some(connection => connection.ownerId !== hostOwnerId)) {
    throw new ModelRuntimeError('deployment-owner-mismatch');
  }
  // An explicit catalog never silently derives its defaults from insertion order.
  const base = bindingPresets.zhin;
  if (config.modelCatalog !== undefined && !config.modelPolicy?.defaults?.chat) throw new ModelRuntimeError('migration-default-missing');
  const legacyPerception = presets[LEGACY_PERCEPTION_PRESET] ? { perception: LEGACY_PERCEPTION_PRESET } : {};
  const policyInput = config.modelPolicy ? {
    ...config.modelPolicy, defaults: { ...legacyPerception, ...config.modelPolicy.defaults },
  } : { defaults: { ...(base ? { chat: base, summary: base } : {}), ...legacyPerception } };
  const defaults = policyInput.defaults.summary === undefined && policyInput.defaults.chat !== undefined
    ? { ...policyInput.defaults, summary: policyInput.defaults.chat } : policyInput.defaults;
  const policyConfig = compileModelPolicy({ ...policyInput, defaults }).config;
  if (!policyConfig.defaults.chat) throw new ModelRuntimeError('migration-default-missing');
  const patches = [policyConfig.defaults, ...Object.values(policyConfig.adapters ?? {}), ...(policyConfig.endpoints ?? []).map(entry => entry.models), ...(policyConfig.scenes ?? []).map(entry => entry.models)];
  for (const patch of patches) for (const presetId of Object.values(patch)) {
    if (!Object.hasOwn(catalogConfig.presets, presetId)) throw new ModelRuntimeError('invalid-config');
  }
  for (const presetId of Object.values(bindingPresets)) {
    if (!Object.hasOwn(catalogConfig.presets, presetId)) throw new ModelRuntimeError('invalid-config');
  }
  // Primary compatibility and standalone callers project the same effective
  // deployment chat reference. Authored references above are still validated.
  bindingPresets.zhin = policyConfig.defaults.chat;
  const hostFactoryData = new Map<string, HostFactoryData>();
  // Public legacy aliases retain their objects. Explicit execution identities are
  // allocated once, in canonical order, and never reuse a legacy Provider instance.
  const reservedAliases = new Set(Object.keys(rawProviders));
  const hostConnections = Object.values(catalogConfig.connections).filter(connection => connection.ownerId === hostOwnerId)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const connection of hostConnections) {
    if (legacyConnectionIds.has(connection.id)) {
      const source = sourceFactoryData.get(connection.id);
      if (!source) throw new ModelRuntimeError('invalid-config');
      hostFactoryData.set(connection.id, { ...source, origin: 'legacy', executionAlias: source.alias });
      continue;
    }
    const source = sourceFactoryData.get(legacyConnectionId(connection.id)) ?? sourceFactoryData.get(connection.id);
    let executionAlias = connection.id;
    while (reservedAliases.has(executionAlias)) executionAlias = `catalog:${encodeURIComponent(executionAlias)}`;
    reservedAliases.add(executionAlias);
    hostFactoryData.set(connection.id, { origin: 'explicit', executionAlias, alias: source?.alias ?? connection.id,
      ...(source ? { config: source.config } : {}) });
  }
  return Object.freeze({ catalogConfig, policyConfig, summaryInheritsChat: config.modelPolicy?.defaults.summary === undefined, bindingPresets: Object.freeze(bindingPresets), perceptionFallbackPresets: Object.freeze(perceptionFallbackPresets), hostFactoryData });
}
