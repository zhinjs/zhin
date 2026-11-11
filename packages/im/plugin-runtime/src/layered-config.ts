/**
 * Layered feature configuration (ADR 0050): global < adapter < endpoint.
 *
 * Pure resolution shared by the Runtime (`configFor` / `isEnabledFor`), IM dispatch
 * gating and Agent tool disclosure. Schema-level checks live in `@zhin.js/runtime`.
 */
import { primaryConfigToken, type PrimaryConfig } from './host-installer.js';
import { featureId, type PluginId } from './identity.js';
import type { RuntimeConfigDocument } from './root-config-document.js';
import type { RuntimeSnapshot } from './snapshot.js';

export type FeatureConfigLevel = 'global' | 'adapter' | 'endpoint';
export const FEATURE_CONFIG_LEVELS: readonly FeatureConfigLevel[] = Object.freeze(['global', 'adapter', 'endpoint']);
/** Reserved key in a Plugin's own config block that holds adapter / endpoint overrides. */
export const FEATURE_OVERRIDES_KEY = 'overrides';
/** Reserved field inside one override entry: the level's enable switch. */
export const FEATURE_ENABLED_KEY = 'enabled';
/** Adapter instance alias, the top-level key of an adapter Plugin block. */
export const FEATURE_ADAPTER_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
/** `<alias>/<endpointId>`; endpoint ids exclude the record (`~`) and capability (`\0`) delimiters. */
export const FEATURE_ENDPOINT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*\/[^/~\0]+$/u;

export type FeatureOverrideEntry = Readonly<Record<string, unknown>> & { readonly enabled?: boolean };
export interface FeatureOverrides {
  readonly adapters?: Readonly<Record<string, FeatureOverrideEntry>>;
  readonly endpoints?: Readonly<Record<string, FeatureOverrideEntry>>;
}

/** Parsed resolution key: `''` (global), `'qq'` (adapter) or `'qq/bot-1'` (endpoint). */
export interface FeatureResolutionKey {
  readonly adapter?: string;
  readonly endpointId?: string;
}

/**
 * What `configFor` / `isEnabledFor` accept: a resolution key string, an explicit
 * `{ adapter: <instance alias>, endpointId? }`, or a message-like value carrying
 * `conversation.endpoint.id` (resolved through the generation's AdapterIndex).
 */
export type FeatureTarget =
  | string
  | Readonly<{ adapter: string; endpointId?: string }>
  | Readonly<{ conversation: Readonly<{ endpoint: Readonly<{ id: string }> }>; endpointId?: string }>;

export interface FeatureEnabledResolution {
  readonly enabled: boolean;
  /** Highest level whose switch is off. */
  readonly disabledAt?: FeatureConfigLevel;
  /** Set when a level above the queried one disabled the feature; the queried switch is then locked. */
  readonly lockedBy?: 'global' | 'adapter';
}

export interface LayeredConfigResolution<T = Readonly<Record<string, unknown>>> extends FeatureEnabledResolution {
  /** Normalized resolution key (`''`, `alias` or `alias/endpointId`). */
  readonly key: string;
  /** Effective value: deep-merged and frozen. Fields cleared with `null` are absent. */
  readonly value: Readonly<T>;
  /** JSON Pointer of every effective leaf (and every cleared path) → the level that set it. */
  readonly sources: Readonly<Record<string, FeatureConfigLevel>>;
}

