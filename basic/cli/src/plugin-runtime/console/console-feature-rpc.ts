/**
 * ADR 0050 §8: `feature.*` Console RPC over the layered feature configuration.
 *
 * Writes go through ConsoleConfigurationStore.patch (revision CAS, atomic write, whole-document
 * validation, configuration application), so override-only edits apply in place. The global
 * switch keeps the existing `disable_plugins` + restart path of `plugin:set-enabled`.
 */
import { isDeepStrictEqual } from 'node:util';
import type {
  ConsoleConfigPatchRequest, ConsoleConfigPatchResult, ConsoleFeatureGetResult, ConsoleFeatureLevel,
  ConsoleFeatureListResult, ConsoleFeatureMatrixCell, ConsoleFeatureMatrixResult,
  ConsoleFeatureMatrixRow, ConsoleFeaturePermission, ConsoleFeatureRpcType, ConsoleFeatureSummary,
  ConsoleFeatureWarning, ConsoleFeatureWriteResult,
} from '@zhin.js/console-protocol';
import {
  FEATURE_ENABLED_KEY, FEATURE_OVERRIDES_KEY, readFeatureOverrides, resolveFeatureEnabled, resolveLayeredConfig,
  type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import {
  collectFeatureOverrideWarnings, overridableFields, readFeatureLevels, setProjectPluginEnabled, validateFeatureOverrides,
  type JsonSchema,
} from '@zhin.js/runtime';
import { maskConfigValue } from './configuration-redaction.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';

const FEATURE_RPC_TYPES = {
  'feature.list': 'feature.view',
  'feature.matrix': 'feature.view',
  'feature.get': 'feature.view',
  'feature.set-override': 'feature.configure',
  'feature.remove-override': 'feature.configure',
  'feature.set-enabled': 'feature.toggle',
} as const satisfies Readonly<Record<ConsoleFeatureRpcType, ConsoleFeaturePermission>>;

/** What the RBAC layer (ADR 0049) checks; `level` / `key` are present for per-feature requests. */
export interface FeatureRpcAuthorization {
  readonly type: ConsoleFeatureRpcType;
  readonly permission: ConsoleFeaturePermission;
  readonly plugin?: string;
  readonly level?: ConsoleFeatureLevel;
  readonly key?: string;
}
/** Return false (or throw) to deny. Without it, only full-scope callers are admitted (deny by default). */
export type FeatureRpcAuthorizer = (request: FeatureRpcAuthorization) => boolean | Promise<boolean>;

export interface FeatureRpcConfigurationPort {
  readProject?(request: Readonly<{ path?: readonly string[]; reveal?: boolean }>): Promise<Readonly<{ revision: string; exists: boolean; value?: unknown }>>;
  patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult>;
}

export interface FeatureRpcContext {
  readonly authScope: string;
  readonly configuration: FeatureRpcConfigurationPort;
  readonly snapshots?: Pick<SnapshotReader, 'acquire'>;
  /** Global level: the `disable_plugins` writer used by `plugin:set-enabled`. */
  readonly setGlobalEnabled?: (instanceKey: string, enabled: boolean) => Promise<unknown>;
  readonly requestRestart?: () => void;
  readonly publishEvent?: (type: string, data: unknown) => void;
  readonly authorize?: FeatureRpcAuthorizer;
}

export interface FeatureRpcReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

class FeatureRpcError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'FeatureRpcError'; }
}
const invalid = (message: string): never => { throw new FeatureRpcError(400, message); };

type Record_ = Record<string, unknown>;
const record = (value: unknown): value is Record_ => !!value && typeof value === 'object' && !Array.isArray(value);
const INSTANCE_PATH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/u;
const ADAPTER_KEY = /^[a-z0-9][a-z0-9-]*$/u;
const ENDPOINT_KEY = /^[a-z0-9][a-z0-9-]*\/[^/~\0]{1,128}$/u;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
/** Framework-injected fields: shown nowhere in the feature editor. */
const RESERVED_FIELDS = new Set(['commandNamespace', 'disabledCommands', FEATURE_OVERRIDES_KEY]);

