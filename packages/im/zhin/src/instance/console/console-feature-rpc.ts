/**
 * ADR 0050 §8 / ADR 0055 §6: `feature.*` Console RPC over the layered feature configuration.
 *
 * File levels write through ConsoleConfigurationStore.patch (revision CAS, atomic write,
 * whole-document validation, configuration application), so override-only edits apply in
 * place. The global switch keeps the `disable_plugins` + restart path of `plugin:set-enabled`.
 * The conversation level writes the instance's database store (in place as well).
 *
 * Enable rule (ADR 0050 §4): a level may only change its switch while every level above it is
 * enabled; below a disabled level every switch is locked (409 `locked`). "Enabled" is never
 * stored below global: enabling removes the level's switch.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  FEATURE_RPC_PERMISSIONS,
  type ConsoleConfigPatchRequest, type ConsoleConfigPatchResult, type ConsoleFeatureConversationSummary,
  type ConsoleFeatureConversationsResult, type ConsoleFeatureGetResult, type ConsoleFeatureLevel, type ConsoleFeatureListResult,
  type ConsoleFeatureLock, type ConsoleFeatureMatrixCell, type ConsoleFeatureMatrixResult, type ConsoleFeatureMatrixRow,
  type ConsoleFeaturePermission, type ConsoleFeatureRpcType, type ConsoleFeatureSummary, type ConsoleFeatureWarning,
  type ConsoleFeatureWriteResult,
} from '@zhin.js/console-protocol';
import {
  FEATURE_ENABLED_KEY, FEATURE_OVERRIDES_KEY, featureConversationEntry, parseFeatureConversationKey, readFeatureOverrides,
  resolveFeatureEnabled, resolveLayeredConfig,
  type FeatureConfigLevel, type PluginId, type RuntimeConfigDocument, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import {
  collectFeatureOverrideWarnings, overridableFields, readFeatureConversationDeclaration, readFeatureLevels, setProjectPluginEnabled, validateConversationOverride,
  validateFeatureOverrides, type JsonSchema,
} from '@zhin.js/runtime';
import { maskConfigValue } from '@zhin.js/gateway/config';
import type { ConsoleRpcComposition } from './rpc-composition.js';
import type { FeatureConversationOverrideStore } from './feature-conversation-store.js';
import { FeatureConversationConflictError } from './feature-conversation-store.js';

const FEATURE_RPC_TYPES: Readonly<Record<ConsoleFeatureRpcType, ConsoleFeaturePermission>> = FEATURE_RPC_PERMISSIONS;

/** Process-owned stores behind the conversation level (ADR 0055); chat roles are ADR 0056's. */
export interface FeatureStores {
  readonly conversations: FeatureConversationOverrideStore;
  /** Chat roles (ADR 0056), served by `chat-roles.*`. */
  readonly roles?: import('../chat-roles.js').InstanceChatRoleService;
  /** Known recent conversations (keys), newest first; best effort. */
  readonly recentConversations?: (limit: number) => Promise<readonly FeatureRecentConversation[]>;
}

function conversationDeclaration(schema: JsonSchema | undefined): { conversationFields: readonly string[]; selfServiceFields: readonly string[] } {
  try {
    const { conversationFields, selfServiceFields } = readFeatureConversationDeclaration(schema);
    return { conversationFields, selfServiceFields };
  } catch {
    return { conversationFields: Object.freeze([]), selfServiceFields: Object.freeze([]) };
  }
}

export interface FeatureRecentConversation {
  readonly key: string;
  readonly name?: string;
  readonly lastActiveAt?: number;
}