export interface LayeredConfigInput {
  readonly global: unknown;
  readonly overrides?: unknown;
  /** False when the instance alias is listed in `disable_plugins`. */
  readonly globalEnabled?: boolean;
  readonly key?: FeatureResolutionKey | string;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseFeatureResolutionKey(key: string | FeatureResolutionKey | undefined): FeatureResolutionKey {
  if (key === undefined || key === '') return Object.freeze({});
  if (typeof key !== 'string') {
    if (key.endpointId !== undefined && key.adapter === undefined) throw new TypeError('An endpoint resolution key requires its adapter alias');
    return Object.freeze({ ...(key.adapter !== undefined ? { adapter: key.adapter } : {}), ...(key.endpointId !== undefined ? { endpointId: key.endpointId } : {}) });
  }
  const slash = key.indexOf('/');
  if (slash < 0) return Object.freeze({ adapter: key });
  return Object.freeze({ adapter: key.slice(0, slash), endpointId: key.slice(slash + 1) });
}

export function formatFeatureResolutionKey(key: FeatureResolutionKey | string | undefined): string {
  const parsed = parseFeatureResolutionKey(key);
  if (parsed.adapter === undefined) return '';
  return parsed.endpointId === undefined ? parsed.adapter : `${parsed.adapter}/${parsed.endpointId}`;
}

/** Reads the structural `overrides` value; anything malformed contributes nothing. */
export function readFeatureOverrides(value: unknown): FeatureOverrides {
  if (!plainObject(value)) return Object.freeze({});
  const pick = (entries: unknown): Readonly<Record<string, FeatureOverrideEntry>> | undefined => {
    if (!plainObject(entries)) return undefined;
    return Object.freeze(Object.fromEntries(Object.entries(entries)
      .filter((entry): entry is [string, FeatureOverrideEntry] => plainObject(entry[1]))));
  };
  const adapters = pick(value.adapters);
  const endpoints = pick(value.endpoints);
  return Object.freeze({ ...(adapters ? { adapters } : {}), ...(endpoints ? { endpoints } : {}) });
}

function overrideEntries(overrides: FeatureOverrides, key: FeatureResolutionKey): {
  adapter?: FeatureOverrideEntry;
  endpoint?: FeatureOverrideEntry;
} {
  const adapter = key.adapter !== undefined && Object.hasOwn(overrides.adapters ?? {}, key.adapter)
    ? overrides.adapters![key.adapter] : undefined;
  const endpointKey = key.adapter !== undefined && key.endpointId !== undefined ? `${key.adapter}/${key.endpointId}` : undefined;
  const endpoint = endpointKey !== undefined && Object.hasOwn(overrides.endpoints ?? {}, endpointKey)
    ? overrides.endpoints![endpointKey] : undefined;
  return { ...(adapter ? { adapter } : {}), ...(endpoint ? { endpoint } : {}) };
}

/** Top-down: an upper `false` wins and a lower `enabled: true` never re-enables. */
export function resolveFeatureEnabled(input: Omit<LayeredConfigInput, 'global'> & { readonly level?: FeatureConfigLevel }): FeatureEnabledResolution {
  const key = parseFeatureResolutionKey(input.key);
  const { adapter, endpoint } = overrideEntries(readFeatureOverrides(input.overrides), key);
  const disabledAt: FeatureConfigLevel | undefined = input.globalEnabled === false ? 'global'
    : adapter?.enabled === false ? 'adapter'
      : endpoint?.enabled === false ? 'endpoint' : undefined;
  const level = input.level ?? (key.endpointId !== undefined ? 'endpoint' : key.adapter !== undefined ? 'adapter' : 'global');
  const rank = (value: FeatureConfigLevel) => FEATURE_CONFIG_LEVELS.indexOf(value);
  const lockedBy = disabledAt !== undefined && disabledAt !== 'endpoint' && rank(disabledAt) < rank(level) ? disabledAt : undefined;
  return Object.freeze({ enabled: disabledAt === undefined, ...(disabledAt ? { disabledAt } : {}), ...(lockedBy ? { lockedBy } : {}) });
}

export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function clearSources(sources: Record<string, FeatureConfigLevel>, path: string): void {
  for (const existing of Object.keys(sources)) {
    if (existing === path || existing.startsWith(`${path}/`)) delete sources[existing];
  }
}

function markLeaves(value: unknown, path: string, level: FeatureConfigLevel, sources: Record<string, FeatureConfigLevel>): void {
  if (plainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) markLeaves(child, `${path}/${escapeJsonPointerSegment(key)}`, level, sources);
    return;
  }
  sources[path] = level;
}

