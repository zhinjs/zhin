import { getLogger } from '@zhin.js/logger';
import { randomUUID } from 'node:crypto';
import {
  createModelCatalog, normalizeModelCatalogConfig, ModelCatalogError,
  type ModelCatalogConfig, type ModelConnection, type CatalogModel, type ModelPreset, type ModelCapabilities,
} from '@zhin.js/ai/model-catalog';
import {
  PersonalSessionService, PersonalSessionRevisionConflictError, PersonalSessionAccessError,
  personalSessionIdentity, personalSessionOwnerId, samePersonalSessionOwner,
  type PersonalSessionOwner, type PersonalSessionAddress, type PersonalSessionSelection,
  type PersonalSessionRepository, type PersonalSessionState,
} from '@zhin.js/agent/personal-session';
import { createPersonalModelFetch } from './network.js';
import type { PersonalModelCredentialVault } from './types.js';
import type { PersonalModelCatalogSnapshot, PersonalModelCatalogWriteResult } from './state.js';

export type PersonalModelManagementErrorCode = 'invalid_input' | 'unauthenticated' | 'forbidden' | 'conflict' | 'unavailable';
export class PersonalModelManagementError extends Error {
  constructor(readonly code: PersonalModelManagementErrorCode) {
    super({ invalid_input: 'Invalid personal model management input', unauthenticated: 'An authenticated personal principal is required',
      forbidden: 'Personal model owner access is not permitted', conflict: 'Personal model state has changed',
      unavailable: 'Personal model management is unavailable' }[code]);
    this.name = 'PersonalModelManagementError';
  }
}
export interface PersonalModelManagementState extends PersonalSessionRepository {
  loadCatalog(ownerId: string): Promise<PersonalModelCatalogSnapshot | undefined>;
  compareExchangeCatalog(ownerId: string, revision: number, value: ModelCatalogConfig): Promise<PersonalModelCatalogWriteResult>;
}
export interface PersonalModelManagementOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  readonly bindings: Readonly<Record<string, readonly PersonalSessionOwner[]>>;
  readonly state: PersonalModelManagementState;
  readonly vault: PersonalModelCredentialVault;
  readonly hostCatalog: () => ModelCatalogConfig | Promise<ModelCatalogConfig>;
  readonly directory?: import('./directory.js').PersonalSessionDirectory;
}
export interface PersonalModelConnectionMetadata {
  readonly id: string;
  readonly revision: number;
  readonly sdk: ModelConnection['sdk'];
  readonly baseUrl?: string;
  readonly hasKey: boolean;
}
export interface PersonalModelCatalogMetadata {
  readonly connections: readonly PersonalModelConnectionMetadata[];
  readonly models: readonly CatalogModel[];
  readonly presets: readonly ModelPreset[];
}
export interface DeploymentModelPresetMetadata {
  readonly id: string;
  readonly modelId: string;
  readonly model: string;
  readonly sdk: ModelConnection['sdk'];
  readonly capabilities: ModelCapabilities;
}
export interface PersonalModelOwnerCatalogMetadata extends PersonalModelCatalogMetadata {
  readonly owner: PersonalSessionOwner;
  readonly ownerId: string;
  readonly revision: number;
}
export interface PersonalModelsView {
  readonly owners: readonly PersonalModelOwnerCatalogMetadata[];
  readonly deployment: readonly DeploymentModelPresetMetadata[];
}
export interface PersonalModelWriteView extends PersonalModelOwnerCatalogMetadata { readonly presetId: string }
export interface PersonalModelSessionView {
  readonly state: PersonalSessionState;
  readonly presets: Readonly<{ personal: readonly ModelPreset[]; deployment: readonly DeploymentModelPresetMetadata[] }>;
}
const EMPTY: ModelCatalogConfig = Object.freeze({ connections: Object.freeze({}), models: Object.freeze({}), presets: Object.freeze({}) });
function fail(code: PersonalModelManagementErrorCode): never { throw new PersonalModelManagementError(code); }
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const result = value as Record<string, unknown>;
  if (Reflect.ownKeys(result).some(key => typeof key !== 'string' || (keys && !keys.includes(key)))) fail('invalid_input');
  return result;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail('invalid_input');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail('invalid_input');
  return value;
}
function owner(value: unknown): PersonalSessionOwner {
  const input = object(value, ['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId']);
  return Object.freeze({ rootId: text(input.rootId), platform: text(input.platform), endpoint: text(input.endpoint),
    adapterId: text(input.adapterId), subjectId: text(input.subjectId) });
}
function address(value: unknown): PersonalSessionAddress {
  const input = object(value, ['rootId', 'platform', 'endpoint', 'conversation', 'subjectId']);
  const conversation = object(input.conversation, ['endpoint', 'kind', 'id', 'parent', 'threadId', 'name']);
  object(conversation.endpoint, ['adapter', 'id']);
  if (conversation.parent !== undefined) object(conversation.parent, ['kind', 'id']);
  if (conversation.name !== undefined && typeof conversation.name !== 'string') fail('invalid_input');
  try { return personalSessionIdentity(input as unknown as PersonalSessionAddress).address; }
  catch { return fail('invalid_input'); }
}
function selection(value: unknown): PersonalSessionSelection {
  const input = object(value, ['kind', 'presetId']);
  if (input.kind === 'inherit' && !Object.hasOwn(input, 'presetId')) return Object.freeze({ kind: 'inherit' });
  if (input.kind === 'preset') return Object.freeze({ kind: 'preset', presetId: text(input.presetId) });
  return fail('invalid_input');
}
function mergeCatalogs(host: ModelCatalogConfig, personal: ModelCatalogConfig): ModelCatalogConfig {
  for (const area of ['connections', 'models', 'presets'] as const) {
    if (Object.keys(personal[area]).some(id => Object.hasOwn(host[area], id))) fail('unavailable');
  }
  return normalizeModelCatalogConfig({ connections: { ...host.connections, ...personal.connections },
    models: { ...host.models, ...personal.models }, presets: { ...host.presets, ...personal.presets } });
}
function deploymentPresets(catalog: ModelCatalogConfig, hostOwnerId: string): readonly DeploymentModelPresetMetadata[] {
  return Object.freeze(Object.values(catalog.presets).flatMap(preset => {
    const model = catalog.models[preset.modelId];
    const connection = catalog.connections[model.connectionId];
    return connection.ownerId === hostOwnerId ? [Object.freeze({ id: preset.id, modelId: model.id,
      model: model.model, sdk: connection.sdk, capabilities: model.capabilities })] : [];
  }));
}
function metadata(catalog: ModelCatalogConfig, allowedOwnerId: string): PersonalModelCatalogMetadata {
  const connections = Object.values(catalog.connections).filter(value => value.ownerId === allowedOwnerId).map(value => Object.freeze({
    id: value.id, revision: value.revision, sdk: value.sdk, ...(value.baseUrl ? { baseUrl: value.baseUrl } : {}), hasKey: value.secretRef !== undefined,
  }));
  const connectionIds = new Set(connections.map(value => value.id));
  const models = Object.values(catalog.models).filter(value => connectionIds.has(value.connectionId));
  const modelIds = new Set(models.map(value => value.id));
  const presets = Object.values(catalog.presets).filter(value => modelIds.has(value.modelId));
  return Object.freeze({ connections: Object.freeze(connections), models: Object.freeze(models), presets: Object.freeze(presets) });
}