/** What the RBAC layer (ADR 0049) checks; `level` / `key` are present for per-feature requests. */
export interface FeatureRpcAuthorization {
  readonly type: ConsoleFeatureRpcType;
  readonly permission: ConsoleFeaturePermission;
  readonly plugin?: string;
  readonly level?: ConsoleFeatureLevel;
  readonly key?: string;
}
/** Return false (or throw) to deny. Without it every call is denied (deny by default). */
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
  /** Conversation level and admins; without them those calls answer 503. */
  readonly stores?: FeatureStores;
  /** Recorded as `updated_by` (e.g. `user:<id>` or `chat:<alias>:<userId>`). */
  readonly actor?: string;
  /**
   * Narrows the fields a caller may write at `level` (in-chat: `selfServiceFields`, or the
   * Plugin's `chatAdminFields` above the conversation level). Undefined: no extra limit.
   */
  readonly allowedFields?: (schema: JsonSchema | undefined, level: ConsoleFeatureLevel) => readonly string[] | undefined;
  /**
   * Whether this caller may write values containing environment references (`${…}` /
   * `env://…`). File overrides are environment-expanded at run time, so such a value would let
   * `feature.configure` read secrets back through `feature.get` / runtime echoes. Absent: never
   * (chat self-service); the Console grants it to principals that may edit `.env` themselves.
   */
  readonly mayReferenceEnvironment?: () => boolean;
}

/** True when `value` (keys included) contains a `${…}` or `env://` reference anywhere. */
export function containsEnvironmentReference(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (typeof value === 'string') return value.includes('${') || /env:\/\//iu.test(value);
  if (Array.isArray(value)) return value.some(item => containsEnvironmentReference(item, depth + 1));
  if (record(value)) {
    return Object.entries(value).some(([key, item]) => containsEnvironmentReference(key, depth + 1) || containsEnvironmentReference(item, depth + 1));
  }
  return false;
}

/** Refuses (400 `environment-reference`) a write that would plant an environment reference. */
export function assertNoEnvironmentReference(context: Pick<FeatureRpcContext, 'mayReferenceEnvironment'>, value: unknown): void {
  if (!containsEnvironmentReference(value)) return;
  let allowed: boolean;
  try { allowed = context.mayReferenceEnvironment?.() === true; } catch { allowed = false; }
  if (!allowed) {
    throw new FeatureRpcError(400, '值不能包含环境变量引用（${…} / env://）', { code: 'environment-reference' });
  }
}

export interface FeatureRpcReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export class FeatureRpcError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Readonly<Record<string, unknown>> = {}) {
    super(message); this.name = 'FeatureRpcError';
  }
}