function mergeLayer(
  base: Record<string, unknown>,
  layer: Readonly<Record<string, unknown>>,
  level: FeatureConfigLevel,
  prefix: string,
  sources: Record<string, FeatureConfigLevel>,
  top: boolean,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined || (top && (key === FEATURE_ENABLED_KEY || key === FEATURE_OVERRIDES_KEY))) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const path = `${prefix}/${escapeJsonPointerSegment(key)}`;
    if (value === null) {
      // Explicit clear: the field stops inheriting and is absent from the effective value.
      delete base[key];
      clearSources(sources, path);
      sources[path] = level;
      continue;
    }
    if (plainObject(value)) {
      const current = base[key];
      if (!plainObject(current)) clearSources(sources, path);
      base[key] = mergeLayer(plainObject(current) ? { ...current } : {}, value, level, path, sources, false);
      if (Object.keys(value).length === 0 && !plainObject(current)) sources[path] = level;
      continue;
    }
    // Arrays and scalars replace whole.
    clearSources(sources, path);
    base[key] = structuredClone(value);
    sources[path] = level;
  }
  return base;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Bottom-up merge `global ← adapter ← endpoint` with per-field source tracking. */
export function resolveLayeredConfig<T = Readonly<Record<string, unknown>>>(input: LayeredConfigInput): LayeredConfigResolution<T> {
  const key = parseFeatureResolutionKey(input.key);
  const overrides = readFeatureOverrides(input.overrides);
  const sources: Record<string, FeatureConfigLevel> = {};
  const global = plainObject(input.global) ? input.global : {};
  const { [FEATURE_OVERRIDES_KEY]: _ignored, ...globalFields } = global;
  for (const [field, value] of Object.entries(globalFields)) {
    if (value !== undefined) markLeaves(value, `/${escapeJsonPointerSegment(field)}`, 'global', sources);
  }
  let value: Record<string, unknown> = structuredClone(globalFields);
  const { adapter, endpoint } = overrideEntries(overrides, key);
  if (adapter) value = mergeLayer(value, adapter, 'adapter', '', sources, true);
  if (endpoint) value = mergeLayer(value, endpoint, 'endpoint', '', sources, true);
  const enabled = resolveFeatureEnabled({ overrides, globalEnabled: input.globalEnabled, key });
  return deepFreeze({
    ...enabled,
    key: formatFeatureResolutionKey(key),
    value: value as T,
    sources: Object.fromEntries(Object.entries(sources).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
  }) as LayeredConfigResolution<T>;
}

/** Source of one field path, falling back to the nearest recorded ancestor (a whole replaced object). */
export function featureConfigSource(
  resolution: Pick<LayeredConfigResolution, 'sources'>,
  path: readonly string[],
): FeatureConfigLevel | undefined {
  for (let length = path.length; length > 0; length -= 1) {
    const pointer = `/${path.slice(0, length).map(escapeJsonPointerSegment).join('/')}`;
    const source = resolution.sources[pointer];
    if (source) return source;
  }
  return undefined;
}

/** The document address of one Plugin instance's own config block (`root/a/b` → `['a', 'b']`). */
export function pluginConfigBlockPath(owner: PluginId): readonly string[] {
  const parts = String(owner).split('/');
  return Object.freeze(parts.slice(1));
}

export function readPluginConfigBlock(document: RuntimeConfigDocument | undefined, owner: PluginId): Readonly<Record<string, unknown>> | undefined {
  const path = pluginConfigBlockPath(owner);
  if (!document || path.length === 0) return undefined;
  let value: unknown = document;
  for (const segment of path) {
    if (!plainObject(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return plainObject(value) ? value : undefined;
}

export function readPrimaryConfig(snapshot: Pick<RuntimeSnapshot, 'root' | 'resources'>): PrimaryConfig | undefined {
  return snapshot.resources.get(snapshot.root)?.get(primaryConfigToken.id) as PrimaryConfig | undefined;
}

interface EndpointResolutionIndex {
  owner(id: string): PluginId;
  endpointEntry(id: string): { readonly desired?: { readonly endpointId?: unknown } } | undefined;
}

const adapterProjectionId = featureId('zhin.adapter');

function endpointIndex(snapshot: Pick<RuntimeSnapshot, 'projections'>): EndpointResolutionIndex | undefined {
  const value = snapshot.projections.get(adapterProjectionId) as Partial<EndpointResolutionIndex> | undefined;
  return value && typeof value.owner === 'function' && typeof value.endpointEntry === 'function'
    ? value as EndpointResolutionIndex : undefined;
}

/**
 * Maps a message endpoint (`conversation.endpoint.id`, a CapabilityId) to its resolution key
 * `<adapter instance alias>/<endpointId>`; undefined when this generation does not know it.
 */
export function resolveEndpointFeatureKey(
  snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'>,
  endpointCapabilityId: string,
  fallbackEndpointId?: string,
): string | undefined {
  const index = endpointIndex(snapshot);
  if (!index) return undefined;
  let owner: PluginId;
  try { owner = index.owner(endpointCapabilityId); } catch { return undefined; }
  const alias = snapshot.tree.get(owner)?.instanceKey;
  if (!alias) return undefined;
  let endpointId: unknown;
  try { endpointId = index.endpointEntry(endpointCapabilityId)?.desired?.endpointId; } catch { endpointId = undefined; }
  const id = typeof endpointId === 'string' && endpointId ? endpointId
    : typeof fallbackEndpointId === 'string' && fallbackEndpointId ? fallbackEndpointId : undefined;
  return id === undefined ? alias : `${alias}/${id}`;
}

/** Normalizes any {@link FeatureTarget}; message targets need the generation's AdapterIndex. */
export function resolveFeatureTargetKey(
  snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined,
  target: FeatureTarget,
): string | undefined {
  if (typeof target === 'string') return formatFeatureResolutionKey(target);
  if (!target || typeof target !== 'object') throw new TypeError('Feature target must be a resolution key, { adapter, endpointId } or a message');
  if ('conversation' in target) {
    const id = target.conversation?.endpoint?.id;
    if (typeof id !== 'string' || !snapshot) return undefined;
    return resolveEndpointFeatureKey(snapshot, id, typeof target.endpointId === 'string' ? target.endpointId : undefined);
  }
  if (typeof target.adapter !== 'string' || !target.adapter) throw new TypeError('Feature target adapter must be an instance alias');
  return formatFeatureResolutionKey({ adapter: target.adapter, ...(typeof target.endpointId === 'string' ? { endpointId: target.endpointId } : {}) });
}

const enabledCache = new WeakMap<object, Map<string, boolean>>();

/**
 * Dispatch gate: whether `owner` is enabled for one resolution key in this generation.
 * Plugins listed in `disable_plugins` never load, so only override levels are consulted here.
 */
export function isFeatureOwnerEnabled(
  snapshot: Pick<RuntimeSnapshot, 'root' | 'resources'>,
  owner: PluginId,
  key: string | undefined,
): boolean {
  if (!key || owner === snapshot.root) return true;
  const primary = readPrimaryConfig(snapshot);
  if (!primary) return true;
  let cache = enabledCache.get(primary);
  if (!cache) { cache = new Map(); enabledCache.set(primary, cache); }
  const cacheKey = `${String(owner)}\0${key}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const overrides = readPluginConfigBlock(primary.document, owner)?.[FEATURE_OVERRIDES_KEY];
  // A nested Plugin inherits its ancestors' switches: a disabled parent hides its children too.
  const parent = String(owner).slice(0, String(owner).lastIndexOf('/')) as PluginId;
  const enabled = (parent === snapshot.root || !String(parent) || isFeatureOwnerEnabled(snapshot, parent, key))
    && resolveFeatureEnabled({ overrides, key }).enabled;
  cache.set(cacheKey, enabled);
  return enabled;
}

/** Owners in `owners` that are switched off for `key`; empty for global keys. */
export function disabledFeatureOwners(
  snapshot: Pick<RuntimeSnapshot, 'root' | 'resources'>,
  owners: Iterable<PluginId>,
  key: string | undefined,
): ReadonlySet<PluginId> {
  const disabled = new Set<PluginId>();
  if (!key) return disabled;
  for (const owner of owners) if (!isFeatureOwnerEnabled(snapshot, owner, key)) disabled.add(owner);
  return disabled;
}
