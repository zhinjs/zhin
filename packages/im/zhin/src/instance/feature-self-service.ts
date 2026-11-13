/**
 * ADR 0055 §7 / ADR 0056: in-chat feature self-service (`功能 …` / `feature …`) and chat role
 * management (`角色 …` / `role …`), both off by default (`features.selfService.enabled`).
 *
 * Feature commands need the chat role `admin` (or `owner`) at the target scope (ADR 0056 §6):
 * the chosen level's ancestor of the current conversation. Roles are effective downward
 * (global → adapter → endpoint → conversation), from stored grants only: a platform group owner /
 * admin gets nothing here unless granted a zhin role (ADR 0056 §4, revised 2026-11-12). Every write runs through the `feature.*` RPC handlers with an authorizer that
 * checks those roles, so locks, schema validation and revision checks are the Console's.
 * Replies are the command's return value (normal send chain); writes are audited.
 */
import { randomInt } from 'node:crypto';
import { commandFeatureId, defineCommand, type CommandContext } from '@zhin.js/command';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import {
  createMessages, parseFeatureConversationKey, parseFeatureResolutionKey,
  type FeatureConfigLevel, type Locale, type PluginId, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { readFeatureConversationDeclaration, type JsonSchema, type RootResourceInstaller } from '@zhin.js/runtime';
import { containsEnvironmentReference, dispatchFeatureConsoleRpc, type FeatureRpcContext, type FeatureRpcReply } from './console/module.js';
import {
  chatRoleIncludes, chatRoleMessageContext, chatScopeChain, isChatIdentity, isChatRole,
  type ChatIdentity, type ChatRole, type ChatRoleContext, type ChatRoleEntry,
} from '@zhin.js/core';
import { ChatRoleStorageUnavailableError, type InstanceChatRoleService } from './chat-roles.js';

export interface FeatureSelfServiceConfig {
  readonly enabled: boolean;
}

export const DEFAULT_FEATURE_SELF_SERVICE: FeatureSelfServiceConfig = Object.freeze({ enabled: false });

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Reads `features.selfService` from the host configuration; anything malformed falls back to the default. */
export function readFeatureSelfServiceConfig(hostConfig: unknown): FeatureSelfServiceConfig {
  const features = record(hostConfig) && record(hostConfig.features) ? hostConfig.features : undefined;
  const raw = features && record(features.selfService) ? features.selfService : undefined;
  if (!raw) return DEFAULT_FEATURE_SELF_SERVICE;
  return Object.freeze({ enabled: raw.enabled === true });
}

/** The sender and where they spoke, resolved once per command. */
export interface FeatureChatActor {
  readonly identity: ChatIdentity;
  readonly conversationKey: string;
  readonly endpointKey: string;
  readonly kind: 'group' | 'private' | 'channel';
  /** The sender's platform standing in this message (informational; never a zhin role). */
  readonly context: ChatRoleContext;
}

/** Resolves who sent the command and where; undefined outside a keyed conversation. */
export function featureChatActor(snapshot: Pick<RuntimeSnapshot, 'config' | 'projections' | 'tree'>, message: unknown): FeatureChatActor | undefined {
  const subject = chatRoleMessageContext(snapshot, message);
  // Chat commands act on a conversation; an unkeyable conversation (endpoint-level fallback) has none.
  if (!subject || !parseFeatureConversationKey(subject.context.conversationKey)) return undefined;
  const parsed = parseFeatureResolutionKey(subject.context.conversationKey);
  return Object.freeze({
    identity: subject.identity,
    conversationKey: subject.context.conversationKey,
    endpointKey: `${parsed.adapter}/${parsed.endpointId}`,
    kind: parsed.conversation!.kind,
    context: subject.context,
  });
}

const LEVEL_WORDS: Readonly<Record<string, FeatureConfigLevel>> = Object.freeze({
  会话: 'conversation', conversation: 'conversation', 账号: 'endpoint', endpoint: 'endpoint',
  适配器: 'adapter', adapter: 'adapter', 全局: 'global', global: 'global',
});
const SUBCOMMANDS: Readonly<Record<string, string>> = Object.freeze({
  列表: 'list', list: 'list', 开启: 'enable', enable: 'enable', 关闭: 'disable', disable: 'disable',
  设置: 'set', set: 'set', 重置: 'reset', reset: 'reset', 确认: 'confirm', confirm: 'confirm',
});
const ROLE_SUBCOMMANDS: Readonly<Record<string, string>> = Object.freeze({
  列表: 'list', list: 'list', 授予: 'grant', grant: 'grant', 撤销: 'revoke', revoke: 'revoke',
});
const ROLE_WORDS: Readonly<Record<string, ChatRole>> = Object.freeze({
  owner: 'owner', 主人: 'owner', admin: 'admin', 管理员: 'admin', trusted: 'trusted', 信任: 'trusted',
});

const messages = createMessages({
  description: { 'zh-CN': '管理本会话（及有权限的上级）的功能开关与配置', en: 'Manage feature switches and settings for this conversation (and scopes you administer)' },
  roleDescription: { 'zh-CN': '查看与授予 / 撤销聊天角色（owner / admin / trusted）', en: 'List, grant and revoke chat roles (owner / admin / trusted)' },
  disabled: { 'zh-CN': '群内功能自助未开启（features.selfService.enabled）。', en: 'In-chat feature self-service is off (features.selfService.enabled).' },
  denied: { 'zh-CN': '你在该范围没有 admin 角色。', en: 'You do not hold the admin role at that scope.' },
  roleDenied: { 'zh-CN': '你在该范围的角色不足以授予或撤销 {role}。', en: 'Your role at that scope cannot grant or revoke {role}.' },
  ownerDenied: { 'zh-CN': 'owner 只能由更高层的 owner 授予或撤销。', en: 'Only an owner at a higher level can grant or revoke owner.' },
  peerDenied: {
    'zh-CN': '对方在该范围已是 {role}，与你同级；只有更高的角色或更高层的 {role} 才能修改或撤销。',
    en: 'That user already holds {role} at that scope, the same as you; only a higher role, or {role} held at a higher level, can change or revoke it.',
  },
  listDenied: { 'zh-CN': '查看角色列表需要本会话的 admin 角色。', en: 'Listing chat roles needs the admin role in this conversation.' },
  hiddenIdentity: { 'zh-CN': '（上级授予，身份不显示）', en: '(granted above you; identity hidden)' },
  unpersisted: {
    'zh-CN': '未保存：聊天角色需要关系型项目数据库（sqlite / mysql / pg），当前数据库不支持持久化。',
    en: 'Not saved: chat roles need a relational project database (sqlite / mysql / pg); the current database cannot persist them.',
  },
  unknownConversation: { 'zh-CN': '无法识别当前会话。', en: 'This conversation cannot be identified.' },
  privateConversation: { 'zh-CN': '私聊的会话级覆盖只能在 Console 修改；可指定层级（账号 / 适配器 / 全局）。', en: 'Private conversation overrides are Console-only; pass a level (endpoint / adapter / global).' },
  usage: {
    'zh-CN': '用法：功能 列表 | 开启 <插件> [层级] | 关闭 <插件> [层级] | 设置 <插件> <字段> <值> [层级] | 重置 <插件> [层级]。层级：会话（默认）/ 账号 / 适配器 / 全局',
    en: 'Usage: feature list | enable <plugin> [level] | disable <plugin> [level] | set <plugin> <field> <value> [level] | reset <plugin> [level]. Levels: conversation (default) / endpoint / adapter / global',
  },
  roleUsage: {
    'zh-CN': '用法：角色 列表 | 授予 <用户> <owner|admin|trusted> [层级] | 撤销 <用户> <角色> [层级]。层级：会话（默认）/ 账号 / 适配器 / 全局',
    en: 'Usage: role list | grant <user> <owner|admin|trusted> [level] | revoke <user> <role> [level]. Levels: conversation (default) / endpoint / adapter / global',
  },
  locked: { 'zh-CN': '{plugin} 已在{level}层停用，下级不能开启或修改开关。', en: '{plugin} is disabled at the {level} level; levels below it cannot enable or change it.' },
  saved: { 'zh-CN': '已保存（{level}层），立即生效。', en: 'Saved ({level} level), effective now.' },
  overridesUnpersisted: {
    'zh-CN': '未保存：功能覆盖需要关系型项目数据库（sqlite / mysql / pg），当前数据库不支持持久化。',
    en: 'Not saved: feature overrides need a relational project database (sqlite / mysql / pg); the current database cannot persist them.',
  },
  unchanged: { 'zh-CN': '没有变化。', en: 'Nothing changed.' },
  conflict: { 'zh-CN': '配置已被其他地方修改，未保存，请重试。', en: 'Changed elsewhere; not saved. Try again.' },
  invalid: { 'zh-CN': '校验失败，未保存：{errors}', en: 'Validation failed, not saved: {errors}' },
  environmentReference: { 'zh-CN': '聊天中不能写入环境变量引用（$ 加花括号的占位符或 env://），未保存。', en: 'Environment references (dollar-brace placeholders or env://) cannot be written from chat; not saved.' },
  fieldDenied: { 'zh-CN': '字段 {field} 不允许在聊天中修改。', en: 'Field {field} cannot be changed in chat.' },
  notFound: { 'zh-CN': '未找到插件 {plugin}。', en: 'Plugin {plugin} was not found.' },
  failed: { 'zh-CN': '操作失败：{error}', en: 'Failed: {error}' },
  value: { 'zh-CN': '值必须是数字、布尔值、字符串或数组。', en: 'The value must be a number, boolean, string or array.' },
  confirmGlobal: {
    'zh-CN': '全局{action} {plugin} 会重启实例。确认请在 2 分钟内发送：功能 确认 {code}',
    en: 'Globally {action} {plugin} restarts the instance. To confirm within 2 minutes send: feature confirm {code}',
  },
  confirmMissing: { 'zh-CN': '没有待确认的操作，或确认码已过期。', en: 'Nothing to confirm, or the code expired.' },
  restarting: { 'zh-CN': '已{action} {plugin}（全局），实例正在重启。', en: '{plugin} {action} globally; the instance is restarting.' },
  enableWord: { 'zh-CN': '启用', en: 'enable' },
  disableWord: { 'zh-CN': '停用', en: 'disable' },
  enabledWord: { 'zh-CN': '启用', en: 'enabled' },
  disabledWord: { 'zh-CN': '停用', en: 'disabled' },
  listHeader: { 'zh-CN': '本会话功能状态：', en: 'Features in this conversation:' },
  listLine: { 'zh-CN': '{plugin}：{state}{source}', en: '{plugin}: {state}{source}' },
  lockedBy: { 'zh-CN': '（{level}层停用，已锁定）', en: ' (disabled at {level}, locked)' },
  disabledHere: { 'zh-CN': '（会话层停用）', en: ' (disabled at conversation)' },
  overridden: { 'zh-CN': '（会话层有字段覆盖）', en: ' (conversation field overrides)' },
  yourRoles: { 'zh-CN': '你的角色：{roles}', en: 'Your roles: {roles}' },
  none: { 'zh-CN': '无', en: 'none' },
  rolesHeader: { 'zh-CN': '本会话生效的聊天角色：', en: 'Chat roles effective in this conversation:' },
  roleLine: { 'zh-CN': '{role} @ {level} {scope}：{user}（{source}）', en: '{role} @ {level} {scope}: {user} ({source})' },
  userMissing: { 'zh-CN': '请 @ 用户或给出用户 id。', en: 'Mention a user or give a user id.' },
  levelConversation: { 'zh-CN': '会话', en: 'conversation' },
  levelEndpoint: { 'zh-CN': '账号', en: 'endpoint' },
  levelAdapter: { 'zh-CN': '适配器', en: 'adapter' },
  levelGlobal: { 'zh-CN': '全局', en: 'global' },
});

const LEVEL_MESSAGE = { conversation: 'levelConversation', endpoint: 'levelEndpoint', adapter: 'levelAdapter', global: 'levelGlobal' } as const;
const levelName = (locale: Locale, level: FeatureConfigLevel) => messages(locale, LEVEL_MESSAGE[level]);

function describeEntries(entries: readonly ChatRoleEntry[], locale: Locale): string {
  return entries.length
    ? entries.map(entry => `${entry.role}@${levelName(locale, entry.level)}${entry.key ? ` ${entry.key}` : ''}`).join(', ')
    : messages(locale, 'none');
}

/** One parsed argument: text, or a mentioned user id. */
export type FeatureChatToken = string | Readonly<{ user: string }>;

interface PendingGlobal {
  readonly code: string;
  readonly conversationKey: string;
  readonly plugin: string;
  readonly enabled: boolean;
  readonly expiresAt: number;
}

export interface FeatureSelfServiceDeps {
  readonly config: FeatureSelfServiceConfig;
  readonly roles: InstanceChatRoleService;
  /** RPC context without the per-actor parts (authorize / actor / allowedFields). */
  readonly context: Omit<FeatureRpcContext, 'authorize' | 'actor' | 'allowedFields' | 'authScope'>;
  readonly audit?: (entry: ConsoleAuditEntry) => void;
  readonly now?: () => number;
  readonly code?: () => string;
  /** Pending global confirmations; one map per installer. */
  readonly pending?: Map<string, PendingGlobal>;
  readonly publishEvent?: (type: string, data: unknown) => void;
}

function actorName(actor: FeatureChatActor): string {
  return `chat:${actor.identity.adapter}:${actor.identity.userId}`;
}

/** Ancestor of the actor's conversation at `level`. */
function scopeAt(actor: FeatureChatActor, level: FeatureConfigLevel): string {
  return chatScopeChain(actor.conversationKey)[['global', 'adapter', 'endpoint', 'conversation'].indexOf(level)]!;
}

function parseValue(text: string): { value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || (typeof value === 'object' && !Array.isArray(value))) return undefined;
    return { value };
  } catch {
    return { value: text };
  }
}

