import {
  normalizeProviderJson, providerPlanFingerprint,
  type JsonObject, type ModelDefinition, type ProfileSelection, type ProviderDriverReference,
} from '@zhin.js/ai/provider';

/** A source stamp produced by the Host's selected legacy metadata reader, not by HTTP input. */
export interface LegacyInferenceSource {
  readonly id: string;
  readonly revision: string;
  readonly rootId: string;
}
export interface LegacyModelMetadata {
  readonly id: string;
  readonly input?: readonly string[];
  readonly capabilities?: JsonObject;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly requiredKind?: 'image';
}
export interface LegacyServiceResolution {
  readonly driver: ProviderDriverReference;
  readonly options: JsonObject;
  readonly models: Readonly<Record<string, ModelDefinition>>;
  readonly authentication: 'none' | 'api-key';
  /** Selected Driver's pure Profile schema. Nonempty legacy parameters require this validator. */
  readonly parameters?: (input: Readonly<{ model: ModelDefinition; parameters: JsonObject }>) => JsonObject;
}
export interface LegacyInferenceMigrationOptions {
  readonly source: LegacyInferenceSource;
  readonly target: Readonly<{ rootId: string; hostOwnerId: string; ownerId?: string }>;
  readonly config: unknown;
  /** Administrator-selected destinations for retired alias-based harness rules. */
  readonly harnessTargets?: Readonly<Record<string, readonly Readonly<{ serviceAlias: string; model?: string }>[]>>;
  /** Pure local, explicitly selected Driver/schema/catalog resolution. Never fetch or read a credential. */
  readonly resolveService: (input: Readonly<{
    sourceId: string; sdk: string; options: JsonObject; models: readonly LegacyModelMetadata[];
  }>) => LegacyServiceResolution | undefined;
  /** Structural account/scene addresses must be resolved by the Host's trusted identity reader. */
  readonly scopeKey?: (input: Readonly<{ kind: 'endpoint' | 'scene'; address: JsonObject }>) => string | undefined;
}
export type LegacyCredentialReference =
  | Readonly<{ kind: 'environment'; reference: string }>
  | Readonly<{ kind: 'legacy-vault'; reference: string }>
  | Readonly<{ kind: 'legacy-config'; path: string }>;
export interface LegacyInferenceMigration {
  readonly version: 1;
  readonly source: LegacyInferenceSource & Readonly<{ fingerprint: string }>;
  readonly target: LegacyInferenceMigrationOptions['target'];
  /** Aliases only. Actual resource IDs are allocated by the separately approved Host review/apply. */
  readonly plan: JsonObject;
  readonly profileMappings: readonly Readonly<{ legacyPresetId: string; profileAlias: string }>[];
  readonly harnessServiceMappings: readonly Readonly<{ sourcePaths: readonly string[]; serviceAlias: string; model?: string; settings: JsonObject }>[];
  readonly workroomServiceMappings: readonly Readonly<{ legacyProviderAlias: string; serviceAlias: string; contract: JsonObject }>[];
  readonly credentials: readonly Readonly<{ accountAlias: string; source: LegacyCredentialReference }>[];
  readonly blocked: readonly Readonly<{ path: string; code: string }>[];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() === value && value ? value : undefined; }
function legacyModelId(value: unknown): string | undefined { return typeof value === 'string' ? value.trim() || undefined : undefined; }
function positive(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined; }
const alias = (kind: string, value: string): string => `${kind}:${encodeURIComponent(value)}`;
const legacyModelPreset = (provider: string, model: string): string => `legacy:model-preset:${encodeURIComponent(provider)}:${encodeURIComponent(model)}`;