/** Context from the Console RPC composition; `authorize` is the RBAC (ADR 0049) hook. */
export function createFeatureRpcContext(
  composition: Pick<ConsoleRpcComposition, 'configuration' | 'snapshots' | 'projectRoot' | 'onRestart' | 'hub'>,
  authScope: string,
  authorize?: FeatureRpcAuthorizer,
): FeatureRpcContext {
  return Object.freeze({
    authScope,
    configuration: composition.configuration,
    ...(composition.snapshots ? { snapshots: composition.snapshots } : {}),
    setGlobalEnabled: (instanceKey: string, enabled: boolean) => setProjectPluginEnabled(composition.projectRoot, instanceKey, enabled),
    ...(composition.onRestart ? { requestRestart: composition.onRestart } : {}),
    publishEvent: (type: string, data: unknown) => composition.hub.publish(type, data),
    ...(authorize ? { authorize } : {}),
  });
}

/** Dispatches `feature.*`; null means the type belongs elsewhere. */
export async function dispatchFeatureConsoleRpc(message: Record_, context: FeatureRpcContext): Promise<FeatureRpcReply | null> {
  const type = typeof message.type === 'string' ? message.type : '';
  if (!Object.hasOwn(FEATURE_RPC_TYPES, type)) return null;
  const rpc = type as ConsoleFeatureRpcType;
  const requestId = message.requestId;
  const input = record(message.data) ? message.data : message;
  try {
    const data = await handle(rpc, input, context);
    return { status: 200, body: { success: true, data, type: rpc, requestId } };
  } catch (error) {
    const status = error instanceof FeatureRpcError ? error.status : 500;
    const text = error instanceof FeatureRpcError ? error.message : '功能配置操作失败';
    return { status, body: { success: false, error: text, type: rpc, requestId } };
  }
}

async function authorize(context: FeatureRpcContext, request: Omit<FeatureRpcAuthorization, 'permission'>): Promise<void> {
  const full: FeatureRpcAuthorization = { ...request, permission: FEATURE_RPC_TYPES[request.type] };
  let allowed: boolean;
  try {
    allowed = context.authorize ? await context.authorize(full) === true : context.authScope === 'full';
  } catch {
    allowed = false;
  }
  if (!allowed) throw new FeatureRpcError(403, `没有 ${full.permission} 权限`);
}

function requireString(input: Record_, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value) invalid(`缺少 ${key}`);
  return value as string;
}

function readTarget(input: Record_, overrideOnly: boolean): { plugin: string; level: ConsoleFeatureLevel; key?: string } {
  const plugin = requireString(input, 'plugin');
  if (!INSTANCE_PATH.test(plugin)) invalid('plugin 必须是插件实例别名');
  const level = input.level;
  if (level !== 'global' && level !== 'adapter' && level !== 'endpoint') invalid('level 只能是 global、adapter 或 endpoint');
  if (overrideOnly && level === 'global') invalid('全局层请直接编辑插件配置');
  if (level === 'global') {
    if (input.key !== undefined) invalid('global 层不需要 key');
    return { plugin, level };
  }
  const key = requireString(input, 'key');
  if (!(level === 'adapter' ? ADAPTER_KEY : ENDPOINT_KEY).test(key)) {
    invalid(level === 'adapter' ? 'key 必须是适配器实例别名' : 'key 必须是 <适配器别名>/<账号 id>');
  }
  return { plugin, level: level as ConsoleFeatureLevel, key };
}

interface State {
  readonly revision: string;
  readonly document: RuntimeConfigDocument;
  readonly snapshot?: RuntimeSnapshot;
}

async function readState(context: FeatureRpcContext, run: (state: State) => unknown): Promise<unknown> {
  if (!context.configuration.readProject) throw new FeatureRpcError(503, '配置读取不可用');
  const read = await context.configuration.readProject({ reveal: true });
  const document = (read.exists && record(read.value) ? read.value : {}) as RuntimeConfigDocument;
  const lease = context.snapshots?.acquire();
  try { return await run({ revision: read.revision, document, ...(lease ? { snapshot: lease.value } : {}) }); }
  finally { lease?.release(); }
}

function declaredInstances(document: RuntimeConfigDocument): readonly string[] {
  return record(document.plugins) ? Object.keys(document.plugins) : [];
}

