/**
 * Layered feature configuration (ADR 0050 / 0055): global < adapter < endpoint < conversation.
 *
 * Pure resolution shared by the Runtime (`configFor` / `isEnabledFor`), IM dispatch
 * gating and Agent tool disclosure. Schema-level checks live in `@zhin.js/runtime`.
 */
import { primaryConfigToken, type PrimaryConfig } from './host-installer.js';
import { featureId, type PluginId } from './identity.js';
import type { RuntimeConfigDocument } from './root-config-document.js';
import type { RuntimeSnapshot } from './snapshot.js';
import { createToken } from './token.js';

export type FeatureConfigLevel = 'global' | 'adapter' | 'endpoint' | 'conversation';
export const FEATURE_CONFIG_LEVELS: readonly FeatureConfigLevel[] = Object.freeze(['global', 'adapter', 'endpoint', 'conversation']);
/**
 * Levels that can lock the levels below them (`lockedBy`). Only `global` lives in the
 * configuration file; adapter / endpoint / conversation overrides live in the project database
 * (ADR 0057 §2).
 */
export type FeatureFileLevel = Exclude<FeatureConfigLevel, 'conversation'>;
/** Mirrors `ConversationKind` of `@zhin.js/im-contract` (this package has no dependencies). */
export type FeatureConversationKind = 'group' | 'private' | 'channel';
export const FEATURE_CONVERSATION_KINDS: readonly FeatureConversationKind[] = Object.freeze(['group', 'private', 'channel']);
/** Longest accepted platform conversation id (unescaped). */
export const FEATURE_CONVERSATION_ID_MAX_LENGTH = 256;
/**
 * Reserved key in a Plugin's own config block that held adapter / endpoint overrides before
 * ADR 0057 §2. They live in the project database now; the key is only read by the one-time
 * import and is otherwise refused.
 */
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

/** Parsed resolution key: `''` (global), `'qq'` (adapter), `'qq/bot-1'` (endpoint) or `'qq/bot-1/group:123'` (conversation). */
export interface FeatureResolutionKey {
  readonly adapter?: string;
  readonly endpointId?: string;
  /** Requires `adapter` and `endpointId`. `id` is the unescaped platform conversation id. */
  readonly conversation?: FeatureConversationTarget;
}

export interface FeatureConversationTarget {
  readonly kind: FeatureConversationKind;
  readonly id: string;
}

/** One stored adapter / endpoint / conversation override (ADR 0055 §3, ADR 0057 §2). */
export interface FeatureConversationOverride {
  /** Only `false` is ever stored: enabling at a lower level removes the switch. */
  readonly enabled?: false;
  /** Field patch limited to the fields the Plugin allows at the row's level. */
  readonly patch: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly updatedAt: number;
  readonly updatedBy?: string;
}

/**
 * Read side of the instance's feature override store (adapter / endpoint / conversation levels),
 * provided on the Root Scope. The level follows from the key.
 */
export interface FeatureConversationOverrideReader {
  /** Bumped on every write; resolution caches compare it. */
  readonly version: number;
  /**
   * `plugin` is the instance path (`rss`, `parent/child`); `key` an adapter (`qq`), endpoint
   * (`qq/bot-1`) or conversation (`qq/bot-1/group:1`) resolution key.
   */
  get(plugin: string, key: string): FeatureConversationOverride | undefined;
}

export const featureConversationOverridesToken = createToken<FeatureConversationOverrideReader>(
  'zhin.feature-conversation-overrides',
  'Adapter / endpoint / conversation feature overrides (ADR 0055, ADR 0057), read side',
);

/**
 * What `configFor` / `isEnabledFor` accept: a resolution key string, an explicit
 * `{ adapter: <instance alias>, endpointId? }`, or a message-like value carrying
 * `conversation.endpoint.id` (resolved through the generation's AdapterIndex).
 */
export type FeatureTarget =
  | string
  | Readonly<{ adapter: string; endpointId?: string; conversation?: FeatureConversationTarget }>
  | Readonly<{ conversation: Readonly<{ endpoint: Readonly<{ id: string }>; kind?: string; id?: string }>; endpointId?: string }>
  /**
   * An outbound selector (`outbound.send({ adapter, endpointKey })`): resolved to the Endpoint's
   * CapabilityId through the same `AdapterIndex.resolve` path as the send, so platform names,
   * online names and omitted keys address the same account the send reaches.
   */
  | Readonly<{ endpoint: Readonly<{ adapter: string; endpointKey: string }>; conversation?: Readonly<{ kind?: string; id?: string }> }>;