function schemaOf(deps: FeatureSelfServiceDeps, plugin: string): JsonSchema | undefined {
  const lease = deps.context.snapshots?.acquire();
  try { return lease?.value.tree.get(`root/${plugin}` as PluginId)?.configSchema as JsonSchema | undefined; }
  finally { lease?.release(); }
}

/** In-chat field allowlist: `selfServiceFields` at the conversation level, `chatAdminFields` above it. */
export function chatAllowedFields(schema: JsonSchema | undefined, level: FeatureConfigLevel): readonly string[] {
  let declaration;
  try { declaration = readFeatureConversationDeclaration(schema); } catch { return []; }
  return level === 'conversation' ? declaration.selfServiceFields : declaration.chatAdminFields;
}

function levelPicker(word: string | undefined): FeatureConfigLevel | null {
  if (word === undefined) return 'conversation';
  return LEVEL_WORDS[word.toLowerCase()] ?? null;
}

function auditor(deps: FeatureSelfServiceDeps, actor: FeatureChatActor, prefix: string) {
  return (action: string, level: FeatureConfigLevel, key: string, outcome: ConsoleAuditEntry['outcome'], detail: Record<string, unknown>) => {
    try {
      deps.audit?.({ actor: actorName(actor), action: `${prefix}:${action}`, target: `${level}:${key}`.slice(0, 512), outcome,
        detail: Object.freeze({ ...detail, level }) });
    } catch { /* audit never breaks a command */ }
  };
}