const LOCK_LABEL: Readonly<Record<ConsoleFeatureLock, string>> = { global: '全局', adapter: '适配器', endpoint: '账号' };
const locked = (lockedBy: ConsoleFeatureLock): never => {
  throw new FeatureRpcError(409, `已被${LOCK_LABEL[lockedBy]}层停用，下级开关已锁定`, { code: 'locked', lockedBy });
};
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
  composition: Pick<ConsoleRpcComposition, 'configuration' | 'snapshots' | 'projectRoot' | 'onRestart' | 'hub' | 'featureStores'>,
  authScope: string,
  authorize?: FeatureRpcAuthorizer,
  actor?: string,
  mayReferenceEnvironment?: () => boolean,
): FeatureRpcContext {
  return Object.freeze({
    authScope,
    ...(mayReferenceEnvironment ? { mayReferenceEnvironment } : {}),
    ...(composition.featureStores ? { stores: composition.featureStores } : {}),
    ...(actor ? { actor } : {}),
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
    const status = error instanceof FeatureRpcError ? error.status : error instanceof FeatureConversationConflictError ? 409 : 500;
    const text = error instanceof FeatureRpcError ? error.message
      : error instanceof FeatureConversationConflictError ? '会话覆盖已被其他地方修改，请刷新后重试' : '功能配置操作失败';
    const extra = error instanceof FeatureRpcError ? error.extra
      : error instanceof FeatureConversationConflictError ? { code: 'conflict' } : {};
    return { status, body: { success: false, ...extra, error: text, type: rpc, requestId } };
  }
}

async function authorize(context: FeatureRpcContext, request: Omit<FeatureRpcAuthorization, 'permission'>): Promise<void> {
  const full: FeatureRpcAuthorization = { ...request, permission: FEATURE_RPC_TYPES[request.type] };
  let allowed: boolean;
  try {
    // Deny by default: the ADR 0049 permission hook is the only authority (scopes were removed).
    allowed = context.authorize ? await context.authorize(full) === true : false;
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
  const { level, key } = readScope(input);
  if (overrideOnly && level === 'global') invalid('全局层请直接编辑插件配置');
  return { plugin, level, ...(key !== undefined ? { key } : {}) };
}

/** `level` + `key` of a scope (shared with `chat-roles.*`); throws a 400 FeatureRpcError. */
export function readScope(input: Record_): { level: ConsoleFeatureLevel; key?: string } {
  const level = input.level;
  if (level !== 'global' && level !== 'adapter' && level !== 'endpoint' && level !== 'conversation') {
    invalid('level 只能是 global、adapter、endpoint 或 conversation');
  }
  if (level === 'global') {
    if (input.key !== undefined && input.key !== '') invalid('global 层不需要 key');
    return { level };
  }
  const key = requireString(input, 'key');
  if (level === 'conversation') {
    // Each part is validated by the parser (alias, endpoint id ≤ 128, conversation id 1–256 before
    // escaping); the length guard only bounds the parse work, above any key the Runtime can form.
    if (key.length > 4096 || !parseFeatureConversationKey(key)) invalid('key 必须是 <适配器别名>/<账号 id>/<group|private|channel>:<会话 id>（会话 id 中的 % 与 / 转义为 %25 / %2F）');
    return { level, key };
  }
  if (!(level === 'adapter' ? ADAPTER_KEY : ENDPOINT_KEY).test(key)) {
    invalid(level === 'adapter' ? 'key 必须是适配器实例别名' : 'key 必须是 <适配器别名>/<账号 id>');
  }
  return { level: level as ConsoleFeatureLevel, key };
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
      ...conversationDeclaration(schema),
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

function matrix(state: State, context: FeatureRpcContext): ConsoleFeatureMatrixResult {
  const perPlugin = new Map<string, Record<string, Record<string, number>>>();
  const conversations = new Map<string, Set<string>>();
  for (const row of context.stores?.conversations.list() ?? []) {
    const ref = parseFeatureConversationKey(row.key);
    if (!ref) continue;
    const counts = perPlugin.get(row.plugin) ?? {};
    const byEndpoint = counts[ref.adapter] ??= {};
    byEndpoint[ref.endpointId] = (byEndpoint[ref.endpointId] ?? 0) + 1;
    perPlugin.set(row.plugin, counts);
    const endpointKey = `${ref.adapter}\0${ref.endpointId}`;
    const keys = conversations.get(endpointKey) ?? new Set<string>();
    keys.add(row.key);
    conversations.set(endpointKey, keys);
  }
  const totals: Record<string, Record<string, number>> = {};
  for (const [endpointKey, keys] of conversations) {
    const [alias, endpointId] = endpointKey.split('\0') as [string, string];
    (totals[alias] ??= {})[endpointId] = keys.size;
  }
  const aliases = adapterAliases(state.snapshot);
  const rows: ConsoleFeatureMatrixRow[] = listFeatures(state).features.map(feature => {
    const overrides = readFeatureOverrides(blockOf(state.document, feature.plugin)?.[FEATURE_OVERRIDES_KEY]);
    const adapters: Record<string, ConsoleFeatureMatrixCell> = {};
    for (const alias of aliases) {
      const resolved = enabledAt(state, context, feature.plugin, 'adapter', alias);
      const entry = overrides.adapters?.[alias];
      adapters[alias] = Object.freeze({ enabled: resolved.enabled, ...(resolved.lockedBy ? { lockedBy: resolved.lockedBy } : {}),
        overridden: !!entry && Object.keys(entry).length > 0 });
    }
    const counts = perPlugin.get(feature.plugin);
    return Object.freeze({ plugin: feature.plugin, displayName: feature.displayName, ...(counts ? { conversationOverrides: counts } : {}),
      global: Object.freeze({ enabled: feature.globalEnabled, overridden: false }), adapters: Object.freeze(adapters) });
  });
  return Object.freeze({
    revision: state.revision,
    adapters: Object.freeze([...aliases]),
    endpoints: Object.freeze(Object.fromEntries(aliases.map(alias => [alias, endpointColumns(state, alias)]))),
    rows: Object.freeze(rows),
    ...(context.stores ? { conversationOverrides: totals } : {}),
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

function stores(context: FeatureRpcContext): FeatureStores {
  if (!context.stores) throw new FeatureRpcError(503, '会话级功能配置不可用');
  return context.stores;
}

function conversationOverride(context: FeatureRpcContext, plugin: string, key: string | undefined) {
  return key !== undefined && context.stores ? context.stores.conversations.get(plugin, key) : undefined;
}

/** Enabled state of `plugin` alone at `level`/`key`, including the stored conversation switch. */
function ownEnabledAt(state: State, context: FeatureRpcContext, plugin: string, level: ConsoleFeatureLevel, key: string | undefined) {
  const overrides = readFeatureOverrides(blockOf(state.document, plugin)?.[FEATURE_OVERRIDES_KEY]);
  const conversation = level === 'conversation' ? featureConversationEntry(conversationOverride(context, plugin, key)) : undefined;
  return resolveFeatureEnabled({ overrides, globalEnabled: globallyEnabled(state.document, plugin), key: key ?? '', level,
    ...(conversation ? { conversation } : {}) });
}

/**
 * Enabled state at `level`/`key` along the ancestor chain (the Runtime hides a nested Plugin
 * wherever an ancestor is off): an ancestor switched off above `level` locks this level too.
 */
function enabledAt(state: State, context: FeatureRpcContext, plugin: string, level: ConsoleFeatureLevel, key: string | undefined) {
  const own = ownEnabledAt(state, context, plugin, level, key);
  if (own.lockedBy) return own;
  const segments = plugin.split('/');
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const ancestor = ownEnabledAt(state, context, segments.slice(0, depth).join('/'), level, key);
    if (ancestor.lockedBy) return Object.freeze({ ...own, enabled: false, disabledAt: ancestor.disabledAt, lockedBy: ancestor.lockedBy });
    if (!ancestor.enabled && own.enabled) return Object.freeze({ ...own, enabled: false, disabledAt: ancestor.disabledAt });
  }
  return own;
}

/** Refuses (409 `locked`) any change of a level's switch while an upper level is disabled. */
function assertUnlocked(state: State, context: FeatureRpcContext, plugin: string, level: ConsoleFeatureLevel, key: string | undefined): void {
  if (level === 'global') return;
  const resolved = enabledAt(state, context, plugin, level, key);
  if (resolved.lockedBy) locked(resolved.lockedBy);
}

function getFeature(state: State, input: Record_, context: FeatureRpcContext): ConsoleFeatureGetResult {
  const { plugin, level, key } = readTarget(input, false);
  requireDeclared(state.document, plugin);
  const schema = ownSchema(state.snapshot, plugin);
  const block = blockOf(state.document, plugin) ?? {};
  const overrides = readFeatureOverrides(block[FEATURE_OVERRIDES_KEY]);
  const global = Object.fromEntries(Object.entries(block).filter(([field]) => !RESERVED_FIELDS.has(field)));
  const row = level === 'conversation' ? stores(context).conversations.get(plugin, key!) : undefined;
  const stored = level === 'global' ? global
    : level === 'conversation' ? row?.patch ?? {}
      : (level === 'adapter' ? overrides.adapters?.[key!] : overrides.endpoints?.[key!]) ?? {};
  // The reserved switch is reported as `enabled`; a Plugin's own `enabled` field stays a global value.
  const values = level === 'global' ? stored
    : Object.fromEntries(Object.entries(stored).filter(([field]) => field !== FEATURE_ENABLED_KEY));
  const conversation = featureConversationEntry(row);
  const resolved = resolveLayeredConfig({ global, overrides, globalEnabled: globallyEnabled(state.document, plugin), key: key ?? '',
    ...(conversation ? { conversation } : {}) });
  let levels: readonly ConsoleFeatureLevel[];
  try { levels = readFeatureLevels(schema); } catch { levels = ['global']; }
  const ref = level === 'conversation' ? parseFeatureConversationKey(key!) : undefined;
  const chain = enabledAt(state, context, plugin, level, key);
  const lockedBy = resolved.lockedBy ?? chain.lockedBy;
  return Object.freeze({
    revision: level === 'conversation' ? String(stores(context).conversations.revisionOf(plugin, key!)) : state.revision,
    plugin, level, ...(key ? { key } : {}), levels,
    ...conversationDeclaration(schema),
    schema: levelSchema(schema, level),
    values: mask(schema, plugin, values),
    effective: mask(schema, plugin, resolved.value as Record_),
    sources: resolved.sources,
    enabled: resolved.enabled && chain.enabled,
    ...(lockedBy ? { lockedBy } : {}),
    ...(ref ? { conversation: Object.freeze({ adapter: ref.adapter, endpointId: ref.endpointId, kind: ref.conversation.kind, id: ref.conversation.id }) } : {}),
    ...(row ? { updatedAt: row.updatedAt, ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}) } : {}),
    ...(context.stores ? { persistent: context.stores.conversations.persistent } : {}),
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

function assertAllowedFields(context: FeatureRpcContext, schema: JsonSchema | undefined, level: ConsoleFeatureLevel, fields: Iterable<string>): void {
  const allowed = context.allowedFields?.(schema, level);
  if (!allowed) return;
  for (const field of fields) if (!allowed.includes(field)) throw new FeatureRpcError(403, `字段 ${field} 不允许在此修改`, { code: 'field-not-allowed', field });
}

function conversationExpectedRevision(input: Record_): number | undefined {
  if (input.expectedRevision === undefined) return undefined;
  const value = typeof input.expectedRevision === 'string' && /^\d{1,15}$/u.test(input.expectedRevision) ? Number(input.expectedRevision) : NaN;
  if (!Number.isSafeInteger(value)) invalid('expectedRevision 必须是会话覆盖的修订号');
  return value;
}

/** Writes one conversation override; `edit` receives a copy of the stored entry `{ enabled?, ...patch }`. */
async function writeConversation(
  context: FeatureRpcContext,
  state: State,
  input: Record_,
  plugin: string,
  key: string,
  edit: (entry: Record_) => Record_,
): Promise<ConsoleFeatureWriteResult> {
  const store = stores(context).conversations;
  const expectedRevision = conversationExpectedRevision(input);
  const schema = ownSchema(state.snapshot, plugin);
  const block = blockOf(state.document, plugin) ?? {};
  let issues: readonly { path: string; message: string }[] = [];
  const result = await store.write({
    plugin, key, ...(expectedRevision !== undefined ? { expectedRevision } : {}), ...(context.actor ? { updatedBy: context.actor } : {}),
    next: current => {
      const entry = edit(structuredClone(featureConversationEntry(current) ?? {}) as Record_);
      const { [FEATURE_ENABLED_KEY]: enabled, ...patch } = entry;
      if (Object.keys(patch).length) {
        issues = schema ? validateConversationOverride(schema, block, key, entry)
          : [{ path: '', message: '没有配置 Schema 的插件在会话层只能开关' }];
        if (issues.length) return current ? { ...(current.enabled === false ? { enabled: false } : {}), patch: current.patch } : null;
      }
      return enabled === false || Object.keys(patch).length ? { ...(enabled === false ? { enabled: false as const } : {}), patch } : null;
    },
  });
  if (issues.length) {
    return Object.freeze({ status: 'invalid', revision: String(result.revision), message: '覆盖配置校验失败，未保存',
      errors: Object.freeze(issues.map(issue => Object.freeze({ path: issue.path, message: issue.message }))) });
  }
  if (result.status === 'conflict') return Object.freeze({ status: 'conflict', revision: String(result.revision), message: '会话覆盖已被其他地方修改，未保存。请刷新后重试。' });
  if (result.status === 'unchanged') return Object.freeze({ status: 'unchanged', revision: String(result.revision), warnings: Object.freeze([]) });
  context.publishEvent?.('feature:updated', { plugin, level: 'conversation', key });
  const persistent = store.persistent;
  return Object.freeze({ status: 'saved', revision: String(result.revision), restartRequired: false, warnings: Object.freeze([]), persistent,
    message: persistent ? '会话覆盖已保存，立即生效' : `会话覆盖已保存，立即生效；${NOT_PERSISTENT}` });
}

const CURSOR = /^o:(\d{1,9})$/u;
/** Shown wherever a conversation override is written to a store that cannot persist it. */
export const NOT_PERSISTENT = '当前数据库不支持持久化，重启后丢失';

async function listConversations(state: State, input: Record_, context: FeatureRpcContext): Promise<ConsoleFeatureConversationsResult> {
  const { conversations, recentConversations } = stores(context);
  const plugin = input.plugin === undefined ? undefined : requireString(input, 'plugin');
  if (plugin !== undefined && !INSTANCE_PATH.test(plugin)) invalid('plugin 必须是插件实例别名');
  const adapter = input.adapter === undefined ? undefined : requireString(input, 'adapter');
  if (adapter !== undefined && !ADAPTER_KEY.test(adapter)) invalid('adapter 必须是适配器实例别名');
  const endpoint = input.endpoint === undefined ? undefined : requireString(input, 'endpoint');
  if (endpoint !== undefined && (adapter === undefined || !ENDPOINT_KEY.test(`${adapter}/${endpoint}`))) invalid('endpoint 需要同时给出 adapter，且是有效的账号 id');
  const query = input.query === undefined ? undefined : String(input.query).trim().toLowerCase().slice(0, 128);
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) invalid('limit 必须是 1–200 的整数');
  const cursor = input.cursor === undefined ? 0 : Number(CURSOR.exec(String(input.cursor))?.[1] ?? NaN);
  if (!Number.isSafeInteger(cursor)) invalid('cursor 无效');
  const byKey = new Map<string, { overrides: ConsoleFeatureConversationSummary['overrides'][number][]; name?: string; lastActiveAt?: number }>();
  for (const row of conversations.list()) {
    if (plugin !== undefined && row.plugin !== plugin) continue;
    const item = byKey.get(row.key) ?? { overrides: [] };
    item.overrides.push(Object.freeze({ plugin: row.plugin, ...(row.enabled === false ? { enabled: false as const } : {}), fields: Object.freeze(Object.keys(row.patch).sort()),
      revision: String(row.revision), updatedAt: row.updatedAt, ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}) }));
    item.lastActiveAt = Math.max(item.lastActiveAt ?? 0, row.updatedAt);
    byKey.set(row.key, item);
  }
  let recentAvailable = false;
  if (recentConversations && plugin === undefined) {
    try {
      for (const recent of await recentConversations(1000)) {
        recentAvailable = true;
        const item = byKey.get(recent.key) ?? { overrides: [] };
        if (recent.name && !item.name) item.name = recent.name;
        if (recent.lastActiveAt) item.lastActiveAt = Math.max(item.lastActiveAt ?? 0, recent.lastActiveAt);
        byKey.set(recent.key, item);
      }
      recentAvailable = true;
    } catch { recentAvailable = false; }
  }
  const all: ConsoleFeatureConversationSummary[] = [];
  for (const [key, item] of byKey) {
    const ref = parseFeatureConversationKey(key);
    if (!ref) continue;
    if (adapter !== undefined && ref.adapter !== adapter) continue;
    if (endpoint !== undefined && ref.endpointId !== endpoint) continue;
    if (query && !key.toLowerCase().includes(query) && !ref.conversation.id.toLowerCase().includes(query) && !item.name?.toLowerCase().includes(query)) continue;
    all.push(Object.freeze({ key, adapter: ref.adapter, endpointId: ref.endpointId, kind: ref.conversation.kind, id: ref.conversation.id,
      ...(item.name ? { name: item.name } : {}), hasOverrides: item.overrides.length > 0,
      overrides: Object.freeze(item.overrides.sort((left, right) => left.plugin < right.plugin ? -1 : 1)),
      ...(item.lastActiveAt ? { lastActiveAt: item.lastActiveAt } : {}) }));
  }
  all.sort((left, right) => Number(right.hasOverrides) - Number(left.hasOverrides)
    || (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const page = all.slice(cursor, cursor + limit);
  void state;
  return Object.freeze({ conversations: Object.freeze(page), ...(cursor + limit < all.length ? { nextCursor: `o:${cursor + limit}` } : {}), recentAvailable,
    persistent: conversations.persistent });
}

async function handle(type: ConsoleFeatureRpcType, input: Record_, context: FeatureRpcContext): Promise<unknown> {
  switch (type) {
    case 'feature.list':
      await authorize(context, { type });
      return readState(context, state => listFeatures(state));
    case 'feature.matrix':
      await authorize(context, { type });
      await context.stores?.conversations.refresh();
      return readState(context, state => matrix(state, context));
    case 'feature.get': {
      const target = readTarget(input, false);
      await authorize(context, { type, ...target });
      if (target.level === 'conversation') await context.stores?.conversations.refresh();
      return readState(context, state => getFeature(state, input, context));
    }
    case 'feature.set-override': {
      const target = readTarget(input, true);
      await authorize(context, { type, ...target });
      const patch = readPatch(input);
      assertNoEnvironmentReference(context, patch);
      return readState(context, state => {
        requireDeclared(state.document, target.plugin);
        assertAllowedFields(context, ownSchema(state.snapshot, target.plugin), target.level, Object.keys(patch));
        const apply = (entry: Record_) => {
          for (const [field, value] of Object.entries(patch)) {
            if (value === undefined) delete entry[field]; else entry[field] = structuredClone(value);
          }
          return entry;
        };
        if (target.level === 'conversation') return writeConversation(context, state, input, target.plugin, target.key!, apply);
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
        assertAllowedFields(context, ownSchema(state.snapshot, target.plugin), target.level,
          paths ? paths.map(path => path[0]!) : []);
        // A locked level keeps its stored switch: removing the whole entry clears fields only.
        const keepSwitch = !!enabledAt(state, context, target.plugin, target.level, target.key).lockedBy;
        const remove = (entry: Record_) => {
          if (!paths) {
            if (context.allowedFields?.(ownSchema(state.snapshot, target.plugin), target.level)) {
              // Narrowed callers (in-chat) reset only their own fields and the switch.
              const allowed = context.allowedFields(ownSchema(state.snapshot, target.plugin), target.level)!;
              for (const field of allowed) delete entry[field];
              if (!keepSwitch) delete entry[FEATURE_ENABLED_KEY];
              return entry;
            }
            return keepSwitch && entry[FEATURE_ENABLED_KEY] === false ? { [FEATURE_ENABLED_KEY]: false } : {};
          }
          for (const path of paths) {
            if (path.length === 1 && path[0] === FEATURE_ENABLED_KEY) {
              if (keepSwitch) assertUnlocked(state, context, target.plugin, target.level, target.key);
              delete entry[FEATURE_ENABLED_KEY];
              continue;
            }
            removePath(entry, path);
          }
          return entry;
        };
        if (target.level === 'conversation') return writeConversation(context, state, input, target.plugin, target.key!, remove);
        const overrides = nextOverrides(blockOf(state.document, target.plugin)?.[FEATURE_OVERRIDES_KEY],
          target.level as 'adapter' | 'endpoint', target.key!, remove);
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
        // Below a disabled level nothing may change its switch, in either direction.
        assertUnlocked(state, context, target.plugin, target.level, target.key);
        const toggle = (entry: Record_) => {
          // `true` is the inherited default, so the key is removed instead of stored.
          if (enabled) delete entry[FEATURE_ENABLED_KEY]; else entry[FEATURE_ENABLED_KEY] = false;
          return entry;
        };
        if (target.level === 'conversation') return writeConversation(context, state, input, target.plugin, target.key!, toggle);
        const overrides = nextOverrides(blockOf(state.document, target.plugin)?.[FEATURE_OVERRIDES_KEY],
          target.level as 'adapter' | 'endpoint', target.key!, toggle);
        return writeOverrides(context, state, input, target.plugin, overrides);
      });
    }
    case 'feature.conversations':
      await authorize(context, { type });
      await context.stores?.conversations.refresh();
      return readState(context, state => listConversations(state, input, context));
  }
}