export interface FeatureEnabledResolution {
  readonly enabled: boolean;
  /** Highest level whose switch is off. */
  readonly disabledAt?: FeatureConfigLevel;
  /**
   * Set when a level above the queried one disabled the feature. The queried level is then
   * locked: it can neither enable nor change its own switch (ADR 0050 §4).
   */
  readonly lockedBy?: FeatureFileLevel;
}

export interface LayeredConfigResolution<T = Readonly<Record<string, unknown>>> extends FeatureEnabledResolution {
  /** Normalized resolution key (`''`, `alias`, `alias/endpointId` or `alias/endpointId/kind:id`). */
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
  /** Conversation-level entry (`{ enabled?: false, ...patch }`); used only for conversation keys. */
  readonly conversation?: FeatureOverrideEntry;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const ADAPTER_ALIAS = /^[a-z0-9][a-z0-9-]*$/u;
const ENDPOINT_ID = /^[^/~\0]{1,128}$/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

/**
 * Escapes a platform conversation id for a resolution key: `%` → `%25`, `/` → `%2F`, nothing
 * else. The key then has exactly two `/` separators and the id round-trips unchanged.
 */
export function escapeFeatureConversationId(id: string): string {
  return id.replaceAll('%', '%25').replaceAll('/', '%2F');
}

/** Inverse of {@link escapeFeatureConversationId}; undefined for any other `%` sequence or a raw `/`. */
export function unescapeFeatureConversationId(escaped: string): string | undefined {
  if (/%(?!25|2[fF])/u.test(escaped) || escaped.includes('/')) return undefined;
  return escaped.replace(/%2[fF]|%25/gu, match => match === '%25' ? '%' : '/');
}

/** Whether `id` can be a conversation key id: 1–256 characters without control characters. */
export function isFeatureConversationId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= FEATURE_CONVERSATION_ID_MAX_LENGTH && !CONTROL_CHARACTERS.test(id);
}

function assertConversationParts(adapter: string, endpointId: string, conversation: FeatureConversationTarget): void {
  if (!ADAPTER_ALIAS.test(adapter)) throw new TypeError('A conversation resolution key requires an adapter instance alias');
  if (!ENDPOINT_ID.test(endpointId)) throw new TypeError('A conversation resolution key requires a valid endpointId');
  if (!FEATURE_CONVERSATION_KINDS.includes(conversation.kind)) throw new TypeError('Conversation kind must be group, private or channel');
  if (!isFeatureConversationId(conversation.id)) throw new TypeError('Conversation id must be 1-256 characters without control characters');
}

/** `<alias>/<endpointId>/<kind>:<escaped id>` (ADR 0055 §1). */
export function formatFeatureConversationKey(adapter: string, endpointId: string, conversation: FeatureConversationTarget): string {
  assertConversationParts(adapter, endpointId, conversation);
  return `${adapter}/${endpointId}/${conversation.kind}:${escapeFeatureConversationId(conversation.id)}`;
}

/** Parses a conversation key; undefined for adapter / endpoint keys and malformed input. */
export function parseFeatureConversationKey(key: string): Required<FeatureResolutionKey> | undefined {
  const first = key.indexOf('/');
  const second = first < 0 ? -1 : key.indexOf('/', first + 1);
  if (first <= 0 || second < 0) return undefined;
  const rest = key.slice(second + 1);
  const colon = rest.indexOf(':');
  if (colon <= 0) return undefined;
  const id = unescapeFeatureConversationId(rest.slice(colon + 1));
  if (id === undefined) return undefined;
  const parsed = { adapter: key.slice(0, first), endpointId: key.slice(first + 1, second),
    conversation: Object.freeze({ kind: rest.slice(0, colon) as FeatureConversationKind, id }) };
  try { assertConversationParts(parsed.adapter, parsed.endpointId, parsed.conversation); } catch { return undefined; }
  return formatFeatureConversationKey(parsed.adapter, parsed.endpointId, parsed.conversation) === key ? Object.freeze(parsed) : undefined;
}