/** Runs one `功能` / `feature` invocation and returns the reply text. */
export async function executeFeatureChat(
  input: Readonly<{ tokens: readonly FeatureChatToken[]; actor: FeatureChatActor | undefined; locale: Locale }>,
  deps: FeatureSelfServiceDeps,
): Promise<string> {
  const { locale, actor } = input;
  if (!deps.config.enabled) return messages(locale, 'disabled');
  if (!actor) return messages(locale, 'unknownConversation');
  const administers = (key: string) => deps.roles.hasRole(actor.identity, key, 'admin');
  if (!deps.roles.entriesFor(actor.identity, actor.conversationKey).some(entry => chatRoleIncludes(entry.role, 'admin'))
    && !deps.roles.store.list().some(entry => entry.adapter === actor.identity.adapter && entry.userId === actor.identity.userId && chatRoleIncludes(entry.role, 'admin'))) {
    return messages(locale, 'denied');
  }
  const words = input.tokens.map(token => typeof token === 'string' ? token : undefined);
  const sub = SUBCOMMANDS[(words[0] ?? '').toLowerCase()];
  if (!sub) return messages(locale, 'usage');
  const { mayReferenceEnvironment: _never, ...base } = deps.context;
  const context: FeatureRpcContext = {
    ...base,
    authScope: 'chat',
    actor: actorName(actor),
    authorize: request => request.type === 'feature.list' || administers(request.key ?? ''),
    allowedFields: (schema, level) => chatAllowedFields(schema, level),
  };
  const call = (type: string, data: Record<string, unknown>) => dispatchFeatureConsoleRpc({ type, data }, context);
  const audit = auditor(deps, actor, 'feature.chat');
  const pickLevel = levelPicker;
  const describe = (reply: FeatureRpcReply | null, plugin: string, level: FeatureConfigLevel): string => {
    if (!reply) return messages(locale, 'usage');
    const body = reply.body as Record<string, any>;
    if (!body.success) {
      if (body.code === 'locked') return messages(locale, 'locked', { plugin, level: levelName(locale, body.lockedBy) });
      if (body.code === 'environment-reference') return messages(locale, 'environmentReference');
      if (body.code === 'field-not-allowed') return messages(locale, 'fieldDenied', { field: String(body.field) });
      if (reply.status === 403) return messages(locale, 'denied');
      if (reply.status === 404) return messages(locale, 'notFound', { plugin });
      if (body.code === 'conflict') return messages(locale, 'conflict');
      if (body.code === 'feature-overrides-unpersisted') return messages(locale, 'overridesUnpersisted');
      return messages(locale, 'failed', { error: String(body.error ?? '') });
    }
    const data = body.data as Record<string, any>;
    if (data?.status === 'saved') return messages(locale, 'saved', { level: levelName(locale, level) });
    if (data?.status === 'unchanged') return messages(locale, 'unchanged');
    if (data?.status === 'conflict') return messages(locale, 'conflict');
    if (data?.status === 'invalid') {
      return messages(locale, 'invalid', { errors: (data.errors as { path: string; message: string }[] ?? []).map(error => `${error.path || '/'} ${error.message}`).join('; ').slice(0, 300) });
    }
    return messages(locale, 'unchanged');
  };
  const target = (level: FeatureConfigLevel): { key: string } | { error: string } => {
    if (level === 'conversation' && actor.kind === 'private') return { error: messages(locale, 'privateConversation') };
    const key = scopeAt(actor, level);
    if (!administers(key)) return { error: messages(locale, 'denied') };
    return { key };
  };

  switch (sub) {
    case 'list': {
      const listed = await call('feature.list', {});
      const features = ((listed?.body as Record<string, any>)?.data?.features ?? []) as { plugin: string }[];
      const lines = [messages(locale, 'listHeader')];
      for (const feature of features) {
        const got = await call('feature.get', { plugin: feature.plugin, level: 'conversation', key: actor.conversationKey });
        const data = (got?.body as Record<string, any>)?.data as { enabled?: boolean; lockedBy?: FeatureConfigLevel; values?: Record<string, unknown> } | undefined;
        if (!data) continue;
        const source = data.lockedBy ? messages(locale, 'lockedBy', { level: levelName(locale, data.lockedBy) })
          : data.enabled === false ? messages(locale, 'disabledHere')
            : Object.keys(data.values ?? {}).length ? messages(locale, 'overridden') : '';
        lines.push(messages(locale, 'listLine', { plugin: feature.plugin, state: messages(locale, data.enabled ? 'enabledWord' : 'disabledWord'), source }));
      }
      lines.push(messages(locale, 'yourRoles', { roles: describeEntries(deps.roles.entriesFor(actor.identity, actor.conversationKey), locale) }));
      return lines.join('\n');
    }
    case 'enable':
    case 'disable': {
      const plugin = words[1];
      const level = pickLevel(words[2]);
      if (!plugin || level === null || words.length > 3) return messages(locale, 'usage');
      const enabled = sub === 'enable';
      const scope = target(level);
      if ('error' in scope) { audit(sub, level, scopeAt(actor, level), 'denied', { plugin }); return scope.error; }
      if (level === 'global') {
        const code = deps.code?.() ?? String(randomInt(100000, 1000000));
        deps.pending?.set(actorName(actor), { code, conversationKey: actor.conversationKey, plugin, enabled,
          expiresAt: (deps.now?.() ?? Date.now()) + 120_000 });
        return messages(locale, 'confirmGlobal', { action: messages(locale, enabled ? 'enableWord' : 'disableWord'), plugin, code });
      }
      const reply = await call('feature.set-enabled', { plugin, level, key: scope.key, enabled });
      audit(sub, level, scope.key, reply?.body.success ? 'ok' : reply?.status === 403 ? 'denied' : 'error', { plugin });
      return describe(reply, plugin, level);
    }
    case 'confirm': {
      const pending = deps.pending?.get(actorName(actor));
      const now = deps.now?.() ?? Date.now();
      if (!pending || pending.code !== words[1] || pending.expiresAt < now || pending.conversationKey !== actor.conversationKey) {
        return messages(locale, 'confirmMissing');
      }
      deps.pending?.delete(actorName(actor));
      if (!administers('')) return messages(locale, 'denied');
      const reply = await call('feature.set-enabled', { plugin: pending.plugin, level: 'global', enabled: pending.enabled });
      audit(pending.enabled ? 'enable' : 'disable', 'global', '', reply?.body.success ? 'ok' : 'error', { plugin: pending.plugin });
      const data = (reply?.body as Record<string, any>)?.data;
      if (reply?.body.success && data?.status === 'saved') {
        return messages(locale, 'restarting', { action: messages(locale, pending.enabled ? 'enabledWord' : 'disabledWord'), plugin: pending.plugin });
      }
      return describe(reply, pending.plugin, 'global');
    }
    case 'set': {
      const [, plugin, field, raw, levelWord] = words;
      const level = pickLevel(levelWord);
      if (!plugin || !field || raw === undefined || level === null || words.length > 5) return messages(locale, 'usage');
      const parsed = parseValue(raw);
      if (!parsed) return messages(locale, 'value');
      // Configuration files are environment-expanded: chat never plants `${…}` / `env://` at any level.
      if (containsEnvironmentReference(parsed.value)) {
        audit('set', level, scopeAt(actor, level), 'denied', { plugin, field, reason: 'environment-reference' });
        return messages(locale, 'environmentReference');
      }
      const scope = target(level);
      if ('error' in scope) { audit('set', level, scopeAt(actor, level), 'denied', { plugin, field }); return scope.error; }
      if (!chatAllowedFields(schemaOf(deps, plugin), level).includes(field)) {
        audit('set', level, scope.key, 'denied', { plugin, field });
        return messages(locale, 'fieldDenied', { field });
      }
      let reply: FeatureRpcReply | null;
      if (level === 'global') {
        reply = await setGlobalField(deps, plugin, field, parsed.value);
      } else {
        reply = await call('feature.set-override', { plugin, level, key: scope.key, patch: { [field]: parsed.value } });
      }
      audit('set', level, scope.key, reply?.body.success && (reply.body.data as any)?.status !== 'invalid' ? 'ok' : 'error', { plugin, field });
      return describe(reply, plugin, level);
    }
    case 'reset': {
      const plugin = words[1];
      const level = pickLevel(words[2]);
      if (!plugin || level === null || level === 'global' || words.length > 3) return messages(locale, 'usage');
      const scope = target(level);
      if ('error' in scope) { audit('reset', level, scopeAt(actor, level), 'denied', { plugin }); return scope.error; }
      const reply = await call('feature.remove-override', { plugin, level, key: scope.key });
      audit('reset', level, scope.key, reply?.body.success ? 'ok' : 'error', { plugin });
      return describe(reply, plugin, level);
    }
  }
  return messages(locale, 'usage');
}