function blockOf(document: RuntimeConfigDocument, plugin: string): Record_ | undefined {
  let value: unknown = document;
  for (const segment of plugin.split('/')) {
    if (!record(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return record(value) ? value : undefined;
}

function requireDeclared(document: RuntimeConfigDocument, plugin: string): void {
  if (!declaredInstances(document).includes(plugin.split('/')[0]!)) throw new FeatureRpcError(404, `未声明的插件实例：${plugin}`);
}

function nodeOf(snapshot: RuntimeSnapshot | undefined, plugin: string) {
  return snapshot?.tree.get(`root/${plugin}` as PluginId);
}

function ownSchema(snapshot: RuntimeSnapshot | undefined, plugin: string): JsonSchema | undefined {
  return nodeOf(snapshot, plugin)?.configSchema as JsonSchema | undefined;
}

function businessFields(schema: JsonSchema | undefined): readonly string[] {
  const properties = schema && record(schema.properties) ? Object.keys(schema.properties) : [];
  return properties.filter(field => !RESERVED_FIELDS.has(field));
}

function globallyEnabled(document: RuntimeConfigDocument, plugin: string): boolean {
  const disabled = Array.isArray(document.disable_plugins) ? document.disable_plugins : [];
  return !disabled.includes(plugin.split('/')[0]!);
}

/** Top-level instance aliases that provide adapter Endpoints in the current generation. */
function adapterAliases(snapshot: RuntimeSnapshot | undefined): readonly string[] {
  if (!snapshot) return [];
  const owners = new Set([...snapshot.capabilities.values()].filter(slot => String(slot.feature) === 'zhin.adapter').map(slot => slot.owner));
  return [...owners].flatMap(owner => {
    const node = snapshot.tree.get(owner);
    return node && node.parent === snapshot.root ? [node.instanceKey] : [];
  }).sort();
}

function displayName(snapshot: RuntimeSnapshot | undefined, plugin: string): string {
  return nodeOf(snapshot, plugin)?.metadata?.displayName ?? plugin;
}

function listFeatures(state: State): ConsoleFeatureListResult {
  const adapters = new Set(adapterAliases(state.snapshot));
  const features: ConsoleFeatureSummary[] = [];
  const visit = (plugin: string): void => {
    const schema = ownSchema(state.snapshot, plugin);
    let levels: readonly ConsoleFeatureLevel[];
    try { levels = readFeatureLevels(schema); } catch { levels = ['global']; }
    features.push(Object.freeze({
      plugin, displayName: displayName(state.snapshot, plugin), levels,
      hasSchema: businessFields(schema).length > 0, globalEnabled: globallyEnabled(state.document, plugin),
      ...(adapters.has(plugin) ? { adapter: true } : {}),
    }));
    for (const child of nodeOf(state.snapshot, plugin)?.children ?? []) {
      const childNode = state.snapshot?.tree.get(child);
      if (childNode) visit(`${plugin}/${childNode.instanceKey}`);
    }
  };
  for (const plugin of declaredInstances(state.document)) visit(plugin);
  return Object.freeze({ revision: state.revision, features: Object.freeze(features) });
}

function endpointColumns(state: State, alias: string): readonly string[] {
  const ids = new Set<string>();
  const endpoints = blockOf(state.document, alias)?.endpoints;
  if (Array.isArray(endpoints)) for (const item of endpoints) if (record(item) && typeof item.id === 'string') ids.add(item.id);
  for (const plugin of declaredInstances(state.document)) {
    for (const key of Object.keys(readFeatureOverrides(blockOf(state.document, plugin)?.[FEATURE_OVERRIDES_KEY]).endpoints ?? {})) {
      if (key.startsWith(`${alias}/`)) ids.add(key.slice(alias.length + 1));
    }
  }
  return [...ids].sort();
}

function matrix(state: State): ConsoleFeatureMatrixResult {
  const aliases = adapterAliases(state.snapshot);
  const rows: ConsoleFeatureMatrixRow[] = listFeatures(state).features.map(feature => {
    const overrides = readFeatureOverrides(blockOf(state.document, feature.plugin)?.[FEATURE_OVERRIDES_KEY]);
    const adapters: Record<string, ConsoleFeatureMatrixCell> = {};
    for (const alias of aliases) {
      const resolved = resolveFeatureEnabled({ overrides, globalEnabled: feature.globalEnabled, key: alias });
      const entry = overrides.adapters?.[alias];
      adapters[alias] = Object.freeze({ enabled: resolved.enabled, ...(resolved.lockedBy ? { lockedBy: resolved.lockedBy } : {}),
        overridden: !!entry && Object.keys(entry).length > 0 });
    }
    return Object.freeze({ plugin: feature.plugin, displayName: feature.displayName,
      global: Object.freeze({ enabled: feature.globalEnabled, overridden: false }), adapters: Object.freeze(adapters) });
  });
  return Object.freeze({
    revision: state.revision,
    adapters: Object.freeze([...aliases]),
    endpoints: Object.freeze(Object.fromEntries(aliases.map(alias => [alias, endpointColumns(state, alias)]))),
    rows: Object.freeze(rows),
  });
}

/** Schema for the level's editable fields; `$defs` stay so local references resolve. */
function levelSchema(schema: JsonSchema | undefined, level: ConsoleFeatureLevel): Record_ | null {
  if (!schema) return null;
  const properties = record(schema.properties) ? schema.properties : {};
  const fields = level === 'global' ? businessFields(schema) : overridableFields(schema, level);
  const { $id: _id, required, ...rest } = schema;
  return {
    ...rest,
    properties: Object.fromEntries(fields.map(field => [field, properties[field]])),
    ...(level === 'global' && Array.isArray(required) ? { required: required.filter(field => fields.includes(String(field))) } : {}),
  };
}

function maskSchema(schema: JsonSchema | undefined): JsonSchema | null {
  if (!schema) return null;
  const properties = record(schema.properties) ? schema.properties : {};
  const { [FEATURE_OVERRIDES_KEY]: _ignored, ...fields } = properties;
  return { ...schema, properties: fields };
}

function mask(schema: JsonSchema | undefined, plugin: string, value: Record_): Record_ {
  return maskConfigValue(maskSchema(schema), [plugin.split('/')[0]!], value, { unknownSchema: 'redact' }) as Record_;
}

function getFeature(state: State, input: Record_): ConsoleFeatureGetResult {
  const { plugin, level, key } = readTarget(input, false);
  requireDeclared(state.document, plugin);
  const schema = ownSchema(state.snapshot, plugin);
  const block = blockOf(state.document, plugin) ?? {};
  const overrides = readFeatureOverrides(block[FEATURE_OVERRIDES_KEY]);
  const global = Object.fromEntries(Object.entries(block).filter(([field]) => !RESERVED_FIELDS.has(field)));
  const stored = level === 'global' ? global
    : (level === 'adapter' ? overrides.adapters?.[key!] : overrides.endpoints?.[key!]) ?? {};
  // The reserved switch is reported as `enabled`; a Plugin's own `enabled` field stays a global value.
  const values = level === 'global' ? stored
    : Object.fromEntries(Object.entries(stored).filter(([field]) => field !== FEATURE_ENABLED_KEY));
  const resolved = resolveLayeredConfig({ global, overrides, globalEnabled: globallyEnabled(state.document, plugin), key: key ?? '' });
  let levels: readonly ConsoleFeatureLevel[];
  try { levels = readFeatureLevels(schema); } catch { levels = ['global']; }
  return Object.freeze({
    revision: state.revision, plugin, level, ...(key ? { key } : {}), levels,
    schema: levelSchema(schema, level),
    values: mask(schema, plugin, values),
    effective: mask(schema, plugin, resolved.value as Record_),
    sources: resolved.sources,
    enabled: resolved.enabled,
    ...(resolved.lockedBy ? { lockedBy: resolved.lockedBy } : {}),
  });
}

function nextOverrides(
  current: unknown,
  level: 'adapter' | 'endpoint',
  key: string,
  edit: (entry: Record_) => Record_,
): Record_ | undefined {
  const overrides = record(current) ? structuredClone(current) : {};
  const group = `${level}s`;
  const entries = record(overrides[group]) ? overrides[group] as Record_ : {};
  const entry = edit(record(entries[key]) ? structuredClone(entries[key] as Record_) : {});
  if (Object.keys(entry).length) entries[key] = entry; else delete entries[key];
  if (Object.keys(entries).length) overrides[group] = entries; else delete overrides[group];
  return Object.keys(overrides).length ? overrides : undefined;
}

function warningsFor(document: RuntimeConfigDocument, plugin: string, overrides: unknown): readonly ConsoleFeatureWarning[] {
  if (overrides === undefined) return Object.freeze([]);
  return Object.freeze(collectFeatureOverrideWarnings(document, plugin, overrides, globallyEnabled(document, plugin))
    .map(({ code, path, message }) => Object.freeze({ code, path, message })));
}

async function writeOverrides(
  context: FeatureRpcContext,
  state: State,
  input: Record_,
  plugin: string,
  overrides: Record_ | undefined,
): Promise<ConsoleFeatureWriteResult> {
  const expectedRevision = input.expectedRevision === undefined ? state.revision : input.expectedRevision;
  if (typeof expectedRevision !== 'string') invalid('expectedRevision 必须是字符串');
  const block = blockOf(state.document, plugin) ?? {};
  const before = block[FEATURE_OVERRIDES_KEY];
  const warnings = warningsFor(state.document, plugin, overrides);
  if (isDeepStrictEqual(before, overrides)) {
    return Object.freeze({ status: 'unchanged', revision: state.revision, warnings });
  }
  if (expectedRevision !== state.revision) {
    return Object.freeze({ status: 'conflict', revision: state.revision, message: '配置已被其他地方修改，未保存。请刷新后重试。' });
  }
  const schema = ownSchema(state.snapshot, plugin);
  if (schema && overrides !== undefined) {
    const issues = validateFeatureOverrides(schema, { ...block, [FEATURE_OVERRIDES_KEY]: overrides });
    if (issues.length) {
      return Object.freeze({ status: 'invalid', revision: state.revision, message: '覆盖配置校验失败，未保存',
        errors: Object.freeze(issues.map(issue => Object.freeze({ path: issue.path, message: issue.message }))) });
    }
  }
  const segments = plugin.split('/');
  const path = [...segments, FEATURE_OVERRIDES_KEY];
  const result = await context.configuration.patch({
    instanceKey: segments[0]!,
    expectedRevision,
    patches: [overrides === undefined ? { op: 'remove', path } : { op: 'set', path, value: overrides }],
  });
  if (result.status === 'conflict') return Object.freeze({ status: 'conflict', revision: result.revision, message: result.message });
  if (result.status === 'invalid') {
    return Object.freeze({ status: 'invalid', revision: result.revision, message: result.message,
      errors: Object.freeze(result.errors.map(error => Object.freeze({ path: error.path, message: error.message }))) });
  }
  context.publishEvent?.('feature:updated', { plugin });
  return Object.freeze({ status: 'saved', revision: result.revision, restartRequired: result.restartRequired, warnings, message: result.message });
}

function readPatch(input: Record_): Record_ {
  const patch = input.patch;
  if (!record(patch) || Object.keys(patch).length === 0) invalid('patch 必须是非空对象');
  for (const field of Object.keys(patch as Record_)) {
    if (FORBIDDEN_SEGMENTS.has(field)) invalid('patch 含有无效字段');
    if (field === FEATURE_ENABLED_KEY) invalid('启用 / 停用请用 feature.set-enabled');
  }
  return patch as Record_;
}

function readPaths(input: Record_): readonly (readonly string[])[] | undefined {
  if (input.paths === undefined) return undefined;
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > 64) invalid('paths 必须是非空数组');
  return (input.paths as unknown[]).map(path => {
    if (!Array.isArray(path) || path.length === 0 || path.length > 16
      || path.some(segment => typeof segment !== 'string' || !segment || FORBIDDEN_SEGMENTS.has(segment))) invalid('paths 含有无效路径');
    return path as string[];
  });
}

function removePath(entry: Record_, path: readonly string[]): void {
  const parents: Record_[] = [entry];
  let cursor: Record_ = entry;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!record(next)) return;
    parents.push(next);
    cursor = next;
  }
  delete cursor[path.at(-1)!];
  // Drop containers emptied by the removal so the entry falls back to inheritance.
  for (let index = parents.length - 1; index > 0; index -= 1) {
    if (Object.keys(parents[index]!).length) break;
    delete parents[index - 1]![path[index - 1]!];
  }
}