export function parseFeatureResolutionKey(key: string | FeatureResolutionKey | undefined): FeatureResolutionKey {
  if (key === undefined || key === '') return Object.freeze({});
  if (typeof key !== 'string') {
    if (key.endpointId !== undefined && key.adapter === undefined) throw new TypeError('An endpoint resolution key requires its adapter alias');
    if (key.conversation !== undefined) {
      if (key.adapter === undefined || key.endpointId === undefined) throw new TypeError('A conversation resolution key requires its adapter alias and endpointId');
      assertConversationParts(key.adapter, key.endpointId, key.conversation);
    }
    return Object.freeze({ ...(key.adapter !== undefined ? { adapter: key.adapter } : {}), ...(key.endpointId !== undefined ? { endpointId: key.endpointId } : {}),
      ...(key.conversation !== undefined ? { conversation: Object.freeze({ kind: key.conversation.kind, id: key.conversation.id }) } : {}) });
  }
  const slash = key.indexOf('/');
  if (slash < 0) return Object.freeze({ adapter: key });
  if (key.indexOf('/', slash + 1) >= 0) {
    const conversation = parseFeatureConversationKey(key);
    if (!conversation) throw new TypeError('Invalid conversation resolution key (expected <alias>/<endpointId>/<kind>:<escaped id>)');
    return conversation;
  }
  return Object.freeze({ adapter: key.slice(0, slash), endpointId: key.slice(slash + 1) });
}

export function formatFeatureResolutionKey(key: FeatureResolutionKey | string | undefined): string {
  const parsed = parseFeatureResolutionKey(key);
  if (parsed.adapter === undefined) return '';
  if (parsed.endpointId === undefined) return parsed.adapter;
  return parsed.conversation === undefined ? `${parsed.adapter}/${parsed.endpointId}`
    : formatFeatureConversationKey(parsed.adapter, parsed.endpointId, parsed.conversation);
}

/** The endpoint key above a conversation key (`qq/bot/group:1` → `qq/bot`); other keys unchanged. */
export function featureEndpointKeyOf(key: string): string {
  const parsed = parseFeatureResolutionKey(key);
  return parsed.conversation ? `${parsed.adapter}/${parsed.endpointId}` : formatFeatureResolutionKey(parsed);
}

/** Conversation entry as resolution input: `{ enabled?: false, ...patch }`. */
export function featureConversationEntry(override: FeatureConversationOverride | undefined): FeatureOverrideEntry | undefined {
  if (!override) return undefined;
  return Object.freeze({ ...override.patch, ...(override.enabled === false ? { [FEATURE_ENABLED_KEY]: false } : {}) });
}

/** The Root Scope's feature override reader, when the instance provides one. */
export function readFeatureConversationOverrides(snapshot: Pick<RuntimeSnapshot, 'root' | 'resources'> | undefined): FeatureConversationOverrideReader | undefined {
  const value = snapshot?.resources.get(snapshot.root)?.get(featureConversationOverridesToken.id) as Partial<FeatureConversationOverrideReader> | undefined;
  return value && typeof value.get === 'function' ? value as FeatureConversationOverrideReader : undefined;
}

/** Instance path (`rss`, `parent/child`) of a non-root Plugin id. */
export function featureInstancePath(owner: PluginId): string {
  return String(owner).split('/').slice(1).join('/');
}

/**
 * Adapter / endpoint entries above (and at) `key` from the override store, shaped as
 * {@link FeatureOverrides} for {@link resolveLayeredConfig} / {@link resolveFeatureEnabled}.
 * Empty for the global key or without a reader.
 */