/** Global field write through the configuration store (whole-document validation and application). */
async function setGlobalField(deps: FeatureSelfServiceDeps, plugin: string, field: string, value: unknown): Promise<FeatureRpcReply> {
  const configuration = deps.context.configuration;
  if (containsEnvironmentReference(value)) {
    return { status: 400, body: { success: false, code: 'environment-reference', error: '值不能包含环境变量引用（${…} / env://）' } };
  }
  if (!configuration.readProject) return { status: 503, body: { success: false, error: 'configuration unavailable' } };
  const read = await configuration.readProject({});
  const segments = plugin.split('/');
  const result = await configuration.patch({ instanceKey: segments[0]!, expectedRevision: read.revision,
    patches: [{ op: 'set', path: [...segments, field], value }] });
  if (result.status === 'saved') return { status: 200, body: { success: true, data: { status: 'saved' } } };
  if (result.status === 'conflict') return { status: 200, body: { success: true, data: { status: 'conflict' } } };
  return { status: 200, body: { success: true, data: { status: 'invalid', errors: result.errors } } };
}


/** Why a role change is refused: the role is above the actor's, owner needs an owner above, or a peer's grant. */
export interface ChatRoleChangeDenial {
  readonly role: ChatRole;
  readonly reason: 'role' | 'owner' | 'peer';
}