async function handle(type: ConsoleFeatureRpcType, input: Record_, context: FeatureRpcContext): Promise<unknown> {
  switch (type) {
    case 'feature.list':
      await authorize(context, { type });
      return readState(context, state => listFeatures(state));
    case 'feature.matrix':
      await authorize(context, { type });
      return readState(context, state => matrix(state));
    case 'feature.get': {
      const target = readTarget(input, false);
      await authorize(context, { type, ...target });
      return readState(context, state => getFeature(state, input));
    }
    case 'feature.set-override': {
      const target = readTarget(input, true);
      await authorize(context, { type, ...target });
      const patch = readPatch(input);
      return readState(context, state => {
        requireDeclared(state.document, target.plugin);
        const overrides = nextOverrides(blockOf(state.document, target.plugin)?.[FEATURE_OVERRIDES_KEY],
          target.level as 'adapter' | 'endpoint', target.key!, entry => {
            for (const [field, value] of Object.entries(patch)) {
              if (value === undefined) delete entry[field]; else entry[field] = structuredClone(value);
            }
            return entry;
          });
        return writeOverrides(context, state, input, target.plugin, overrides);
      });
    }
    case 'feature.remove-override': {
      const target = readTarget(input, true);
      await authorize(context, { type, ...target });
      const paths = readPaths(input);
      return readState(context, state => {
        requireDeclared(state.document, target.plugin);
        const overrides = nextOverrides(blockOf(state.document, target.plugin)?.[FEATURE_OVERRIDES_KEY],
          target.level as 'adapter' | 'endpoint', target.key!, entry => {
            if (!paths) return {};
            for (const path of paths) removePath(entry, path);
            return entry;
          });
        return writeOverrides(context, state, input, target.plugin, overrides);
      });
    }
    case 'feature.set-enabled': {
      const target = readTarget(input, false);
      if (typeof input.enabled !== 'boolean') invalid('enabled 必须是布尔值');
      const enabled = input.enabled as boolean;
      await authorize(context, { type, ...target });
      if (target.level === 'global') {
        if (target.plugin.includes('/')) invalid('全局开关只适用于顶层插件实例');
        return readState(context, async state => {
          requireDeclared(state.document, target.plugin);
          if (globallyEnabled(state.document, target.plugin) === enabled) {
            return Object.freeze({ status: 'unchanged', revision: state.revision, warnings: Object.freeze([]) });
          }
          if (!context.setGlobalEnabled) throw new FeatureRpcError(503, '插件启停管理不可用');
          await context.setGlobalEnabled(target.plugin, enabled);
          context.publishEvent?.('plugin:lifecycle-updated', { instanceKey: target.plugin, enabled });
          if (context.requestRestart) setTimeout(() => { try { context.requestRestart?.(); } catch { /* restart is best effort */ } }, 500);
          const block = blockOf(state.document, target.plugin);
          const after = { ...state.document, disable_plugins: enabled
            ? (Array.isArray(state.document.disable_plugins) ? state.document.disable_plugins : []).filter(alias => alias !== target.plugin)
            : [...(Array.isArray(state.document.disable_plugins) ? state.document.disable_plugins : []), target.plugin] } as RuntimeConfigDocument;
          return Object.freeze({ status: 'saved', revision: state.revision, restartRequired: true,
            warnings: warningsFor(after, target.plugin, block?.[FEATURE_OVERRIDES_KEY]),
            message: `${target.plugin} 已${enabled ? '启用' : '停用'}，Host 正在重启` });
        });
      }
      return readState(context, state => {
        requireDeclared(state.document, target.plugin);
        const overrides = nextOverrides(blockOf(state.document, target.plugin)?.[FEATURE_OVERRIDES_KEY],
          target.level as 'adapter' | 'endpoint', target.key!, entry => {
            // `true` is the inherited default, so the key is removed instead of stored.
            if (enabled) delete entry[FEATURE_ENABLED_KEY]; else entry[FEATURE_ENABLED_KEY] = false;
            return entry;
          });
        return writeOverrides(context, state, input, target.plugin, overrides);
      });
    }
  }
}