/** Read-only conversion. It never applies a graph, loads a secret, infers a new account owner, or starts login. */
export function compileLegacyInferenceMigration(options: LegacyInferenceMigrationOptions): LegacyInferenceMigration {
  for (const value of [options.source.id, options.source.revision, options.source.rootId, options.target.rootId, options.target.hostOwnerId]) {
    if (!text(value)) throw new Error('Invalid migration source or target');
  }
  const ownerId = options.target.ownerId ?? options.target.hostOwnerId;
  if (!text(ownerId)) throw new Error('Invalid migration target owner');
  const input = object(normalizeProviderJson(options.config));
  const blocked: { path: string; code: string }[] = [];
  const block = (path: string, code: string): void => { blocked.push({ path, code }); };
  const services: Record<string, unknown> = Object.create(null), accounts: Record<string, unknown> = Object.create(null);
  const profiles: Record<string, unknown> = Object.create(null), purposes: Record<string, unknown> = Object.create(null);
  const credentials: { accountAlias: string; source: LegacyCredentialReference }[] = [];
  const mappings = new Map<string, string>();
  if (options.source.rootId !== options.target.rootId) block('source.rootId', 'root-mapping-required');
  const providerSources = object(input.providers), catalog = object(input.modelCatalog);
  const connections = object(catalog.connections), catalogModels = object(catalog.models), presets = object(catalog.presets);
  const imageSources = new Map<string, Record<string, unknown>>();
  const globalImage = object(input.imageGeneration);
  const sourceAccounts = new Map<string, string>(), availableModels = new Map<string, Readonly<Record<string, ModelDefinition>>>();
  const defaults = new Map<string, JsonObject>(), parameterParsers = new Map<string, LegacyServiceResolution['parameters']>();
  const declaredModels = new Map<string, Set<string>>();
  const requested = new Map<string, Set<string>>();
  const request = (provider: string | undefined, model: string | undefined): void => {
    if (provider && model) { const ids = requested.get(provider) ?? new Set(); ids.add(model); requested.set(provider, ids); }
  };
  const defaultModel = (provider: string): string | undefined => {
    const entry = object(providerSources[provider]);
    return legacyModelId(entry.defaultModel) ?? (Array.isArray(entry.models) ? entry.models.map(legacyModelId).find(Boolean) : undefined);
  };
  for (const binding of Object.values(object(input.agents))) {
    const value = object(binding), provider = text(value.provider);
    if (provider) request(provider, legacyModelId(value.model) ?? defaultModel(provider));
  }
  const perception = object(object(input.multimodal).perception);
  for (const entry of [perception, ...(Array.isArray(perception.fallbacks) ? perception.fallbacks.map(object) : [])]) {
    request(text(entry.provider), legacyModelId(entry.model) ?? (text(entry.provider) ? defaultModel(String(entry.provider)) : undefined));
  }
  const ambient = object(object(object(input.trigger).ambient).judge);
  request(text(ambient.provider), text(ambient.model));
  for (const value of Object.values(catalogModels)) {
    const model = object(value); request(text(model.connectionId), text(model.model));
  }
  const addSource = ({ id, raw, path, explicit }: Readonly<{ id: string; raw: Record<string, unknown>; path: string; explicit: boolean }>): void => {
    if (raw.id !== undefined && raw.id !== id) { block(`${path}.id`, 'identity-conflict'); return; }
    // A different Host's record can only move through an explicit identity mapping, not an owner rewrite.
    if (raw.ownerId !== undefined && raw.ownerId !== ownerId) { block(`${path}.ownerId`, 'owner-mapping-required'); return; }
    const known = ['id', 'ownerId', 'revision', 'sdk', 'host', 'baseUrl', 'apiKey', 'secretRef', 'authScheme', 'models', 'defaultModel', 'capabilities', 'input', 'contextWindow', 'maxOutputTokens', 'maxTokens', 'temperature', 'thinkingLevel', 'timeout', 'timeoutMs', 'maxRetries', 'firstChunkTimeoutMs', 'chunkTimeoutMs', 'headers', 'compat', 'contextCache', 'imageGeneration', 'providerOptions', 'sdkOptions'];
    for (const key of Object.keys(raw)) if (!known.includes(key)) block(`${path}.${key}`, 'field-mapping-required');
    const sdk = text(raw.sdk);
    if (!sdk) { block(`${path}.sdk`, 'driver-selection-required'); return; }
    if (raw.models !== undefined && (!Array.isArray(raw.models) || raw.models.some(value => typeof value !== 'string'))) block(`${path}.models`, 'invalid-model-id');
    const ids = Array.isArray(raw.models) ? raw.models.map(legacyModelId).filter((value): value is string => Boolean(value)) : [];
    declaredModels.set(id, new Set(ids));
    const image = raw.imageGeneration !== undefined ? { ...globalImage, ...object(raw.imageGeneration) } : undefined;
    if (image) imageSources.set(id, image);
    const desired = [...new Set([...(text(image?.defaultModel) ? [String(image?.defaultModel)] : []), ...ids, ...(legacyModelId(raw.defaultModel) ? [legacyModelId(raw.defaultModel)!] : []), ...(requested.get(id) ?? [])])];
    const sourceOptions: Record<string, unknown> = {};
    for (const key of ['baseUrl', 'host', 'accountId', 'authScheme', 'compat', 'contextCache']) if (raw[key] !== undefined) sourceOptions[key] = raw[key];
    if (raw.headers !== undefined) block(`${path}.headers`, 'private-header-mapping-required');
    for (const key of ['providerOptions', 'sdkOptions']) if (raw[key] !== undefined) block(`${path}.${key}`, 'parameter-mapping-required');
    const metadata = desired.map(modelId => {
      const catalogMetadata = Object.values(catalogModels).map(object).find(value => value.connectionId === id && value.model === modelId);
      const selected = catalogMetadata ?? raw;
      const capabilities = object(selected.capabilities);
      return { id: modelId, ...(image?.defaultModel === modelId ? { requiredKind: 'image' as const } : {}),
        ...(Array.isArray(selected.input ?? capabilities.input) ? { input: selected.input ?? capabilities.input } : {}),
        ...(Object.keys(capabilities).length ? { capabilities } : {}),
        ...(positive(selected.contextWindow) ? { contextWindow: positive(selected.contextWindow) } : {}),
        ...(positive(selected.maxOutputTokens) ? { maxOutputTokens: positive(selected.maxOutputTokens) } : {}),
      } as LegacyModelMetadata;
    });
    let resolved: LegacyServiceResolution | undefined;
    try { resolved = options.resolveService({ sourceId: id, sdk, options: normalizeProviderJson(sourceOptions) as JsonObject, models: metadata }); }
    catch { block(path, 'driver-validation-required'); return; }
    if (!resolved) { block(path, 'driver-selection-required'); return; }
    const serviceAlias = alias('service', id), accountAlias = alias('account', id);
    services[serviceAlias] = { driver: resolved.driver, options: resolved.options, models: resolved.models };
    let source: LegacyCredentialReference | undefined;
    const secretRef = text(raw.secretRef);
    const env = typeof raw.apiKey === 'string' ? /^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)\}|env:\/\/([A-Za-z_][A-Za-z0-9_]*))$/u.exec(raw.apiKey) : null;
    if (secretRef) source = { kind: 'legacy-vault', reference: secretRef };
    else if (env) source = { kind: 'environment', reference: `env://${env[1] ?? env[2]}` };
    else if (raw.apiKey !== undefined) source = { kind: 'legacy-config', path: `${path}.apiKey` };
    const auth = resolved.authentication === 'none' ? { method: 'none' } : { method: 'api-key', ...(source?.kind === 'environment' ? { source: source.reference } : {}) };
    accounts[accountAlias] = { service: serviceAlias, auth };
    if (source && resolved.authentication === 'api-key') credentials.push({ accountAlias, source });
    const parameters: Record<string, unknown> = {};
    for (const key of ['temperature', 'maxOutputTokens', 'thinkingLevel', 'maxRetries', 'firstChunkTimeoutMs', 'chunkTimeoutMs']) if (raw[key] !== undefined && (key !== 'maxOutputTokens' || positive(raw[key]))) parameters[key] = raw[key];
    if (raw.maxTokens !== undefined) {
      if (raw.maxOutputTokens !== undefined && raw.maxOutputTokens !== raw.maxTokens) block(`${path}.maxTokens`, 'parameter-conflict');
      else if (positive(raw.maxTokens)) parameters.maxOutputTokens = raw.maxTokens;
    }
    if (raw.timeout !== undefined) parameters.requestTimeoutMs = raw.timeout;
    if (raw.timeoutMs !== undefined) { if (raw.timeout !== undefined && raw.timeout !== raw.timeoutMs) block(`${path}.timeoutMs`, 'parameter-conflict'); else parameters.requestTimeoutMs = raw.timeoutMs; }
    defaults.set(id, normalizeProviderJson(parameters) as JsonObject); parameterParsers.set(id, resolved.parameters);
    sourceAccounts.set(id, accountAlias); availableModels.set(id, resolved.models);
    if (!explicit) for (const model of ids) addProfile({ preset: legacyModelPreset(id, model), provider: id, model: model, parameters: {} });
  };
  const addProfile = ({ preset, provider, model, parameters, kind = 'language' }: Readonly<{ preset: string; provider: string | undefined; model: string | undefined; parameters: unknown; kind?: 'language' | 'image' }>): string | undefined => {
    if (!provider || !model || !sourceAccounts.has(provider)) { block(`profiles.${preset}`, 'model-selection-required'); return; }
    const allowlist = declaredModels.get(provider);
    if (kind === 'language' && allowlist?.size && !allowlist.has(model)) { block(`profiles.${preset}`, 'model-outside-allowlist'); return; }
    if (!availableModels.get(provider)?.[model]?.kinds.includes(kind)) { block(`profiles.${preset}`, 'model-metadata-required'); return; }
    const profileAlias = alias('profile', preset);
    const combined = normalizeProviderJson({ ...(kind === 'language' ? defaults.get(provider) : {}), ...object(parameters) }) as JsonObject;
    let parsed: JsonObject = combined;
    const parser = parameterParsers.get(provider);
    if (Object.keys(combined).length && !parser) { block(`profiles.${preset}.parameters`, 'parameter-mapping-required'); return; }
    try { if (parser) parsed = parser({ model: availableModels.get(provider)![model], parameters: combined }); } catch { block(`profiles.${preset}.parameters`, 'parameter-validation-required'); return; }
    profiles[profileAlias] = { account: sourceAccounts.get(provider), model, parameters: parsed };
    mappings.set(preset, profileAlias); return profileAlias;
  };
  for (const [id, raw] of Object.entries(providerSources)) addSource({ id: id, raw: object(raw), path: `providers.${id}`, explicit: false });
  for (const [id, raw] of Object.entries(connections)) {
    if (sourceAccounts.has(id)) { block(`modelCatalog.connections.${id}`, 'source-collision'); continue; }
    addSource({ id: id, raw: object(raw), path: `modelCatalog.connections.${id}`, explicit: true });
  }
  for (const [provider, image] of imageSources) {
    const known = ['defaultModel', 'watermarkEnabled', 'defaultSize', 'numSteps', 'quality', 'aspectRatio', 'imageSize', 'promptSuffix'];
    for (const key of Object.keys(image)) if (!known.includes(key)) block(`providers.${provider}.imageGeneration.${key}`, 'parameter-mapping-required');
    const { defaultModel, ...parameters } = image;
    if (!text(defaultModel)) { block(`providers.${provider}.imageGeneration.defaultModel`, 'model-selection-required'); continue; }
    addProfile({ preset: `legacy:image:${encodeURIComponent(provider)}`, provider, model: text(defaultModel), parameters: { imageGeneration: parameters }, kind: 'image' });
  }
  for (const [id, raw] of Object.entries(presets)) {
    const preset = object(raw), model = object(catalogModels[String(preset.modelId)]);
    if ((preset.id !== undefined && preset.id !== id) || (model.id !== undefined && model.id !== preset.modelId)) { block(`modelCatalog.presets.${id}`, 'identity-conflict'); continue; }
    const parameters = object(preset.parameters);
    const unsupported = Object.keys(preset).filter(key => !['id', 'modelId', 'parameters', 'temperature', 'maxOutputTokens', 'thinkingLevel', 'label'].includes(key));
    for (const key of unsupported) block(`modelCatalog.presets.${id}.${key}`, 'parameter-mapping-required');
    addProfile({ preset: id, provider: text(model.connectionId), model: text(model.model), parameters: { ...parameters,
      ...Object.fromEntries(['temperature', 'maxOutputTokens', 'thinkingLevel'].filter(key => preset[key] !== undefined).map(key => [key, preset[key]])) } });
  }
  const selected = (preset: unknown, path: string): { profile: string } | undefined => {
    const id = text(preset), mapped = id ? mappings.get(id) : undefined;
    if (!mapped) { block(path, 'profile-mapping-required'); return; }
    return { profile: mapped };
  };
  const agentProfiles = new Map<string, string>();
  for (const [name, raw] of Object.entries(object(input.agents))) {
    const agent = object(raw);
    if (agent.preset !== undefined && (agent.provider !== undefined || agent.model !== undefined)) { block(`agents.${name}`, 'selection-conflict'); continue; }
    if (agent.model !== undefined && typeof agent.model !== 'string') { block(`agents.${name}.model`, 'invalid-model-id'); continue; }
    const provider = text(agent.provider), preset = text(agent.preset);
    const profile = preset ? selected(preset, `agents.${name}.preset`)?.profile
      : provider ? addProfile({ preset: `legacy:agent:${encodeURIComponent(name)}`, provider: provider, model: legacyModelId(agent.model) ?? defaultModel(provider), parameters: {} }) : undefined;
    if (profile) agentProfiles.set(name, profile);
  }
  if (agentProfiles.get('zhin')) purposes.chat = { profile: agentProfiles.get('zhin') };
  const roles = Object.fromEntries([...agentProfiles].filter(([name]) => name !== 'zhin').map(([name, profile]) => [name, { profile }]));
  if (Object.keys(roles).length) purposes.agents = roles;
  if (perception.model !== undefined && typeof perception.model !== 'string') block('multimodal.perception.model', 'invalid-model-id');
  else if (perception.provider !== undefined || perception.model !== undefined) {
    const primary = addProfile({ preset: 'legacy:perception', provider: text(perception.provider), model: legacyModelId(perception.model) ?? defaultModel(String(perception.provider)), parameters: {} });
    const fallbacks = Array.isArray(perception.fallbacks) ? perception.fallbacks.map((raw, index) => {
      const value = object(raw); if (value.model !== undefined && typeof value.model !== 'string') { block(`multimodal.perception.fallbacks.${index}.model`, 'invalid-model-id'); return; }
      return addProfile({ preset: `legacy:perception-fallback:${index}`, provider: text(value.provider), model: legacyModelId(value.model) ?? defaultModel(String(value.provider)), parameters: {} });
    }).filter((id): id is string => Boolean(id)) : [];
    if (primary) purposes.perception = { profile: primary, ...(fallbacks.length ? { fallbacks } : {}) };
  }
  const judge = object(object(input.trigger).ambient).judge;
  if (Array.isArray(judge)) block('trigger.ambient.judge', 'explicit-single-model-required');
  else if (judge !== undefined) {
    const value = object(judge);
    if (value.model !== undefined && typeof value.model !== 'string') block('trigger.ambient.judge.model', 'invalid-model-id');
    const profile = value.model !== undefined && typeof value.model !== 'string' ? undefined : addProfile({ preset: 'legacy:ambient', provider: text(value.provider), model: legacyModelId(value.model) ?? defaultModel(String(value.provider)), parameters: {} });
    if (profile) purposes.ambient = { profile };
  }
  const policy = object(input.modelPolicy);
  const patch = (raw: unknown, path: string, allowed: readonly string[]): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object(raw))) {
      if (!allowed.includes(key)) block(`${path}.${key}`, 'unsupported-purpose');
      else { const ref = selected(value, `${path}.${key}`); if (ref) result[key] = ref; }
    }
    return result;
  };
  Object.assign(purposes, patch(policy.defaults, 'modelPolicy.defaults', ['chat', 'summary', 'perception', 'image']));
  if (policy.adapters !== undefined) purposes.adapters = Object.fromEntries(Object.entries(object(policy.adapters)).map(([key, value]) => [key, patch(value, `modelPolicy.adapters.${key}`, ['chat', 'perception'])]));
  for (const [field, kind] of [['endpoints', 'endpoint'], ['scenes', 'scene']] as const) {
    if (policy[field] === undefined) continue;
    if (!Array.isArray(policy[field])) { block(`modelPolicy.${field}`, 'scope-mapping-required'); continue; }
    const mapped: Record<string, unknown> = {};
    for (const [index, raw] of (policy[field] as unknown[]).entries()) {
      const entry = object(raw), key = options.scopeKey?.({ kind, address: object(entry.address) as JsonObject });
      if (!key) { block(`modelPolicy.${field}.${index}.address`, 'scope-mapping-required'); continue; }
      if (Object.hasOwn(mapped, key)) { block(`modelPolicy.${field}.${index}`, 'scope-collision'); continue; }
      mapped[key] = patch(entry.models, `modelPolicy.${field}.${index}.models`, kind === 'scene' ? ['chat'] : ['chat', 'perception']);
    }
    purposes[field] = mapped;
  }
  if (input.imageGeneration !== undefined && !imageSources.size) block('imageGeneration', 'image-provider-mapping-required');
  if (input.decisions !== undefined) block('decisions', 'decision-profile-mapping-required');
  const plan = normalizeProviderJson({ version: 1, services, accounts, profiles, ...(ownerId === options.target.hostOwnerId ? { purposes } : {}) }) as JsonObject;
  const workroomServiceMappings: { legacyProviderAlias: string; serviceAlias: string; contract: JsonObject }[] = [];
  const disclosure = object(object(input.workroom).disclosure);
  const contracts = object(disclosure.modelProviders);
  for (const [legacyProviderAlias, raw] of Object.entries(contracts)) {
    const path = `workroom.disclosure.modelProviders.${legacyProviderAlias}`;
    if (!sourceAccounts.has(legacyProviderAlias)) { block(path, 'service-mapping-required'); continue; }
    const contract = object(raw), fields = ['endpoint', 'owner', 'trustDomain', 'processingRegions', 'maxConfidentiality', 'external', 'noTraining', 'loggingMode', 'maximumRetentionSeconds', 'allowsRedisclosure', 'supportsDeletion'];
    if (Object.keys(contract).some(key => !fields.includes(key))) { block(path, 'processing-contract-mapping-required'); continue; }
    workroomServiceMappings.push({ legacyProviderAlias, serviceAlias: alias('service', legacyProviderAlias), contract: normalizeProviderJson(contract) as JsonObject });
  }
  const harnessEntries: { sourcePath: string; sourceId: string; selector: string; serviceAlias: string; model?: string; settings: JsonObject }[] = [];
  const harness = object(object(input.agent).modelHarness);
  for (const field of ['providerPatterns', 'models'] as const) for (const [selector, raw] of Object.entries(object(harness[field]))) {
    const sourcePath = `agent.modelHarness.${field}.${selector}`;
    const destinations = options.harnessTargets?.[sourcePath];
    if (!destinations?.length) { block(sourcePath, 'harness-service-mapping-required'); continue; }
    const settings = object(raw), allowed = ['maxIterations', 'explorationBudget', 'explorationGuidance', 'iterationExtension', 'maxTotalIterations', 'emptyReplyRetries', 'requestTimeoutMs'];
    if (Object.keys(settings).some(key => !allowed.includes(key))) { block(sourcePath, 'harness-setting-mapping-required'); continue; }
    for (const destination of destinations) {
      const sourceId = [...sourceAccounts.keys()].find(id => alias('service', id) === destination.serviceAlias);
      if (!sourceId || !Object.hasOwn(services, destination.serviceAlias)
        || (field === 'models' ? !destination.model || !Object.hasOwn(availableModels.get(sourceId) ?? {}, destination.model) : destination.model !== undefined)) {
        block(sourcePath, 'harness-target-mapping-invalid'); continue;
      }
      harnessEntries.push({ sourcePath, sourceId, selector, serviceAlias: destination.serviceAlias,
        ...(destination.model ? { model: destination.model } : {}), settings: normalizeProviderJson(settings) as JsonObject });
    }
  }
  const harnessServiceMappings: { sourcePaths: readonly string[]; serviceAlias: string; model?: string; settings: JsonObject }[] = [];
  const grouped = new Map<string, typeof harnessEntries>();
  for (const entry of harnessEntries) {
    const key = JSON.stringify([entry.serviceAlias, entry.model ?? null]);
    const entries = grouped.get(key) ?? []; entries.push(entry); grouped.set(key, entries);
  }
  for (const entries of grouped.values()) {
    const first = entries[0];
    if (first.model && entries.length > 1) {
      const rank = (entry: typeof first) => entry.selector === entry.model ? 1 : entry.selector === `${entry.sourceId}:${entry.model}` ? 2 : undefined;
      if (entries.some(entry => rank(entry) === undefined) || new Set(entries.map(rank)).size !== entries.length) {
        for (const entry of entries) block(entry.sourcePath, 'harness-target-collision');
        continue;
      }
      entries.sort((a, b) => rank(a)! - rank(b)!);
    }
    harnessServiceMappings.push({ sourcePaths: Object.freeze(entries.map(entry => entry.sourcePath)), serviceAlias: first.serviceAlias,
      ...(first.model ? { model: first.model } : {}), settings: Object.assign({}, ...entries.map(entry => entry.settings)) });
  }
  const profileMappings = [...mappings].map(([legacyPresetId, profileAlias]) => Object.freeze({ legacyPresetId, profileAlias }));
  // Public preview identity only; Host source revisions also cover private credential records.
  const publicSource = { ...options.source, fingerprint: providerPlanFingerprint({ source: options.source, target: options.target, plan, credentials, profileMappings, workroomServiceMappings, harnessServiceMappings, blocked }) };
  return Object.freeze({ version: 1, source: Object.freeze(publicSource), target: Object.freeze({ ...options.target }), plan,
    profileMappings: Object.freeze(profileMappings),
    harnessServiceMappings: Object.freeze(harnessServiceMappings.map(value => Object.freeze(value))),
    workroomServiceMappings: Object.freeze(workroomServiceMappings.map(value => Object.freeze(value))),
    credentials: Object.freeze(credentials.map(entry => Object.freeze(entry))), blocked: Object.freeze(blocked.map(entry => Object.freeze(entry))) });
}

/** Explicit reviewed identity mapping only; a reused preset label is never sufficient. */
export function compileLegacySessionSelection(options: Readonly<{
  selection: unknown;
  mappings: Readonly<Record<string, ProfileSelection<'language'>>>;
}>): Readonly<{ kind: 'inherit' }> | Readonly<{ kind: 'profile'; profile: ProfileSelection<'language'> }> {
  const selection = object(normalizeProviderJson(options.selection));
  if (selection.kind === 'inherit') return Object.freeze({ kind: 'inherit' });
  const preset = text(selection.presetId);
  if (selection.kind !== 'preset' || !preset || !Object.hasOwn(options.mappings, preset)) throw new Error('Session profile mapping required');
  const value = options.mappings[preset];
  if (value.kind !== 'language' || [value.id, value.rootId, value.accountId, value.accountIncarnation].some(item => !text(item))) throw new Error('Invalid Session profile identity');
  // Identity only: the Host validates the current graph, ownership and account incarnation at apply.
  return Object.freeze({ kind: 'profile', profile: Object.freeze({ id: value.id, rootId: value.rootId, accountId: value.accountId, accountIncarnation: value.accountIncarnation, kind: 'language' }) });
}