/**
 * ADR 0056 §3 rules for changing the grant of one identity at `scope` (the grant / revoke chat
 * command; the Console applies its own rules). `granting` is the role being granted (undefined
 * for a revoke), `existing` the identity's stored role at that scope.
 *
 * - Every role touched — the granted one and the one it replaces or removes — must be within the
 *   actor's own role at the scope (`owner` ⊃ `admin` ⊃ `trusted`).
 * - `owner` is only handled by an `owner` at a higher level.
 * - An existing grant equal to the actor's role is a peer's: only a higher role, or the same role
 *   held at a higher level, changes or removes it (so a granted low role never overwrites a peer's
 *   or a higher role at the same scope).
 */
export function chatRoleChangeDenial(
  roles: Pick<InstanceChatRoleService, 'roleAt' | 'roleAbove'>,
  identity: ChatIdentity,
  scope: string,
  granting: ChatRole | undefined,
  existing: ChatRole | undefined,
): ChatRoleChangeDenial | undefined {
  const held = roles.roleAt(identity, scope);
  const above = roles.roleAbove(identity, scope);
  const touched = [granting, existing].filter((role): role is ChatRole => role !== undefined);
  for (const role of touched) {
    if (!chatRoleIncludes(held, role)) return { role, reason: 'role' };
    if (role === 'owner' && above !== 'owner') return { role, reason: 'owner' };
  }
  if (existing && existing !== granting && held === existing && !chatRoleIncludes(above, existing)) return { role: existing, reason: 'peer' };
  return undefined;
}