export function readStoredFeatureOverrides(
  reader: Pick<FeatureConversationOverrideReader, 'get'> | undefined,
  plugin: string,
  key: FeatureResolutionKey | string | undefined,
): FeatureOverrides {
  if (!reader) return Object.freeze({});
  let parsed: FeatureResolutionKey;
  try { parsed = parseFeatureResolutionKey(key); } catch { return Object.freeze({}); }
  if (parsed.adapter === undefined) return Object.freeze({});
  const adapter = featureConversationEntry(reader.get(plugin, parsed.adapter));
  const endpointKey = parsed.endpointId !== undefined ? `${parsed.adapter}/${parsed.endpointId}` : undefined;
  const endpoint = endpointKey !== undefined ? featureConversationEntry(reader.get(plugin, endpointKey)) : undefined;
  return Object.freeze({
    ...(adapter ? { adapters: Object.freeze({ [parsed.adapter]: adapter }) } : {}),
    ...(endpoint ? { endpoints: Object.freeze({ [endpointKey!]: endpoint }) } : {}),
  });
}

/** Reads a structural `overrides` value; anything malformed contributes nothing. */
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

/** Level a resolution key addresses. */
export function featureKeyLevel(key: FeatureResolutionKey | string | undefined): FeatureConfigLevel {
  const parsed = parseFeatureResolutionKey(key);
  return parsed.conversation !== undefined ? 'conversation' : parsed.endpointId !== undefined ? 'endpoint' : parsed.adapter !== undefined ? 'adapter' : 'global';
}

/**
 * Top-down: an upper `false` wins and a lower `enabled: true` never re-enables. A level is
 * locked (`lockedBy`) when any level above it is off; it may only disable while every upper
 * level is on (ADR 0050 §4, ADR 0055 §4).
 */
