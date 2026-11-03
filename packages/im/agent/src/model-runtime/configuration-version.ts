import { isDeepStrictEqual } from 'node:util';
import { normalizeModelCatalogConfig, type ModelConnection } from '@zhin.js/ai/model-catalog';
import type { CompiledModelRuntime } from './compiler.js';
import { ModelRuntimeError, type ModelRuntimeConfig } from './types.js';

function authority(config: ModelRuntimeConfig): unknown {
  const { providers: _providers, modelCatalog: _catalog, modelPolicy: _policy, agents, ...other } = config;
  return { ...other, ...(agents ? { agents: Object.fromEntries(Object.entries(agents).map(([name, value]) => {
    const { provider: _provider, model: _model, preset: _preset, ...authority } = value;
    return [name, authority];
  })) } : {}) };
}
function supportedCapabilities(previous: CompiledModelRuntime['catalogConfig']['models'][string]['capabilities'], next: typeof previous): boolean {
  for (const key of ['streaming', 'toolCalling', 'thinking'] as const) if (previous[key] === true && next[key] !== true) return false;
  return (previous.input ?? []).every(kind => next.input?.includes(kind));
}

/** Conservative first-release boundary; there is no complete personal-reference index. */
export function configurationRestartReasons(previousConfig: ModelRuntimeConfig, nextConfig: ModelRuntimeConfig,
  previous: CompiledModelRuntime, next: CompiledModelRuntime): readonly string[] {
  const reasons: string[] = [];
  if (!isDeepStrictEqual(authority(previousConfig), authority(nextConfig))) reasons.push('non-model-configuration');
  for (const kind of ['connections', 'models', 'presets'] as const) {
    if (Object.keys(previous.catalogConfig[kind]).some(id => !Object.hasOwn(next.catalogConfig[kind], id))) reasons.push(`removed-${kind}`);
  }
  for (const [id, model] of Object.entries(previous.catalogConfig.models)) {
    const candidate = next.catalogConfig.models[id];
    if (candidate && !supportedCapabilities(model.capabilities, candidate.capabilities)) reasons.push('reduced-model-capabilities');
  }
  for (const [id, connection] of Object.entries(previous.catalogConfig.connections)) {
    const candidate = next.catalogConfig.connections[id];
    if (candidate && connection.ownerId !== candidate.ownerId) reasons.push('changed-connection-owner');
  }
  return Object.freeze([...new Set(reasons)]);
}

function executionShape(compiled: CompiledModelRuntime, connection: ModelConnection): unknown {
  const { revision: _revision, ...identity } = connection;
  const factory = compiled.hostFactoryData.get(connection.id);
  const models = Object.values(compiled.catalogConfig.models).filter(model => model.connectionId === connection.id)
    .map(model => model.model).sort();
  // Registered provider objects are borrowed owners, not authored configuration.
  return { identity, factory: factory && { origin: factory.origin, alias: factory.alias,
    executionAlias: factory.executionAlias, config: factory.config }, models };
}

/** Every change that reaches a connection factory gets a new immutable pool identity. */
export function versionConfiguration(previous: CompiledModelRuntime, next: CompiledModelRuntime): CompiledModelRuntime {
  const connections = Object.fromEntries(Object.entries(next.catalogConfig.connections).map(([id, connection]) => {
    const old = previous.catalogConfig.connections[id];
    if (!old) return [id, connection];
    const changed = !isDeepStrictEqual(executionShape(previous, old), executionShape(next, connection));
    if (changed && old.revision === Number.MAX_SAFE_INTEGER) throw new ModelRuntimeError('invalid-config');
    const revision = Math.max(connection.revision, old.revision + (changed ? 1 : 0));
    return [id, { ...connection, revision }];
  }));
  return Object.freeze({ ...next, catalogConfig: normalizeModelCatalogConfig({ ...next.catalogConfig, connections }) });
}