/** Runs one `角色` / `role` invocation (ADR 0056 §3 grant rules) and returns the reply text. */
export async function executeRoleChat(
  input: Readonly<{ tokens: readonly FeatureChatToken[]; actor: FeatureChatActor | undefined; locale: Locale }>,
  deps: FeatureSelfServiceDeps,
): Promise<string> {
  const { locale, actor } = input;
  if (!deps.config.enabled) return messages(locale, 'disabled');
  if (!actor) return messages(locale, 'unknownConversation');
  const words = input.tokens.map(token => typeof token === 'string' ? token : undefined);
  const sub = ROLE_SUBCOMMANDS[(words[0] ?? '').toLowerCase()];
  if (!sub) return messages(locale, 'roleUsage');
  if (sub === 'list') {
    // Who holds roles is not public: listing needs admin here, and identities granted above the
    // scopes the actor administers (e.g. global owners) are not shown.
    if (!deps.roles.hasRole(actor.identity, actor.conversationKey, 'admin')) return messages(locale, 'listDenied');
    const lines = [messages(locale, 'rolesHeader')];
    for (const entry of deps.roles.list(actor.conversationKey)) {
      const visible = deps.roles.hasRole(actor.identity, entry.key, 'admin');
      lines.push(messages(locale, 'roleLine', { role: entry.role, level: levelName(locale, entry.level), scope: entry.key || '*',
        user: visible ? `${entry.adapter}:${entry.userId}` : messages(locale, 'hiddenIdentity'), source: entry.source }));
    }
    lines.push(messages(locale, 'yourRoles', { roles: describeEntries(deps.roles.entriesFor(actor.identity, actor.conversationKey), locale) }));
    return lines.join('\n');
  }
  const user = input.tokens[1];
  const userId = typeof user === 'object' ? user.user : user;
  if (!userId) return messages(locale, 'userMissing');
  const role = ROLE_WORDS[(words[2] ?? '').toLowerCase()];
  const level = levelPicker(words[3]);
  if (!role || !isChatRole(role) || level === null || input.tokens.length > 4) return messages(locale, 'roleUsage');
  const audit = auditor(deps, actor, 'chat-roles.chat');
  if (level === 'conversation' && actor.kind === 'private') return messages(locale, 'privateConversation');
  const scope = scopeAt(actor, level);
  const target = { adapter: actor.identity.adapter, userId: String(userId) };
  if (!isChatIdentity(target)) return messages(locale, 'userMissing');
  const current = deps.roles.store.get(level, scope, target);
  // A revoke with nothing stored is checked like handling the named role (no silent "unchanged" for outsiders).
  const denial = sub === 'revoke' && !current
    ? chatRoleChangeDenial(deps.roles, actor.identity, scope, role, undefined)
    : chatRoleChangeDenial(deps.roles, actor.identity, scope, sub === 'grant' ? role : undefined, current?.role);
  if (denial) {
    audit(sub, level, scope, 'denied', { role: denial.role, reason: denial.reason });
    return denial.reason === 'owner' ? messages(locale, 'ownerDenied')
      : messages(locale, denial.reason === 'peer' ? 'peerDenied' : 'roleDenied', { role: denial.role });
  }
  let status: 'saved' | 'unchanged';
  try {
    status = sub === 'grant'
      ? await deps.roles.store.grant({ level, key: scope, ...target, role, grantedBy: actorName(actor) })
      : current && current.role === role ? await deps.roles.store.revoke({ level, key: scope, ...target }) : 'unchanged';
  } catch (error) {
    audit(sub, level, scope, 'error', { role });
    if (error instanceof ChatRoleStorageUnavailableError) return messages(locale, 'unpersisted');
    return messages(locale, 'failed', { error: (error as Error).message });
  }
  audit(sub, level, scope, 'ok', { role });
  if (status === 'saved') deps.publishEvent?.('chat-roles:updated', { level, key: scope });
  return status === 'saved' ? messages(locale, 'saved', { level: levelName(locale, level) }) : messages(locale, 'unchanged');
}