export function resolveFeatureEnabled(input: Omit<LayeredConfigInput, 'global'> & { readonly level?: FeatureConfigLevel }): FeatureEnabledResolution {
  const key = parseFeatureResolutionKey(input.key);
  const { adapter, endpoint } = overrideEntries(readFeatureOverrides(input.overrides), key);
  const conversation = key.conversation !== undefined && plainObject(input.conversation) ? input.conversation : undefined;
  const disabledAt: FeatureConfigLevel | undefined = input.globalEnabled === false ? 'global'
    : adapter?.enabled === false ? 'adapter'
      : endpoint?.enabled === false ? 'endpoint'
        : conversation?.enabled === false ? 'conversation' : undefined;
  const level = input.level ?? featureKeyLevel(key);
  const rank = (value: FeatureConfigLevel) => FEATURE_CONFIG_LEVELS.indexOf(value);
  const lockedBy = disabledAt !== undefined && disabledAt !== 'conversation' && rank(disabledAt) < rank(level) ? disabledAt : undefined;
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

/** Bottom-up merge `global ← adapter ← endpoint ← conversation` with per-field source tracking. */
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
  const conversation = key.conversation !== undefined && plainObject(input.conversation) ? input.conversation : undefined;
  if (conversation) value = mergeLayer(value, conversation, 'conversation', '', sources, true);
  const enabled = resolveFeatureEnabled({ overrides, globalEnabled: input.globalEnabled, key, ...(conversation ? { conversation } : {}) });
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
  /** `AdapterIndex.resolve`: outbound selector → CapabilityId. */
  resolve?(adapter: string, endpointKey: string): string | undefined;
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
 * With `conversation` (kind + platform id) the key goes down to the conversation level; an id
 * that cannot be keyed (too long, control characters) stays at the endpoint level.
 */
export function resolveEndpointFeatureKey(
  snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'>,
  endpointCapabilityId: string,
  fallbackEndpointId?: string,
  conversation?: Readonly<{ kind?: unknown; id?: unknown }>,
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
  if (id === undefined) return alias;
  if (conversation && FEATURE_CONVERSATION_KINDS.includes(conversation.kind as FeatureConversationKind) && isFeatureConversationId(conversation.id)) {
    try { return formatFeatureConversationKey(alias, id, { kind: conversation.kind as FeatureConversationKind, id: conversation.id }); }
    catch { /* an endpoint id that cannot carry conversations stays at the endpoint level */ }
  }
  return `${alias}/${id}`;
}

/** Normalizes any {@link FeatureTarget}; message targets need the generation's AdapterIndex. */
export function resolveFeatureTargetKey(
  snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined,
  target: FeatureTarget,
): string | undefined {
  if (typeof target === 'string') return formatFeatureResolutionKey(target);
  if (!target || typeof target !== 'object') throw new TypeError('Feature target must be a resolution key, { adapter, endpointId } or a message');
  const selector = (target as { endpoint?: unknown }).endpoint;
  if (selector && typeof selector === 'object' && !('id' in selector)) {
    const { adapter, endpointKey } = selector as { adapter?: unknown; endpointKey?: unknown };
    if (typeof adapter !== 'string' || typeof endpointKey !== 'string' || !snapshot) return undefined;
    const index = endpointIndex(snapshot);
    let id: string | undefined;
    try { id = index?.resolve?.(adapter, endpointKey); } catch { id = undefined; }
    if (!id) return undefined;
    const conversation = (target as { conversation?: Readonly<{ kind?: unknown; id?: unknown }> }).conversation;
    return resolveEndpointFeatureKey(snapshot, String(id), undefined, conversation);
  }
  const conversation = (target as { conversation?: unknown }).conversation;
  if (conversation && typeof conversation === 'object' && 'endpoint' in conversation) {
    const message = target as Readonly<{ conversation: Readonly<{ endpoint: Readonly<{ id: string }>; kind?: string; id?: string }>; endpointId?: string }>;
    const id = message.conversation?.endpoint?.id;
    if (typeof id !== 'string' || !snapshot) return undefined;
    return resolveEndpointFeatureKey(snapshot, id, typeof message.endpointId === 'string' ? message.endpointId : undefined, message.conversation);
  }
  const explicit = target as Readonly<{ adapter?: unknown; endpointId?: unknown; conversation?: FeatureConversationTarget }>;
  if (typeof explicit.adapter !== 'string' || !explicit.adapter) throw new TypeError('Feature target adapter must be an instance alias');
  return formatFeatureResolutionKey({ adapter: explicit.adapter, ...(typeof explicit.endpointId === 'string' ? { endpointId: explicit.endpointId } : {}),
    ...(explicit.conversation !== undefined ? { conversation: explicit.conversation } : {}) });
}

const enabledCache = new WeakMap<object, { version: number; entries: Map<string, boolean> }>();
/** Bound for one generation's per-key cache; conversations are open-ended. */
const ENABLED_CACHE_LIMIT = 20_000;

/**
 * Dispatch gate: whether `owner` is enabled for one resolution key in this generation.
 * Plugins listed in `disable_plugins` never load, so only the stored override levels (adapter /
 * endpoint / conversation, ADR 0057 §2) are consulted here; the cache is keyed by
 * (configuration generation, store version, owner, key).
 */
export function isFeatureOwnerEnabled(
  snapshot: Pick<RuntimeSnapshot, 'root' | 'resources'>,
  owner: PluginId,
  key: string | undefined,
): boolean {
  if (!key || owner === snapshot.root) return true;
  const primary = readPrimaryConfig(snapshot);
  if (!primary) return true;
  let parsed: FeatureResolutionKey;
  try { parsed = parseFeatureResolutionKey(key); } catch { return true; }
  if (parsed.adapter === undefined) return true;
  const reader = readFeatureConversationOverrides(snapshot);
  const version = reader?.version ?? -1;
  let cache = enabledCache.get(primary);
  if (!cache || (reader && cache.version !== version)) {
    // A store write invalidates the generation's cache.
    cache = { version: reader ? version : cache?.version ?? -1, entries: new Map() };
    enabledCache.set(primary, cache);
  }
  const cacheKey = `${String(owner)}\0${key}`;
  const cached = cache.entries.get(cacheKey);
  if (cached !== undefined) return cached;
  const plugin = featureInstancePath(owner);
  const overrides = readStoredFeatureOverrides(reader, plugin, parsed);
  const conversation = reader && parsed.conversation ? featureConversationEntry(reader.get(plugin, key)) : undefined;
  // A nested Plugin inherits its ancestors' switches: a disabled parent hides its children too.
  const parent = String(owner).slice(0, String(owner).lastIndexOf('/')) as PluginId;
  const enabled = (parent === snapshot.root || !String(parent) || isFeatureOwnerEnabled(snapshot, parent, key))
    && resolveFeatureEnabled({ overrides, key, ...(conversation ? { conversation } : {}) }).enabled;
  if (cache.entries.size >= ENABLED_CACHE_LIMIT) cache.entries.clear();
  cache.entries.set(cacheKey, enabled);
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