/** Authenticated principal binding, personal ownership and CAS share one management boundary. */
export class PersonalModelManagementService {
  readonly #bindings: Readonly<Record<string, readonly PersonalSessionOwner[]>>;
  readonly #sessions: PersonalSessionService;
  readonly #rootId: string;
  readonly #hostOwnerId: string;
  constructor(private readonly options: PersonalModelManagementOptions) {
    this.#rootId = text(options.rootId); this.#hostOwnerId = text(options.hostOwnerId);
    this.#bindings = Object.freeze(Object.fromEntries(Object.entries(object(options.bindings)).map(([principalId, values]) => {
      text(principalId);
      if (!Array.isArray(values)) fail('invalid_input');
      return [principalId, Object.freeze(values.map(value => {
        const binding = owner(value);
        if (binding.rootId !== this.#rootId) fail('forbidden');
        return binding;
      }))];
    })));
    this.#sessions = new PersonalSessionService(options.state);
  }
  #owners(principalId: string): readonly PersonalSessionOwner[] {
    if (typeof principalId !== 'string' || !principalId.trim()) fail('unauthenticated');
    if (!Object.hasOwn(this.#bindings, principalId) || !this.#bindings[principalId].length) fail('forbidden');
    return this.#bindings[principalId];
  }
  #authorize(principalId: string, candidate: PersonalSessionOwner): PersonalSessionOwner {
    if (candidate.rootId !== this.#rootId) fail('forbidden');
    const bound = this.#owners(principalId).find(value => samePersonalSessionOwner(value, candidate));
    if (!bound) fail('forbidden');
    return bound;
  }
  async #safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof PersonalModelManagementError || error instanceof ModelCatalogError) throw error;
      if (error instanceof PersonalSessionRevisionConflictError) fail('conflict');
      if (error instanceof PersonalSessionAccessError) fail('forbidden');
      return fail('unavailable');
    }
  }
  async #host(): Promise<ModelCatalogConfig> {
    try { return normalizeModelCatalogConfig(await this.options.hostCatalog()); }
    catch { return fail('unavailable'); }
  }
  async #personal(ownerId: string): Promise<PersonalModelCatalogSnapshot> {
    const snapshot = await this.options.state.loadCatalog(ownerId);
    if (!snapshot) return Object.freeze({ revision: 0, value: EMPTY });
    let catalog: ModelCatalogConfig;
    try { catalog = normalizeModelCatalogConfig(snapshot.value); } catch { return fail('unavailable'); }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
      || Object.values(catalog.connections).some(value => value.ownerId !== ownerId)) fail('unavailable');
    return Object.freeze({ revision: snapshot.revision, value: catalog });
  }
  listModels(principalId: string): Promise<PersonalModelsView> {
    return this.#safe(async () => {
      const owners = this.#owners(principalId);
      const host = await this.#host();
      const personal = await Promise.all(owners.map(async binding => {
        const ownerId = personalSessionOwnerId(binding);
        const snapshot = await this.#personal(ownerId);
        return Object.freeze({ owner: binding, ownerId, revision: snapshot.revision, ...metadata(snapshot.value, ownerId) });
      }));
      return Object.freeze({ owners: Object.freeze(personal), deployment: deploymentPresets(host, this.#hostOwnerId) });
    });
  }
  putModel(principalId: string, value: unknown): Promise<PersonalModelWriteView> {
    return this.#safe(async () => {
      this.#owners(principalId);
      const input = object(value, ['owner', 'expectedRevision', 'entry']);
      const binding = this.#authorize(principalId, owner(input.owner));
      const ownerId = personalSessionOwnerId(binding);
      const expected = revision(input.expectedRevision);
      const entry = object(input.entry, ['presetId', 'sdk', 'baseUrl', 'model', 'apiKey', 'capabilities']);
      const sdk = text(entry.sdk); const baseUrl = text(entry.baseUrl); const modelName = text(entry.model);
      // Construction validates HTTPS/public-host syntax without DNS or a provider verification call.
      try { createPersonalModelFetch({ baseUrl }); } catch { fail('invalid_input'); }
      const current = await this.#personal(ownerId);
      if (current.revision !== expected) fail('conflict');
      const requestedPresetId = entry.presetId === undefined ? undefined : text(entry.presetId);
      const existingPreset = requestedPresetId !== undefined && Object.hasOwn(current.value.presets, requestedPresetId)
        ? current.value.presets[requestedPresetId] : undefined;
      if (entry.presetId !== undefined && !existingPreset) fail('forbidden');
      const existingModel = existingPreset ? current.value.models[existingPreset.modelId] : undefined;
      const existingConnection = existingModel ? current.value.connections[existingModel.connectionId] : undefined;
      if (existingConnection && existingConnection.ownerId !== ownerId) fail('forbidden');
      if (entry.apiKey !== undefined && (typeof entry.apiKey !== 'string' || !entry.apiKey.trim())) fail('invalid_input');
      // Match the installed SDK adapter: Ollama has an unauthenticated mode.
      if (sdk !== 'ollama' && entry.apiKey === undefined && !existingConnection?.secretRef) fail('invalid_input');
      const connectionId = existingConnection?.id ?? `personal-connection:${randomUUID()}`;
      const modelId = existingModel?.id ?? `personal-model:${randomUUID()}`;
      const presetId = existingPreset?.id ?? `personal-preset:${randomUUID()}`;
      const connection = { id: connectionId, ownerId, revision: (existingConnection?.revision ?? 0) + 1,
        sdk, baseUrl, ...(existingConnection?.secretRef ? { secretRef: existingConnection.secretRef } : {}) };
      const model = { id: modelId, connectionId, model: modelName, capabilities: entry.capabilities !== undefined ? entry.capabilities : existingModel?.capabilities ?? {} };
      const build = (candidate: unknown) => normalizeModelCatalogConfig({
        connections: { ...current.value.connections, [connectionId]: candidate },
        models: { ...current.value.models, [modelId]: model },
        presets: { ...current.value.presets, [presetId]: { id: presetId, modelId } },
      });
      // Validate formal SDK/capability contracts before creating any credential file.
      const validated = build(connection);
      let next = validated;
      let prepared: import('./types.js').PreparedPersonalModelCredential | undefined;
      if (typeof entry.apiKey === 'string') {
        prepared = await this.options.vault.prepare({ ownerId, apiKey: entry.apiKey });
        next = build({ ...connection, secretRef: prepared.secretRef });
      }
      // Roll back only a definitively rejected write. A thrown/unknown database outcome
      // may already reference the new credential, so its bytes must remain available.
      const result = await this.options.state.compareExchangeCatalog(ownerId, expected, next);
      if (result.kind === 'conflict') {
        try { await prepared?.rollback(); }
        catch {
          // The write is definitively rejected; cleanup diagnostics cannot turn it into an unknown commit.
          try { getLogger('personal-models').warn('op=credential_rollback status=failed'); } catch { /* Diagnostic only. */ }
        }
        fail('conflict');
      }
      return Object.freeze({ owner: binding, ownerId, revision: result.snapshot.revision, presetId, ...metadata(result.snapshot.value, ownerId) });
    });
  }
  listSessions(principalId: string, value: unknown): Promise<import('./directory.js').PersonalSessionDirectoryPage> {
    return this.#safe(async () => {
      const input = object(value, ['owner', 'limit', 'offset']);
      const binding = this.#authorize(principalId, owner(input.owner));
      const limit = input.limit;
      const offset = input.offset;
      // Same upper bound as the existing Console paginated Agent query routes.
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500
        || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) fail('invalid_input');
      if (!this.options.directory) fail('unavailable');
      return this.options.directory(binding, { limit, offset });
    });
  }
  readSession(principalId: string, value: unknown): Promise<PersonalModelSessionView> {
    return this.#safe(async () => {
      this.#owners(principalId);
      const target = address(value);
      const binding = this.#authorize(principalId, personalSessionIdentity(target).owner);
      const state = await this.#sessions.read({ address: target, owner: binding });
      const ownerId = personalSessionOwnerId(binding);
      const personal = await this.#personal(ownerId);
      const host = await this.#host();
      return Object.freeze({ state, presets: Object.freeze({
        personal: metadata(personal.value, ownerId).presets, deployment: deploymentPresets(host, this.#hostOwnerId),
      }) });
    });
  }
  selectSession(principalId: string, value: unknown): Promise<PersonalSessionState> {
    return this.#safe(async () => {
      this.#owners(principalId);
      const input = object(value, ['address', 'expectedRevision', 'selection']);
      const target = address(input.address);
      const binding = this.#authorize(principalId, personalSessionIdentity(target).owner);
      const expectedRevision = revision(input.expectedRevision);
      const selected = selection(input.selection);
      if (selected.kind === 'preset') {
        const ownerId = personalSessionOwnerId(binding);
        const personal = await this.#personal(ownerId);
        const host = await this.#host();
        // No provider initialization or KeyStore reads occur during selection.
        createModelCatalog(mergeCatalogs(host, personal.value)).resolve(selected.presetId, { ownerId, hostOwnerId: this.#hostOwnerId });
      }
      return this.#sessions.select({ address: target, owner: binding, expectedRevision, selection: selected });
    });
  }
}
