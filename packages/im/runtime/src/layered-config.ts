/**
 * ADR 0050 schema side: `x-zhin-config.levels`, the reserved `overrides` key,
 * override validation / warnings and the Plugin context accessor behind
 * `configFor` / `isEnabledFor`. Pure merge semantics live in `@zhin.js/plugin-runtime`.
 */
import type { ValidateFunction } from 'ajv/dist/2020.js';
import {
  FEATURE_ADAPTER_KEY_PATTERN, FEATURE_CONFIG_LEVELS, FEATURE_ENABLED_KEY, FEATURE_ENDPOINT_KEY_PATTERN,
  FEATURE_OVERRIDES_KEY, escapeJsonPointerSegment, featureConversationEntry, featureInstancePath,
  parseFeatureResolutionKey, readFeatureConversationOverrides, readFeatureOverrides, readPluginConfigBlock, readPrimaryConfig,
  resolveFeatureEnabled, resolveFeatureTargetKey, resolveLayeredConfig,
  type FeatureConfigLevel, type FeatureOverrideEntry, type FeatureTarget, type LayeredConfigResolution, type PluginId, type PrimaryConfig,
  type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { configurationValidator, type JsonSchema } from './config-composer.js';

export type { FeatureConfigLevel } from '@zhin.js/plugin-runtime';

type SchemaRecord = Record<string, unknown>;
const record = (value: unknown): value is SchemaRecord => !!value && typeof value === 'object' && !Array.isArray(value);
/** Override levels stored in the configuration file (`overrides.adapters` / `overrides.endpoints`). */
const OVERRIDE_LEVELS = ['adapter', 'endpoint'] as const;
export type FeatureFileOverrideLevel = typeof OVERRIDE_LEVELS[number];
/** Every override level; `conversation` is stored in the project database (ADR 0055). */
export type FeatureOverrideLevel = FeatureFileOverrideLevel | 'conversation';
/** Framework-injected fields that never take part in per-endpoint overrides. */
const NON_OVERRIDABLE_FIELDS: ReadonlySet<string> = new Set(['commandNamespace', 'disabledCommands', FEATURE_OVERRIDES_KEY, FEATURE_ENABLED_KEY]);

function readLevels(metadata: unknown, label: string): readonly FeatureConfigLevel[] | undefined {
  if (!record(metadata) || metadata.levels === undefined) return undefined;
  const levels = metadata.levels;
  if (!Array.isArray(levels) || levels.length === 0
    || levels.some(level => typeof level !== 'string' || !FEATURE_CONFIG_LEVELS.includes(level as FeatureConfigLevel))
    || new Set(levels).size !== levels.length) {
    throw new TypeError(`${label} x-zhin-config.levels must be a non-empty, duplicate-free subset of global, adapter, endpoint, conversation`);
  }
  if (!levels.includes('global')) throw new TypeError(`${label} x-zhin-config.levels must include global`);
  if (levels.includes('conversation') && !levels.includes('endpoint')) throw new TypeError(`${label} x-zhin-config.levels with conversation must include endpoint`);
  return Object.freeze(FEATURE_CONFIG_LEVELS.filter(level => levels.includes(level)));
}

/** Root declaration; omission means `['global']` (no field overrides, three-level enable switch only). */
export function readFeatureLevels(schema: JsonSchema | null | undefined): readonly FeatureConfigLevel[] {
  return (schema ? readLevels(schema['x-zhin-config'], 'Plugin config schema') : undefined) ?? Object.freeze(['global'] as FeatureConfigLevel[]);
}

/** Effective levels of one top-level property: it may narrow, never widen, the root declaration. */
export function readFieldLevels(rootLevels: readonly FeatureConfigLevel[], field: string, schema: unknown): readonly FeatureConfigLevel[] {
  const own = record(schema) ? readLevels(schema['x-zhin-config'], `Config property ${field}`) : undefined;
  if (!own) return rootLevels;
  const widened = own.filter(level => !rootLevels.includes(level));
  if (widened.length) throw new TypeError(`Config property ${field} x-zhin-config.levels cannot widen the Plugin levels (${widened.join(', ')})`);
  return own;
}

function readFieldList(metadata: SchemaRecord, name: 'conversationFields' | 'selfServiceFields' | 'chatAdminFields'): readonly string[] | undefined {
  const value = metadata[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(field => typeof field !== 'string' || !field) || new Set(value).size !== value.length) {
    throw new TypeError(`Plugin config schema x-zhin-config.${name} must be a duplicate-free array of field names`);
  }
  return Object.freeze([...value] as string[]);
}

export interface FeatureConversationDeclaration {
  /** Fields editable at the conversation level (Console); empty: enable switch only. */
  readonly conversationFields: readonly string[];
  /** Fields group admins may change in chat; always a subset of `conversationFields`. */
  readonly selfServiceFields: readonly string[];
  /**
   * Fields feature admins may change in chat above the conversation level (endpoint / adapter /
   * global); defaults to `selfServiceFields`. Each level still applies its own `levels` filter.
   */
  readonly chatAdminFields: readonly string[];
}

/**
 * Root `x-zhin-config.conversationFields` / `selfServiceFields` (ADR 0055 §2). Both require
 * `levels` to include `conversation`; each field must be an own property that allows the
 * conversation level, and self-service fields must also be conversation fields.
 */
export function readFeatureConversationDeclaration(schema: JsonSchema | null | undefined): FeatureConversationDeclaration {
  const empty = Object.freeze({ conversationFields: Object.freeze([] as string[]), selfServiceFields: Object.freeze([] as string[]),
    chatAdminFields: Object.freeze([] as string[]) });
  const metadata = schema && record(schema['x-zhin-config']) ? schema['x-zhin-config'] : undefined;
  if (!schema || !metadata) return empty;
  const conversationFields = readFieldList(metadata, 'conversationFields');
  const selfServiceFields = readFieldList(metadata, 'selfServiceFields');
  const chatAdminFields = readFieldList(metadata, 'chatAdminFields');
  const properties = record(schema.properties) ? schema.properties : {};
  for (const field of chatAdminFields ?? []) {
    if (NON_OVERRIDABLE_FIELDS.has(field) || !Object.hasOwn(properties, field)) {
      throw new TypeError(`Plugin config schema x-zhin-config.chatAdminFields names unknown field ${field}`);
    }
  }
  if (!conversationFields && !selfServiceFields) {
    return chatAdminFields ? Object.freeze({ ...empty, chatAdminFields }) : empty;
  }
  const root = readFeatureLevels(schema);
  if (!root.includes('conversation')) {
    throw new TypeError('Plugin config schema x-zhin-config.conversationFields / selfServiceFields require levels to include conversation');
  }
  for (const field of conversationFields ?? []) {
    if (NON_OVERRIDABLE_FIELDS.has(field) || !Object.hasOwn(properties, field)) {
      throw new TypeError(`Plugin config schema x-zhin-config.conversationFields names unknown field ${field}`);
    }
    if (!readFieldLevels(root, field, properties[field]).includes('conversation')) {
      throw new TypeError(`Plugin config schema x-zhin-config.conversationFields: field ${field} does not allow the conversation level`);
    }
  }
  for (const field of selfServiceFields ?? []) {
    if (!conversationFields?.includes(field)) {
      throw new TypeError(`Plugin config schema x-zhin-config.selfServiceFields: field ${field} must also be listed in conversationFields`);
    }
  }
  return Object.freeze({ conversationFields: conversationFields ?? Object.freeze([]), selfServiceFields: selfServiceFields ?? Object.freeze([]),
    chatAdminFields: chatAdminFields ?? selfServiceFields ?? Object.freeze([]) });
}

/** Throws when the root or any property declares invalid or widening levels, or invalid conversation fields. */
export function assertFeatureLevelDeclarations(schema: JsonSchema, label = 'Plugin config schema'): void {
  let root: readonly FeatureConfigLevel[];
  try { root = readFeatureLevels(schema); } catch (error) { throw new TypeError(`${label}: ${(error as Error).message}`); }
  const properties = record(schema.properties) ? schema.properties : {};
  for (const [field, child] of Object.entries(properties)) {
    try { readFieldLevels(root, field, child); } catch (error) { throw new TypeError(`${label}: ${(error as Error).message}`); }
  }
  try { readFeatureConversationDeclaration(schema); } catch (error) { throw new TypeError(`${label}: ${(error as Error).message}`); }
}

/** Own fields that may be overridden at `level` (conversation: the declared `conversationFields`). */
export function overridableFields(schema: JsonSchema, level: FeatureOverrideLevel): readonly string[] {
  const root = readFeatureLevels(schema);
  if (!root.includes(level)) return Object.freeze([]);
  if (level === 'conversation') return readFeatureConversationDeclaration(schema).conversationFields;
  const properties = record(schema.properties) ? schema.properties : {};
  return Object.freeze(Object.entries(properties)
    .filter(([field, child]) => !NON_OVERRIDABLE_FIELDS.has(field) && readFieldLevels(root, field, child).includes(level))
    .map(([field]) => field));
}

/**
 * Schema injected as `overrides` into every non-root Plugin's own schema. Only the
 * object type is checked here; structure, keys and field values are validated by
 * {@link validateFeatureOverrides} because `null` (explicit clear) and level filtering
 * cannot be expressed without union branches.
 */
export const FEATURE_OVERRIDES_SCHEMA: JsonSchema = deepFreeze({
  type: 'object',
  description: 'Per adapter / endpoint overrides (ADR 0050). Edit through the Console feature page or by hand.',
  'x-descriptionZh': '按适配器 / 账号覆盖的配置（ADR 0050）。可在 Console 功能页编辑，也可手写。',
  // Hidden from generic config forms / explanations; the feature editor owns this block.
  'x-zhin-config': { hidden: true },
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Field schema for an override: optional all the way down, without defaults to fill. */
function partialize(schema: unknown): unknown {
  if (!record(schema)) return schema;
  const { default: _default, required: _required, ...rest } = schema;
  if (!record(rest.properties)) return rest;
  return { ...rest, properties: Object.fromEntries(Object.entries(rest.properties).map(([key, child]) => [key, partialize(child)])) };
}

/**
 * Partial schema of one override entry at `level`: allowed fields plus the reserved `enabled`.
 * `fields` narrows the allowed fields further (in-chat self-service).
 */
export function featureOverrideEntrySchema(schema: JsonSchema, level: FeatureOverrideLevel, fields?: readonly string[]): JsonSchema {
  const properties = record(schema.properties) ? schema.properties : {};
  const allowed = overridableFields(schema, level).filter(field => !fields || fields.includes(field));
  return deepFreeze({
    type: 'object',
    additionalProperties: false,
    ...(schema.$defs ? { $defs: schema.$defs } : {}),
    properties: {
      [FEATURE_ENABLED_KEY]: { type: 'boolean' },
      ...Object.fromEntries(allowed.map(field => [field, partialize(properties[field])])),
    },
  });
}

/** Drop explicit clears before shape validation; the merged view is validated separately. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, withoutNulls(child)]));
}

const validators = new WeakMap<object, Map<string, ValidateFunction>>();
function compiled(schema: JsonSchema, kind: string, build: () => JsonSchema): ValidateFunction {
  let byKind = validators.get(schema);
  if (!byKind) { byKind = new Map(); validators.set(schema, byKind); }
  let validate = byKind.get(kind);
  if (!validate) { validate = configurationValidator().compile(build()); byKind.set(kind, validate); }
  return validate;
}

export interface FeatureOverrideIssue {
  /** JSON Pointer relative to the Plugin's own config block, e.g. `/overrides/endpoints/tg~1news/maxItems`. */
  readonly path: string;
  readonly message: string;
}

function issues(validate: ValidateFunction, prefix: string): FeatureOverrideIssue[] {
  return (validate.errors ?? []).map(error => {
    const params = error.params as Record<string, unknown> | undefined;
    const extra = typeof params?.additionalProperty === 'string' ? ` (additionalProperty: ${params.additionalProperty})` : '';
    return Object.freeze({ path: `${prefix}${error.instancePath}`, message: `${error.message ?? error.keyword}${extra}` });
  });
}

/**
 * Validates `block.overrides` against the Plugin schema: each entry with the level's partial
 * schema, then each effective (merged) view with the whole own schema. Never mutates `block`.
 */
export function validateFeatureOverrides(schema: JsonSchema, block: unknown): readonly FeatureOverrideIssue[] {
  const own = record(block) ? block : {};
  const raw = own[FEATURE_OVERRIDES_KEY];
  if (raw === undefined) return Object.freeze([]);
  const result: FeatureOverrideIssue[] = [];
  if (!record(raw)) return Object.freeze([{ path: `/${FEATURE_OVERRIDES_KEY}`, message: 'must be object' }]);
  for (const key of Object.keys(raw)) {
    if (key !== 'adapters' && key !== 'endpoints') result.push({ path: `/${FEATURE_OVERRIDES_KEY}`, message: `must NOT have additional properties (additionalProperty: ${key})` });
  }
  const effective = effectiveValidator(schema);
  const { [FEATURE_OVERRIDES_KEY]: _ignored, ...globalFields } = own;
  for (const level of OVERRIDE_LEVELS) {
    const group = raw[`${level}s`];
    if (group === undefined) continue;
    const groupPath = `/${FEATURE_OVERRIDES_KEY}/${level}s`;
    if (!record(group)) { result.push({ path: groupPath, message: 'must be object' }); continue; }
    const pattern = level === 'adapter' ? FEATURE_ADAPTER_KEY_PATTERN : FEATURE_ENDPOINT_KEY_PATTERN;
    const entry = compiled(schema, level, () => featureOverrideEntrySchema(schema, level));
    for (const [key, value] of Object.entries(group)) {
      const path = `${groupPath}/${escapeJsonPointerSegment(key)}`;
      if (!pattern.test(key)) { result.push({ path, message: level === 'adapter' ? 'key must be an adapter instance alias' : 'key must be <adapter alias>/<endpointId>' }); continue; }
      if (!record(value)) { result.push({ path, message: 'must be object' }); continue; }
      if (!entry(structuredClone(withoutNulls(value)))) { result.push(...issues(entry, path)); continue; }
      const merged = resolveLayeredConfig({ global: globalFields, overrides: raw, key }).value;
      if (!effective(structuredClone(merged))) {
        result.push(...issues(effective, path).map(issue => ({ ...issue, message: `effective configuration ${issue.message}` })));
      }
    }
  }
  return Object.freeze(result);
}

function effectiveValidator(schema: JsonSchema): ValidateFunction {
  return compiled(schema, 'effective', () => {
    const { $id: _id, ...rest } = schema;
    const properties = record(rest.properties) ? rest.properties : {};
    const { [FEATURE_OVERRIDES_KEY]: _overrides, ...fields } = properties;
    return { ...rest, properties: fields };
  });
}

/**
 * Validates one conversation-level entry (`{ enabled?, ...patch }`) for `key`: shape against
 * the conversation fields (narrowed to `fields` when given, e.g. `selfServiceFields`), then the
 * effective merged configuration against the whole own schema. Paths are relative to the entry.
 */
export function validateConversationOverride(
  schema: JsonSchema,
  block: unknown,
  key: string,
  entry: unknown,
  fields?: readonly string[],
): readonly FeatureOverrideIssue[] {
  if (!record(entry)) return Object.freeze([{ path: '', message: 'must be object' }]);
  const narrowed = fields ? `conversation:${[...fields].sort().join(',')}` : 'conversation';
  const shape = compiled(schema, narrowed, () => featureOverrideEntrySchema(schema, 'conversation', fields));
  if (!shape(structuredClone(withoutNulls(entry)))) return Object.freeze(issues(shape, ''));
  const own = record(block) ? block : {};
  const { [FEATURE_OVERRIDES_KEY]: overrides, ...globalFields } = own;
  const merged = resolveLayeredConfig({ global: globalFields, overrides, key, conversation: entry as FeatureOverrideEntry }).value;
  const effective = effectiveValidator(schema);
  if (!effective(structuredClone(merged))) {
    return Object.freeze(issues(effective, '').map(issue => ({ ...issue, message: `effective configuration ${issue.message}` })));
  }
  return Object.freeze([]);
}

export interface FeatureOverrideWarning {
  readonly code: 'unknown-adapter' | 'unknown-endpoint' | 'enabled-under-disabled';
  /** Instance path of the Plugin block, e.g. `rss` or `parent/child`. */
  readonly plugin: string;
  /** JSON Pointer relative to the Plugin block. */
  readonly path: string;
  readonly message: string;
}

function endpointIds(block: unknown): readonly string[] | undefined {
  const endpoints = record(block) ? block.endpoints : undefined;
  if (!Array.isArray(endpoints) || endpoints.length === 0) return undefined;
  return endpoints.flatMap(item => record(item) && typeof item.id === 'string' ? [item.id] : []);
}

/**
 * Non-fatal findings: keys naming undeclared adapter aliases / endpoint ids (kept, since an
 * account may be added later) and lower-level `enabled: true` under an upper-level disable.
 */
export function collectFeatureOverrideWarnings(
  document: RuntimeConfigDocument,
  plugin: string,
  overrides: unknown,
  globalEnabled = true,
): readonly FeatureOverrideWarning[] {
  const parsed = readFeatureOverrides(overrides);
  const declared = record(document.plugins) ? document.plugins : {};
  const warnings: FeatureOverrideWarning[] = [];
  const pointer = (level: FeatureOverrideLevel, key: string) => `/${FEATURE_OVERRIDES_KEY}/${level}s/${escapeJsonPointerSegment(key)}`;
  for (const [alias, entry] of Object.entries(parsed.adapters ?? {})) {
    if (!Object.hasOwn(declared, alias)) {
      warnings.push({ code: 'unknown-adapter', plugin, path: pointer('adapter', alias), message: `Adapter instance ${alias} is not declared in plugins` });
    }
    if (entry.enabled === true && !globalEnabled) {
      warnings.push({ code: 'enabled-under-disabled', plugin, path: `${pointer('adapter', alias)}/enabled`, message: `${plugin} is disabled globally; enabled: true at adapter ${alias} has no effect` });
    }
  }
  for (const [key, entry] of Object.entries(parsed.endpoints ?? {})) {
    const slash = key.indexOf('/');
    const alias = slash < 0 ? key : key.slice(0, slash);
    const id = slash < 0 ? '' : key.slice(slash + 1);
    if (!Object.hasOwn(declared, alias)) {
      warnings.push({ code: 'unknown-adapter', plugin, path: pointer('endpoint', key), message: `Adapter instance ${alias} is not declared in plugins` });
    } else {
      const ids = endpointIds(document[alias]);
      if (ids && !ids.includes(id)) {
        warnings.push({ code: 'unknown-endpoint', plugin, path: pointer('endpoint', key), message: `Endpoint ${id} is not configured under ${alias}.endpoints` });
      }
    }
    if (entry.enabled === true) {
      const upper = resolveFeatureEnabled({ overrides: parsed, globalEnabled, key: alias, level: 'endpoint' });
      if (!upper.enabled) {
        warnings.push({ code: 'enabled-under-disabled', plugin, path: `${pointer('endpoint', key)}/enabled`,
          message: `${plugin} is disabled at ${upper.disabledAt}; enabled: true at endpoint ${key} has no effect` });
      }
    }
  }
  return Object.freeze(warnings.map(warning => Object.freeze(warning)));
}

/** Whether `instancePath` (`['rss']`, `['parent', 'child']`) is enabled by `disable_plugins`. */
export function isGloballyEnabled(document: RuntimeConfigDocument | undefined, instancePath: readonly string[]): boolean {
  const disabled = Array.isArray(document?.disable_plugins) ? document.disable_plugins : [];
  return !(instancePath.length > 0 && disabled.includes(instancePath[0]!));
}

export interface LayeredConfigAccessorOptions {
  readonly owner: PluginId;
  /** Generation that created the Plugin Scope. */
  readonly generation: number;
  /** Own schema (with injected framework keys) used to pick the Plugin's fields from its block. */
  readonly schema?: JsonSchema;
  /** Candidate primary configuration while the Scope's generation is not committed yet. */
  readonly candidate: PrimaryConfig;
  readonly readCommitted?: () => RuntimeSnapshot | undefined;
  readonly readCandidate?: () => RuntimeSnapshot | undefined;
  /** Owner-scoped environment expansion, matching `context.config`. */
  readonly expand: <T>(value: T) => T;
  /** Fallback global view (`context.config.get()`) when the document has no block. */
  readonly view: Readonly<Record<string, unknown>>;
}

export interface LayeredConfigAccessor {
  resolve(target: FeatureTarget): LayeredConfigResolution;
  configFor<T>(target: FeatureTarget): Readonly<T>;
  isEnabledFor(target: FeatureTarget): boolean;
}

/** Live `configFor` / `isEnabledFor`: always the latest committed configuration, cached per generation and key. */
export function createLayeredConfigAccessor(options: LayeredConfigAccessorOptions): LayeredConfigAccessor {
  const cache = new WeakMap<PrimaryConfig, { version: number; entries: Map<string, LayeredConfigResolution> }>();
  const instancePath = String(options.owner).split('/').slice(1);
  const properties = options.schema && record(options.schema.properties) ? Object.keys(options.schema.properties) : undefined;
  const current = (): { primary: PrimaryConfig; snapshot?: RuntimeSnapshot } => {
    const committed = options.readCommitted?.();
    if (committed && committed.generation >= options.generation) {
      const primary = readPrimaryConfig(committed);
      if (primary) return { primary, snapshot: committed };
    }
    return { primary: options.candidate, snapshot: options.readCandidate?.() ?? committed };
  };
  const resolve = (target: FeatureTarget): LayeredConfigResolution => {
    const { primary, snapshot } = current();
    const key = resolveFeatureTargetKey(snapshot, target) ?? '';
    const conversationKey = key !== '' && parseFeatureResolutionKey(key).conversation !== undefined;
    const reader = conversationKey ? readFeatureConversationOverrides(snapshot) : undefined;
    let byKey = cache.get(primary);
    if (!byKey || (reader && byKey.version !== reader.version)) {
      // A conversation store write invalidates this generation's resolutions.
      byKey = { version: reader?.version ?? byKey?.version ?? -1, entries: new Map() };
      cache.set(primary, byKey);
    }
    const cached = byKey.entries.get(key);
    if (cached) return cached;
    const conversation = reader ? featureConversationEntry(reader.get(featureInstancePath(options.owner), key)) : undefined;
    const block = readPluginConfigBlock(primary.document, options.owner);
    const global = block
      ? options.expand(Object.fromEntries(Object.entries(block).filter(([field]) =>
        field !== FEATURE_OVERRIDES_KEY && (!properties || properties.includes(field)))))
      : options.view;
    let resolution = resolveLayeredConfig({
      global,
      overrides: block ? options.expand(block[FEATURE_OVERRIDES_KEY]) : undefined,
      globalEnabled: isGloballyEnabled(primary.document, instancePath),
      key,
      // Never environment-expanded: conversation patches come from the database and from chat.
      ...(conversation ? { conversation } : {}),
    });
    // A nested Plugin is hidden wherever one of its ancestors is switched off (same rule as dispatch).
    for (let depth = 1; resolution.enabled && depth < instancePath.length; depth += 1) {
      const ancestor = `root/${instancePath.slice(0, depth).join('/')}` as PluginId;
      const ancestorConversation = reader ? featureConversationEntry(reader.get(featureInstancePath(ancestor), key)) : undefined;
      const upper = resolveFeatureEnabled({ overrides: readPluginConfigBlock(primary.document, ancestor)?.[FEATURE_OVERRIDES_KEY], key,
        ...(ancestorConversation ? { conversation: ancestorConversation } : {}) });
      if (!upper.enabled) {
        resolution = deepFreeze({ ...resolution, enabled: false, disabledAt: upper.disabledAt,
          ...(upper.lockedBy ? { lockedBy: upper.lockedBy } : {}) });
      }
    }
    if (byKey.entries.size >= 20_000) byKey.entries.clear();
    byKey.entries.set(key, resolution);
    return resolution;
  };
  return Object.freeze({
    resolve,
    configFor: <T>(target: FeatureTarget) => resolve(target).value as Readonly<T>,
    isEnabledFor: (target: FeatureTarget) => resolve(target).enabled,
  });
}