/** Text tokens and mentioned users from the command's remaining segments. */
export function featureChatTokens(command: Pick<CommandContext, 'segments' | 'args'>): readonly FeatureChatToken[] {
  const tokens: FeatureChatToken[] = [];
  for (const segment of command.segments) {
    const type = typeof segment.type === 'string' ? segment.type : segment.type.name;
    if (type === 'text' && typeof segment.data.text === 'string') {
      tokens.push(...segment.data.text.split(/\s+/u).filter(Boolean));
    } else if (type === 'at' || type === 'mention') {
      const user = segment.data.target ?? segment.data.user_id ?? segment.data.qq ?? segment.data.id;
      if (typeof user === 'string' || typeof user === 'number') tokens.push(Object.freeze({ user: String(user) }));
    }
  }
  return tokens.length || !command.args.length ? tokens : [...command.args];
}

export interface InstallFeatureSelfServiceOptions extends Omit<FeatureSelfServiceDeps, 'pending'> {
  readonly snapshots: NonNullable<FeatureRpcContext['snapshots']>;
  /** Called with each resolved actor. */
  readonly onActor?: (actor: FeatureChatActor) => void;
}

/** Root commands `feature` (alias `功能`) and `role` (alias `角色`); only when enabled. */
export function installFeatureSelfService(options: InstallFeatureSelfServiceOptions): RootResourceInstaller {
  const pending = new Map<string, PendingGlobal>();
  return context => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    if (!options.config.enabled) return;
    const actorOf = (command: CommandContext): FeatureChatActor | undefined => {
      const lease = options.snapshots.acquire();
      let actor: FeatureChatActor | undefined;
      try { actor = featureChatActor(lease.value, command.input); } finally { lease.release(); }
      if (actor) options.onActor?.(actor);
      return actor;
    };
    const run = (command: CommandContext, execute: typeof executeFeatureChat) =>
      execute({ tokens: featureChatTokens(command), actor: actorOf(command), locale: command.locale }, { ...options, pending });
    context.addFeature(commandFeatureId, 'feature', defineCommand({
      description: messages('zh-CN', 'description'), descriptionI18n: { en: messages('en', 'description') },
      alias: ['功能'], options: {},
      execute: (command: CommandContext) => run(command, executeFeatureChat),
    }));
    context.addFeature(commandFeatureId, 'role', defineCommand({
      description: messages('zh-CN', 'roleDescription'), descriptionI18n: { en: messages('en', 'roleDescription') },
      alias: ['角色'], options: {},
      execute: (command: CommandContext) => run(command, executeRoleChat),
    }));
  };
}
