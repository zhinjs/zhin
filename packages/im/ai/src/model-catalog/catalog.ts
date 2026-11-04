import { isSdkId } from '../llm/sdk-registry.js';
import { ModelCatalogError, type CatalogModel, type InvocationOwner, type InvocationRequirements, type ModelCapabilities, type ModelCatalogConfig, type ModelConnection, type ModelPreset, type ResolvedInvocation } from './types.js';

function invalid(): never { throw new ModelCatalogError('invalid-config'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) invalid();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return invalid();
  return value;
}
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : id(value); }
function positive(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}
const MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const;
function capabilities(value: unknown): ModelCapabilities {
  const raw = object(value);
  fields(raw, ['input', 'streaming', 'toolCalling', 'thinking']);
  const result: { input?: readonly typeof MODALITIES[number][]; streaming?: boolean; toolCalling?: boolean; thinking?: boolean } = {};
  if (raw.input !== undefined) {
    if (!Array.isArray(raw.input) || raw.input.some(item => !MODALITIES.includes(item))) return invalid();
    result.input = Object.freeze([...new Set(raw.input)]);
  }
  for (const key of ['streaming', 'toolCalling', 'thinking'] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') return invalid();
      result[key] = raw[key];
    }
  }
  return Object.freeze(result);
}
function dictionary<T>(value: unknown, parse: (value: Record<string, unknown>) => T & { readonly id: string }): Readonly<Record<string, T>> {
  const result: Record<string, T> = Object.create(null);
  const raw = object(value);
  if (Reflect.ownKeys(raw).some(key => typeof key !== 'string')) return invalid();
  for (const [key, entry] of Object.entries(raw)) {
    const parsed = parse(object(entry));
    if (parsed.id !== key) return invalid();
    result[key] = parsed;
  }
  return Object.freeze(result);
}

/** Closed schemas, explicit references and detached snapshots; no recursive config merge. */
export function normalizeModelCatalogConfig(input: unknown): ModelCatalogConfig {
  const raw = object(input);
  fields(raw, ['connections', 'models', 'presets']);
  const connections = dictionary<ModelConnection>(raw.connections, value => {
    fields(value, ['id', 'ownerId', 'revision', 'sdk', 'baseUrl', 'secretRef']);
    const revision = positive(value.revision);
    if (revision === undefined || typeof value.sdk !== 'string' || !isSdkId(value.sdk)) return invalid();
    const baseUrl = optionalString(value.baseUrl);
    if (baseUrl !== undefined) {
      let url: URL;
      try { url = new URL(baseUrl); } catch { return invalid(); }
      // Credentials in a URL must never reach an invocation or diagnostic.
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return invalid();
    }
    const secretRef = optionalString(value.secretRef);
    return Object.freeze({ id: id(value.id), ownerId: id(value.ownerId), revision, sdk: value.sdk,
      ...(baseUrl !== undefined ? { baseUrl } : {}), ...(secretRef !== undefined ? { secretRef } : {}) });
  });
  const models = dictionary<CatalogModel>(raw.models, value => {
    fields(value, ['id', 'connectionId', 'model', 'capabilities', 'contextWindow', 'maxOutputTokens']);
    const connectionId = id(value.connectionId);
    if (!Object.hasOwn(connections, connectionId)) return invalid();
    const contextWindow = positive(value.contextWindow);
    const maxOutputTokens = positive(value.maxOutputTokens);
    return Object.freeze({ id: id(value.id), connectionId, model: id(value.model), capabilities: capabilities(value.capabilities),
      ...(contextWindow !== undefined ? { contextWindow } : {}), ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}) });
  });
  const presets = dictionary<ModelPreset>(raw.presets, value => {
    fields(value, ['id', 'modelId']);
    const modelId = id(value.modelId);
    if (!Object.hasOwn(models, modelId)) return invalid();
    return Object.freeze({ id: id(value.id), modelId });
  });
  return Object.freeze({ connections, models, presets });
}

export class ModelCatalog {
  readonly config: ModelCatalogConfig;
  constructor(input: ModelCatalogConfig) {
    this.config = normalizeModelCatalogConfig(input);
    Object.freeze(this);
  }

  resolve(presetId: string, owner: InvocationOwner, requirements?: InvocationRequirements): ResolvedInvocation {
    const identity = object(owner);
    fields(identity, ['ownerId', 'hostOwnerId']);
    const ownerId = id(identity.ownerId);
    const hostOwnerId = id(identity.hostOwnerId);
    if (!Object.hasOwn(this.config.presets, presetId)) throw new ModelCatalogError('unknown-preset');
    const preset = this.config.presets[presetId];
    const model = this.config.models[preset.modelId];
    const connection = this.config.connections[model.connectionId];
    if (connection.ownerId !== ownerId && connection.ownerId !== hostOwnerId) {
      throw new ModelCatalogError('connection-forbidden');
    }
    if (requirements !== undefined) {
      const required = capabilities(requirements);
      if (required.input?.some(item => !model.capabilities.input?.includes(item))
        || (['streaming', 'toolCalling', 'thinking'] as const).some(key => required[key] === true && model.capabilities[key] !== true)) {
        throw new ModelCatalogError('unsupported-capability');
      }
    }
    return Object.freeze({ preset, model, connection });
  }
}

export function createModelCatalog(config: ModelCatalogConfig): ModelCatalog { return new ModelCatalog(config); }
