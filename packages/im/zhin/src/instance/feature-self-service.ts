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
import { commandFeatureId, defineCommand, UserFacingError, type CommandContext } from '@zhin.js/command';
import { operationClientAdapter } from '@zhin.js/feature-kit';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import {
  createMessages, parseFeatureConversationKey, parseFeatureResolutionKey,
  type FeatureConfigLevel, type Locale, type PluginId, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { readFeatureConversationDeclaration, type JsonSchema, type RootResourceInstaller } from '@zhin.js/runtime';
import { containsEnvironmentReference, dispatchFeatureConsoleRpc, type FeatureRpcContext, type FeatureRpcReply } from './console/module.js';
import { AMBIENT_FEATURE_ID, AMBIENT_FEATURE_WORDS } from '@zhin.js/core/runtime';
import {
  chatRoleIncludes, chatScopeChain, isChatIdentity, isChatRole, resolveChatRoleMessageContext,
  type ChatIdentity, type ChatRole, type ChatRoleContext, type ChatRoleEntry, type ChatRoleSubjectFailure,
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
  /** The sender's display name in this message, when the platform reports one (recorded on writes). */
  readonly displayName?: string;
}

/**
 * Why a chat command cannot act for its sender here (zhinjs/zhin#1250 `self-service-unknown-conversation-opaque`):
 * the chat-role reasons ({@link ChatRoleSubjectFailure}) plus `unkeyed-conversation` — the message
 * resolves only to its endpoint (the adapter reports no conversation kind / id a setting can be
 * stored under, or the account id cannot carry conversations).
 */
export type FeatureChatActorFailure = ChatRoleSubjectFailure | 'unkeyed-conversation';

export type FeatureChatActorResolution =
  | Readonly<{ ok: true; actor: FeatureChatActor }>
  | Readonly<{ ok: false; reason: FeatureChatActorFailure }>;

/** Resolves who sent the command and where, or why that is not possible. */
export function resolveFeatureChatActor(snapshot: Pick<RuntimeSnapshot, 'config' | 'projections' | 'tree'>, message: unknown): FeatureChatActorResolution {
  const subject = resolveChatRoleMessageContext(snapshot, message);
  if (!subject.ok) return Object.freeze({ ok: false as const, reason: subject.reason });
  // Chat commands act on a conversation; an unkeyable conversation (endpoint-level fallback) has none.
  if (!parseFeatureConversationKey(subject.context.conversationKey)) return Object.freeze({ ok: false as const, reason: 'unkeyed-conversation' as const });
  const parsed = parseFeatureResolutionKey(subject.context.conversationKey);
  const sender = record(message) && record(message.sender) ? message.sender : undefined;
  const displayName = typeof sender?.name === 'string' && sender.name.trim() && sender.name !== subject.identity.userId
    ? sender.name.trim() : undefined;
  return Object.freeze({ ok: true as const, actor: Object.freeze({
    identity: subject.identity,
    conversationKey: subject.context.conversationKey,
    endpointKey: `${parsed.adapter}/${parsed.endpointId}`,
    kind: parsed.conversation!.kind,
    context: subject.context,
    ...(displayName ? { displayName } : {}),
  }) });
}

/** Resolves who sent the command and where; undefined outside a keyed conversation ({@link resolveFeatureChatActor} without the reason). */
export function featureChatActor(snapshot: Pick<RuntimeSnapshot, 'config' | 'projections' | 'tree'>, message: unknown): FeatureChatActor | undefined {
  const resolved = resolveFeatureChatActor(snapshot, message);
  return resolved.ok ? resolved.actor : undefined;
}

const actorFailureMessages = createMessages({
  'no-conversation': {
    'zh-CN': '无法识别当前会话：这条消息没有带会话信息（适配器没有提供会话和账号）。请在 Console「功能」或「聊天角色」页设置。',
    en: 'This conversation cannot be identified: the message carries no conversation (the adapter reported no conversation or account). Use the Console "Features" or "Chat roles" page instead.',
  },
  'unknown-endpoint': {
    'zh-CN': '无法识别当前会话：收到消息的账号不在当前运行的账号列表里（可能刚被停用、改名或正在重载）。稍后重试；仍不行请在 Console「接入」中检查该账号。',
    en: 'This conversation cannot be identified: the receiving account is not among the running accounts (it may have just been disabled, renamed or reloaded). Try again shortly, or check the account under Connection in the Console.',
  },
  'no-adapter': {
    'zh-CN': '无法识别当前会话：收到消息的账号没有对应的适配器实例。请在 Console「接入」中检查该账号的配置。',
    en: 'This conversation cannot be identified: the receiving account belongs to no adapter instance. Check its configuration under Connection in the Console.',
  },
  'no-sender': {
    'zh-CN': '无法识别发送者：适配器没有提供发送者 id，无法判断你的角色。请在 Console「功能」或「聊天角色」页设置。',
    en: 'The sender cannot be identified: the adapter reported no sender id, so your role cannot be checked. Use the Console "Features" or "Chat roles" page instead.',
  },
  'simulated-sender': {
    'zh-CN': '你正以模拟身份发言（Sandbox 里手填的发送者），模拟身份没有 zhin 角色，不能管理功能或角色。请在 Sandbox 打开「以我的身份发言」（需要先在「我的聊天身份」里链接 sandbox 身份），或在 Console「功能」/「聊天角色」页设置。',
    en: 'You are speaking as a simulated sender (a sender typed in the Sandbox); simulated senders hold no zhin role and cannot manage features or roles. Turn on "Speak as me" in the Sandbox (link a sandbox identity under My chat identity first), or use the Console "Features" / "Chat roles" page.',
  },
  'invalid-sender': {
    'zh-CN': '无法识别发送者：适配器提供的发送者 id 不能作为聊天身份（含控制字符或超过 256 个字符）。请在 Console「功能」或「聊天角色」页设置。',
    en: 'The sender cannot be identified: the sender id the adapter reported cannot be a chat identity (control characters or over 256 characters). Use the Console "Features" or "Chat roles" page instead.',
  },
  'unkeyed-conversation': {
    'zh-CN': '这个会话无法按会话保存设置：适配器没有提供可用的会话类型或会话 id（或该账号 id 不能承载会话）。请在 Console「账号与会话」里设置，或在命令末尾指定层级「账号」/「适配器」。',
    en: 'Settings cannot be stored for this conversation: the adapter reported no usable conversation kind or id (or the account id cannot carry conversations). Use "Accounts and conversations" in the Console, or add the level "endpoint" / "adapter" to the command.',
  },
});

/** The sender-facing reply for a {@link FeatureChatActorFailure}: what failed and what to do instead. */
export function featureChatActorFailureText(reason: FeatureChatActorFailure, locale: Locale): string {
  return actorFailureMessages(locale, reason);
}

/**
 * A chat self-service refusal: its text is the reply (through the normal send chain) and `reason`
 * becomes the message's `refused` outcome reason instead of `command_replied | executed` (ADR 0061).
 */
export class FeatureChatRefusal extends UserFacingError {
  constructor(text: string, reason: string) {
    super(text, { reason });
    this.name = 'FeatureChatRefusal';
  }
}

const refuse = (reason: string, text: string): never => { throw new FeatureChatRefusal(text, reason); };

/** Runs `run`; a refusal comes back as its reply text (the exported string-returning executors). */
async function replyText(run: () => Promise<string>): Promise<string> {
  try { return await run(); } catch (error) {
    if (error instanceof FeatureChatRefusal) return error.message;
    throw error;
  }
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
  denied: { 'zh-CN': '你在该范围没有 admin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。', en: 'You do not hold the admin role at that scope. Ask the owner of this bot to grant it, in chat or on the Console "Chat roles" page.' },
  // ADR 0060 §5.3: platform standing is not a zhin role; say where roles come from.
  deniedStanding: { 'zh-CN': '你是本群群主 / 管理员，但平台身份不等于 zhin 角色；该范围需要 zhin 的 admin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。', en: 'You are a group owner / admin on the platform, but that is not a zhin role; this scope needs the zhin admin role. Ask the owner of this bot to grant it, in chat or on the Console "Chat roles" page.' },
  noOwnerHint: { 'zh-CN': '本机器人还没有主人：部署者可在私聊中直接向机器人发送「认领 <码>」（不需要命令前缀；码见 zhin status）。', en: 'This bot has no owner yet: the deployer can send 「claim <code>」 to it in a private chat (no command prefix needed; zhin status shows the code).' },
  roleDenied: { 'zh-CN': '你在该范围的角色不足以授予或撤销 {role}。', en: 'Your role at that scope cannot grant or revoke {role}.' },
  ownerDenied: { 'zh-CN': 'owner 只能由更高层的 owner 授予或撤销；全局 owner 在 Console「聊天角色」页授予。', en: 'Only an owner at a higher level can grant or revoke owner; global owners are granted on the Console "Chat roles" page.' },
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
  privateConversation: { 'zh-CN': '私聊的会话级覆盖只能在 Console 修改；可指定层级（账号 / 适配器 / 全局）。', en: 'Private conversation overrides are Console-only; pass a level (endpoint / adapter / global).' },
  // #1250: `{command}` is the command as this conversation sends it (its real prefix included).
  featureWord: { 'zh-CN': '功能', en: 'feature' },
  roleWord: { 'zh-CN': '角色', en: 'role' },
  usage: {
    'zh-CN': '用法：{command} 列表 [页码] | 开启 <插件> [层级] | 关闭 <插件> [层级] | 设置 <插件> <字段> <值> [层级] | 重置 <插件> [层级]。层级：会话（默认）/ 账号 / 适配器 / 全局。含空格的值可用引号包裹，如 "欢迎 新朋友"',
    en: 'Usage: {command} list [page] | enable <plugin> [level] | disable <plugin> [level] | set <plugin> <field> <value> [level] | reset <plugin> [level]. Levels: conversation (default) / endpoint / adapter / global. Quote values with spaces, e.g. "Welcome aboard"',
  },
  roleUsage: {
    'zh-CN': '用法：{command} 列表 | 授予 <用户|#人 id 前缀> <owner|admin|trusted> [层级] | 撤销 <用户> <角色> [层级]。层级：会话（默认）/ 账号 / 适配器 / 全局',
    en: 'Usage: {command} list | grant <user|#person-id-prefix> <owner|admin|trusted> [level] | revoke <user> <role> [level]. Levels: conversation (default) / endpoint / adapter / global',
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
    'zh-CN': '全局{action} {plugin} 会重启实例。确认请在 2 分钟内发送：{command} 确认 {code}',
    en: 'Globally {action} {plugin} restarts the instance. To confirm within 2 minutes send: {command} confirm {code}',
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
  globallyDisabled: { 'zh-CN': '（全局停用）', en: ' (disabled globally)' },
  configDisabled: { 'zh-CN': '（配置 enabled: false）', en: ' (enabled: false in its configuration)' },
  listPage: { 'zh-CN': '第 {page}/{pages} 页 · 共 {total} 项', en: 'Page {page}/{pages} · {total} items' },
  listNext: { 'zh-CN': '下一页：{command} 列表 {page}', en: 'Next page: {command} list {page}' },
  listPageOutOfRange: { 'zh-CN': '页码超出范围：共 {pages} 页。请使用「{command} 列表 <页码>」。', en: 'Page out of range: {pages} pages available. Use {command} list <page>.' },
  listEmpty: { 'zh-CN': '（本会话没有可管理的功能）', en: '(No features to manage in this conversation)' },
  overridden: { 'zh-CN': '（会话层有字段覆盖）', en: ' (conversation field overrides)' },
  yourRoles: { 'zh-CN': '你的角色：{roles}', en: 'Your roles: {roles}' },
  none: { 'zh-CN': '无', en: 'none' },
  rolesHeader: { 'zh-CN': '本会话生效的聊天角色：', en: 'Chat roles effective in this conversation:' },
  roleLine: { 'zh-CN': '{role} @ {level} {scope}：{user}（{source}）', en: '{role} @ {level} {scope}: {user} ({source})' },
  userMissing: { 'zh-CN': '请 @ 用户、给出用户 id，或用 #<人 id 前缀> 引用一个人。', en: 'Mention a user, give a user id, or refer to a person with #<person id prefix>.' },
  principalNotFound: { 'zh-CN': '没有 id 以 {prefix} 开头的人。', en: 'No person has an id starting with {prefix}.' },
  principalAmbiguous: { 'zh-CN': '有多个人的 id 以 {prefix} 开头，请多写几位。', en: 'Several people have ids starting with {prefix}; give more characters.' },
  principalNoIdentity: { 'zh-CN': '这个人在适配器 {adapter} 上没有身份；低于全局的角色只对本适配器上的身份生效。', en: 'This person has no identity on adapter {adapter}; roles below global only count for identities on that adapter.' },
  levelConversation: { 'zh-CN': '会话', en: 'conversation' },
  levelEndpoint: { 'zh-CN': '账号', en: 'endpoint' },
  levelAdapter: { 'zh-CN': '适配器', en: 'adapter' },
  levelGlobal: { 'zh-CN': '全局', en: 'global' },
  ambientName: { 'zh-CN': '插话', en: 'ambient' },
  ambientNotConfigured: {
    'zh-CN': '插话未在配置中启用（缺少 ai.trigger.ambient），请先在配置里开启；未保存。',
    en: 'Interjection is not enabled in the configuration (no ai.trigger.ambient); enable it there first. Not saved.',
  },
  ambientNotConfiguredState: { 'zh-CN': '（配置中未启用插话：缺少 ai.trigger.ambient）', en: ' (not enabled in the configuration: no ai.trigger.ambient)' },
  ambientGlobal: {
    'zh-CN': '插话的全局默认值在配置 ai.trigger.ambient 中设置（Console「AI → 插话」）；聊天里可以按会话 / 账号 / 适配器开关。',
    en: 'The global interjection default is ai.trigger.ambient in the configuration (Console "AI → Ambient"); in chat switch it per conversation / endpoint / adapter.',
  },
});

/** ADR 0062 §23: `插话` / `ambient` names group interjection, a feature without a Plugin. */
function featureTarget(word: string | undefined): string | undefined {
  return word !== undefined && AMBIENT_FEATURE_WORDS.has(word.toLowerCase()) ? AMBIENT_FEATURE_ID : word;
}

const LEVEL_MESSAGE = { conversation: 'levelConversation', endpoint: 'levelEndpoint', adapter: 'levelAdapter', global: 'levelGlobal' } as const;
const levelName = (locale: Locale, level: FeatureConfigLevel) => messages(locale, LEVEL_MESSAGE[level]);

function describeEntries(entries: readonly ChatRoleEntry[], locale: Locale): string {
  return entries.length
    ? entries.map(entry => `${entry.role}@${levelName(locale, entry.level)}${entry.key ? ` ${entry.key}` : ''}`).join(', ')
    : messages(locale, 'none');
}

/**
 * One parsed argument: text, quoted text (`"会话"`: always a value, never a keyword such as a
 * level word), or a mentioned user id.
 */
export type FeatureChatToken = string | Readonly<{ text: string; quoted: true }> | Readonly<{ user: string }>;

function isQuoted(token: FeatureChatToken | undefined): boolean {
  return typeof token === 'object' && 'quoted' in token;
}

/** Level named by token `index`; a quoted token is never a level word (`null`: not a level). */
function levelAt(tokens: readonly FeatureChatToken[], index: number): FeatureConfigLevel | null {
  const token = tokens[index];
  return isQuoted(token) ? null : levelPicker(token === undefined ? undefined : tokenText(token) ?? '');
}

/** Text of a text or quoted token; `undefined` for a mention. */
function tokenText(token: FeatureChatToken): string | undefined {
  return typeof token === 'string' ? token : 'text' in token ? token.text : undefined;
}

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

/** ADR 0060 §5.3: the denial says where roles come from, and tells platform group owners / admins their standing is not a zhin role. */
function deniedReply(deps: FeatureSelfServiceDeps, actor: FeatureChatActor, locale: Locale): string {
  const standing = actor.context.platform?.standing;
  const reply = messages(locale, standing === 'owner' || standing === 'admin' ? 'deniedStanding' : 'denied');
  const ownerless = !deps.roles.store.list().some(entry => entry.level === 'global' && entry.role === 'owner');
  return refuse('not-admin', ownerless ? `${reply}\n${messages(locale, 'noOwnerHint')}` : reply);
}

/** One `feature.list` row as the chat list reads it. */
interface FeatureListItem {
  readonly plugin: string;
  readonly adapter?: boolean;
  readonly globalEnabled?: boolean;
}

const FEATURE_LIST_PAGE_SIZE = 15;

/** Capabilities a chat user perceives: replies to commands, message middlewares and event handlers. */
const CHAT_FACING_FEATURES: ReadonlySet<string> = new Set([String(commandFeatureId), 'zhin.middleware', 'zhin.handler']);

/**
 * What `功能 列表` shows for one message, from the current generation:
 * - `chatFacing`: instance paths (`a`, `a/b`) owning a command / middleware / handler that applies to
 *   `clientAdapter` (no adapter restriction, or the same native adapter), plus their ancestors (whose
 *   switch also turns those off). Service-only plugins and plugins for other platforms are absent.
 * - `configDisabled`: instances whose own configuration says `enabled: false`.
 * Undefined when no snapshot is available (nothing is filtered then).
 */
function chatListView(deps: FeatureSelfServiceDeps, clientAdapter: string | undefined):
  { readonly chatFacing: ReadonlySet<string>; readonly configDisabled: ReadonlySet<string> } | undefined {
  const lease = deps.context.snapshots?.acquire();
  if (!lease) return undefined;
  try {
    const snapshot = lease.value;
    const pathOf = (id: PluginId): string[] | undefined => {
      const path: string[] = [];
      for (let node = snapshot.tree.get(id); node && node.id !== snapshot.root; node = node.parent ? snapshot.tree.get(node.parent) : undefined) {
        path.unshift(node.instanceKey);
      }
      return path.length ? path : undefined;
    };
    const chatFacing = new Set<string>();
    for (const slot of snapshot.capabilities.values()) {
      if (!CHAT_FACING_FEATURES.has(String(slot.feature))) continue;
      const adapter = (slot.definition as { readonly adapter?: unknown } | undefined)?.adapter;
      if (typeof adapter === 'string' && adapter && clientAdapter !== undefined && adapter !== clientAdapter) continue;
      const path = pathOf(slot.owner);
      if (!path) continue;
      for (let depth = 1; depth <= path.length; depth += 1) chatFacing.add(path.slice(0, depth).join('/'));
    }
    const configDisabled = new Set<string>();
    for (const [id, config] of snapshot.config) {
      if (!record(config) || config.enabled !== false) continue;
      const path = pathOf(id);
      if (path) configDisabled.add(path.join('/'));
    }
    return { chatFacing, configDisabled };
  } finally {
    lease.release();
  }
}

export interface FeatureChatInput {
  readonly tokens: readonly FeatureChatToken[];
  /** The sender, or why there is none (a bare `undefined` reads as `no-conversation`). */
  readonly actor: FeatureChatActor | FeatureChatActorFailure | undefined;
  readonly locale: Locale;
  /** The message's native client adapter: `功能 列表` hides plugins whose chat capabilities all target another one. */
  readonly clientAdapter?: string;
  /**
   * #1250: the invoked command as this conversation sends it (`command.formatCommand('feature' | 'role')`,
   * the real prefix included), used in usage and follow-up hints. Absent: the bare command word.
   */
  readonly command?: string;
}

/** The resolved actor, or a refusal naming why there is none. */
function requireActor(actor: FeatureChatInput['actor'], locale: Locale): FeatureChatActor {
  if (actor && typeof actor === 'object') return actor;
  const reason = actor ?? 'no-conversation';
  return refuse(reason, featureChatActorFailureText(reason, locale));
}

/** Runs one `功能` / `feature` invocation and returns the reply text (refusals included). */
export async function executeFeatureChat(input: FeatureChatInput, deps: FeatureSelfServiceDeps): Promise<string> {
  return replyText(() => runFeatureChat(input, deps));
}

/** {@link executeFeatureChat}, throwing a {@link FeatureChatRefusal} for a refusal. */
export async function runFeatureChat(input: FeatureChatInput, deps: FeatureSelfServiceDeps): Promise<string> {
  const { locale } = input;
  const command = input.command ?? messages(locale, 'featureWord');
  const usage = () => messages(locale, 'usage', { command });
  if (!deps.config.enabled) return refuse('self-service-disabled', messages(locale, 'disabled'));
  const actor = requireActor(input.actor, locale);
  const administers = (key: string) => deps.roles.hasRole(actor.identity, key, 'admin');
  if (!deps.roles.entriesFor(actor.identity, actor.conversationKey).some(entry => chatRoleIncludes(entry.role, 'admin'))
    && !deps.roles.heldBy(actor.identity).some(entry => chatRoleIncludes(entry.role, 'admin'))) {
    return deniedReply(deps, actor, locale);
  }
  const words = input.tokens.map(tokenText);
  // A bare `功能` lists (#1250): the list is what someone typing only the command wants.
  const sub = words.length === 0 ? 'list' : SUBCOMMANDS[(words[0] ?? '').toLowerCase()];
  if (!sub) return refuse('usage', usage());
  const { mayReferenceEnvironment: _never, ...base } = deps.context;
  const context: FeatureRpcContext = {
    ...base,
    authScope: 'chat',
    actor: actorName(actor),
    // #1250: the Console shows who changed an override and that it came from chat.
    operator: Object.freeze({ source: 'chat' as const, adapter: actor.identity.adapter, userId: actor.identity.userId,
      ...(actor.displayName ? { displayName: actor.displayName } : {}) }),
    authorize: request => request.type === 'feature.list' || administers(request.key ?? ''),
    allowedFields: (schema, level) => chatAllowedFields(schema, level),
  };
  const call = (type: string, data: Record<string, unknown>) => dispatchFeatureConsoleRpc({ type, data }, context);
  const audit = auditor(deps, actor, 'feature.chat');
  const pickLevel = levelPicker;
  const describe = (reply: FeatureRpcReply | null, plugin: string, level: FeatureConfigLevel): string => {
    if (!reply) return refuse('usage', usage());
    const body = reply.body as Record<string, any>;
    if (!body.success) {
      if (body.code === 'ambient-not-configured') return refuse('ambient-not-configured', messages(locale, 'ambientNotConfigured'));
      if (body.code === 'locked') return refuse('locked', messages(locale, 'locked', { plugin, level: levelName(locale, body.lockedBy) }));
      if (body.code === 'environment-reference') return refuse('environment-reference', messages(locale, 'environmentReference'));
      if (body.code === 'field-not-allowed') return refuse('field-not-allowed', messages(locale, 'fieldDenied', { field: String(body.field) }));
      if (reply.status === 403) return refuse('not-admin', messages(locale, 'denied'));
      if (reply.status === 404) return refuse('not-found', messages(locale, 'notFound', { plugin }));
      if (body.code === 'conflict') return refuse('conflict', messages(locale, 'conflict'));
      if (body.code === 'feature-overrides-unpersisted') return refuse('overrides-unpersisted', messages(locale, 'overridesUnpersisted'));
      return refuse('failed', messages(locale, 'failed', { error: String(body.error ?? '') }));
    }
    const data = body.data as Record<string, any>;
    if (data?.status === 'saved') return messages(locale, 'saved', { level: levelName(locale, level) });
    if (data?.status === 'unchanged') return messages(locale, 'unchanged');
    if (data?.status === 'conflict') return refuse('conflict', messages(locale, 'conflict'));
    if (data?.status === 'invalid') {
      return refuse('invalid-value', messages(locale, 'invalid', { errors: (data.errors as { path: string; message: string }[] ?? []).map(error => `${error.path || '/'} ${error.message}`).join('; ').slice(0, 300) }));
    }
    return messages(locale, 'unchanged');
  };
  const target = (level: FeatureConfigLevel): { key: string } | { error: string; reason: string } => {
    if (level === 'conversation' && actor.kind === 'private') return { error: messages(locale, 'privateConversation'), reason: 'private-conversation' };
    const key = scopeAt(actor, level);
    if (!administers(key)) return { error: messages(locale, 'denied'), reason: 'not-admin' };
    return { key };
  };

  switch (sub) {
    case 'list': {
      const pageWord = words[1];
      const page = pageWord === undefined ? 1 : /^[1-9]\d{0,5}$/u.test(pageWord) ? Number(pageWord) : NaN;
      if (!Number.isInteger(page) || words.length > 2) return refuse('usage', usage());
      const listed = await call('feature.list', {});
      const features = ((listed?.body as Record<string, any>)?.data?.features ?? []) as FeatureListItem[];
      const view = chatListView(deps, input.clientAdapter);
      const lines: string[] = [];
      for (const feature of features) {
        // Adapters are transports, not chat features: never listed (their switches stay in the Console).
        if (feature.adapter) continue;
        // `disable_plugins`: never loaded, so nothing below can be read; say so instead of a blank state.
        if (feature.globalEnabled === false) {
          lines.push(messages(locale, 'listLine', { plugin: feature.plugin, state: messages(locale, 'disabledWord'), source: messages(locale, 'globallyDisabled') }));
          continue;
        }
        if (view && !view.chatFacing.has(feature.plugin)) continue;
        const got = await call('feature.get', { plugin: feature.plugin, level: 'conversation', key: actor.conversationKey });
        const data = (got?.body as Record<string, any>)?.data as { enabled?: boolean; lockedBy?: FeatureConfigLevel; values?: Record<string, unknown> } | undefined;
        if (!data) continue;
        const configOff = view?.configDisabled.has(feature.plugin) === true;
        const enabled = data.enabled === true && !configOff;
        const source = data.lockedBy ? messages(locale, data.lockedBy === 'global' ? 'globallyDisabled' : 'lockedBy', { level: levelName(locale, data.lockedBy) })
          : data.enabled === false ? messages(locale, 'disabledHere')
            : configOff ? messages(locale, 'configDisabled')
              : Object.keys(data.values ?? {}).length ? messages(locale, 'overridden') : '';
        lines.push(messages(locale, 'listLine', { plugin: feature.plugin, state: messages(locale, enabled ? 'enabledWord' : 'disabledWord'), source }));
      }
      // ADR 0062 §23: group interjection is listed like a feature (switch only).
      if (actor.kind !== 'private') {
        const ambient = await call('feature.get', { plugin: AMBIENT_FEATURE_ID, level: 'conversation', key: actor.conversationKey });
        const data = (ambient?.body as Record<string, any>)?.data as { enabled?: boolean; lockedBy?: FeatureConfigLevel } | undefined;
        if (data) {
          lines.push(messages(locale, 'listLine', { plugin: messages(locale, 'ambientName'),
            state: messages(locale, data.enabled ? 'enabledWord' : 'disabledWord'),
            source: data.lockedBy === 'global' ? messages(locale, 'ambientNotConfiguredState')
              : data.lockedBy ? messages(locale, 'lockedBy', { level: levelName(locale, data.lockedBy) }) : '' }));
        }
      }
      const pages = Math.max(1, Math.ceil(lines.length / FEATURE_LIST_PAGE_SIZE));
      if (page > pages) return refuse('usage', messages(locale, 'listPageOutOfRange', { pages, command }));
      const out = [messages(locale, 'listHeader')];
      if (pages > 1) out.push(messages(locale, 'listPage', { page, pages, total: lines.length }));
      out.push(...(lines.length ? lines.slice((page - 1) * FEATURE_LIST_PAGE_SIZE, page * FEATURE_LIST_PAGE_SIZE) : [messages(locale, 'listEmpty')]));
      if (page < pages) out.push(messages(locale, 'listNext', { page: page + 1, command }));
      out.push(messages(locale, 'yourRoles', { roles: describeEntries(deps.roles.entriesFor(actor.identity, actor.conversationKey), locale) }));
      return out.join('\n');
    }
    case 'enable':
    case 'disable': {
      const plugin = featureTarget(words[1]);
      const level = levelAt(input.tokens, 2);
      if (!plugin || level === null || words.length > 3) return refuse('usage', usage());
      const enabled = sub === 'enable';
      if (plugin === AMBIENT_FEATURE_ID && level === 'global') return refuse('ambient-global', messages(locale, 'ambientGlobal'));
      const scope = target(level);
      if ('error' in scope) { audit(sub, level, scopeAt(actor, level), 'denied', { plugin }); return refuse(scope.reason, scope.error); }
      if (level === 'global') {
        const code = deps.code?.() ?? String(randomInt(100000, 1000000));
        deps.pending?.set(actorName(actor), { code, conversationKey: actor.conversationKey, plugin, enabled,
          expiresAt: (deps.now?.() ?? Date.now()) + 120_000 });
        return messages(locale, 'confirmGlobal', { action: messages(locale, enabled ? 'enableWord' : 'disableWord'), plugin, code, command });
      }
      const reply = await call('feature.set-enabled', { plugin, level, key: scope.key, enabled });
      audit(sub, level, scope.key, reply?.body.success ? 'ok' : reply?.status === 403 ? 'denied' : 'error', { plugin });
      return describe(reply, plugin === AMBIENT_FEATURE_ID ? messages(locale, 'ambientName') : plugin, level);
    }
    case 'confirm': {
      const pending = deps.pending?.get(actorName(actor));
      const now = deps.now?.() ?? Date.now();
      if (!pending || pending.code !== words[1] || pending.expiresAt < now || pending.conversationKey !== actor.conversationKey) {
        return refuse('confirm-missing', messages(locale, 'confirmMissing'));
      }
      deps.pending?.delete(actorName(actor));
      if (!administers('')) return refuse('not-admin', messages(locale, 'denied'));
      const reply = await call('feature.set-enabled', { plugin: pending.plugin, level: 'global', enabled: pending.enabled });
      audit(pending.enabled ? 'enable' : 'disable', 'global', '', reply?.body.success ? 'ok' : 'error', { plugin: pending.plugin });
      const data = (reply?.body as Record<string, any>)?.data;
      if (reply?.body.success && data?.status === 'saved') {
        return messages(locale, 'restarting', { action: messages(locale, pending.enabled ? 'enabledWord' : 'disabledWord'), plugin: pending.plugin });
      }
      return describe(reply, pending.plugin, 'global');
    }
    case 'set': {
      // `设置 <插件> <字段> <值…> [层级]`: the value is the rest of the text after the field. A trailing
      // unquoted level word is the level when something precedes it; a quoted one (`"会话"`) is always
      // part of the value, so quote a value that is or ends in a level word.
      const [, plugin, field, ...rest] = words;
      const levelWord = !isQuoted(input.tokens.at(-1)) && rest.length > 1 && rest.at(-1) !== undefined && LEVEL_WORDS[rest.at(-1)!.toLowerCase()] ? rest.pop() : undefined;
      const raw = rest.length && rest.every(word => word !== undefined) ? rest.join(' ') : undefined;
      const level = pickLevel(levelWord);
      if (!plugin || !field || raw === undefined || level === null) return refuse('usage', usage());
      const parsed = parseValue(raw);
      if (!parsed) return refuse('invalid-value', messages(locale, 'value'));
      // Configuration files are environment-expanded: chat never plants `${…}` / `env://` at any level.
      if (containsEnvironmentReference(parsed.value)) {
        audit('set', level, scopeAt(actor, level), 'denied', { plugin, field, reason: 'environment-reference' });
        return refuse('environment-reference', messages(locale, 'environmentReference'));
      }
      const scope = target(level);
      if ('error' in scope) { audit('set', level, scopeAt(actor, level), 'denied', { plugin, field }); return refuse(scope.reason, scope.error); }
      if (!chatAllowedFields(schemaOf(deps, plugin), level).includes(field)) {
        audit('set', level, scope.key, 'denied', { plugin, field });
        return refuse('field-not-allowed', messages(locale, 'fieldDenied', { field }));
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
      const plugin = featureTarget(words[1]);
      const level = levelAt(input.tokens, 2);
      if (!plugin || level === null || level === 'global' || words.length > 3) return refuse('usage', usage());
      const scope = target(level);
      if ('error' in scope) { audit('reset', level, scopeAt(actor, level), 'denied', { plugin }); return refuse(scope.reason, scope.error); }
      const reply = await call('feature.remove-override', { plugin, level, key: scope.key });
      audit('reset', level, scope.key, reply?.body.success ? 'ok' : 'error', { plugin });
      return describe(reply, plugin === AMBIENT_FEATURE_ID ? messages(locale, 'ambientName') : plugin, level);
    }
  }
  return refuse('usage', usage());
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
  // No `.env` authority from chat: a literal for a secret field is refused (`env-write-required`, #1250).
  const result = await configuration.patch({ instanceKey: segments[0]!, expectedRevision: read.revision,
    patches: [{ op: 'set', path: [...segments, field], value }] });
  if (result.status === 'saved') return { status: 200, body: { success: true, data: { status: 'saved' } } };
  if (result.status === 'conflict') return { status: 200, body: { success: true, data: { status: 'conflict' } } };
  return { status: 200, body: { success: true, data: { status: 'invalid', errors: result.errors,
    ...(result.status === 'invalid' && result.code ? { code: result.code } : {}) } } };
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

/** Runs one `角色` / `role` invocation (ADR 0056 §3 grant rules) and returns the reply text (refusals included). */
export async function executeRoleChat(input: FeatureChatInput, deps: FeatureSelfServiceDeps): Promise<string> {
  return replyText(() => runRoleChat(input, deps));
}

/** {@link executeRoleChat}, throwing a {@link FeatureChatRefusal} for a refusal. */
export async function runRoleChat(input: FeatureChatInput, deps: FeatureSelfServiceDeps): Promise<string> {
  const { locale } = input;
  const command = input.command ?? messages(locale, 'roleWord');
  if (!deps.config.enabled) return refuse('self-service-disabled', messages(locale, 'disabled'));
  const actor = requireActor(input.actor, locale);
  const words = input.tokens.map(tokenText);
  // A bare `角色` lists (#1250).
  const sub = words.length === 0 ? 'list' : ROLE_SUBCOMMANDS[(words[0] ?? '').toLowerCase()];
  if (!sub) return refuse('usage', messages(locale, 'roleUsage', { command }));
  if (sub === 'list') {
    // Who holds roles is not public: listing needs admin here, and identities granted above the
    // scopes the actor administers (e.g. global owners) are not shown.
    if (!deps.roles.hasRole(actor.identity, actor.conversationKey, 'admin')) return refuse('not-admin', messages(locale, 'listDenied'));
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
  const userId = typeof user === 'object' ? ('user' in user ? user.user : user.text) : user;
  if (!userId) return refuse('usage', messages(locale, 'userMissing'));
  // ADR 0060 §7: `#<person id prefix>` names a person (grant the same person across platforms).
  const person = typeof user === 'string' && user.startsWith('#') ? resolvePersonRef(deps.roles.store, user.slice(1)) : undefined;
  if (person && 'error' in person) return refuse(person.error === 'principalAmbiguous' ? 'person-ambiguous' : 'person-not-found', messages(locale, person.error, { prefix: person.prefix }));
  const role = ROLE_WORDS[(words[2] ?? '').toLowerCase()];
  const level = levelAt(input.tokens, 3);
  if (!role || !isChatRole(role) || level === null || input.tokens.length > 4) return refuse('usage', messages(locale, 'roleUsage', { command }));
  const audit = auditor(deps, actor, 'chat-roles.chat');
  if (level === 'conversation' && actor.kind === 'private') return refuse('private-conversation', messages(locale, 'privateConversation'));
  const scope = scopeAt(actor, level);
  let target: ChatIdentity = { adapter: actor.identity.adapter, userId: String(userId) };
  if (person) {
    // The grant goes to the person through one of its identities: below global only one on the
    // scope's adapter counts (ADR 0060 Q10); globally any (the actor's adapter first).
    const local = person.identities.find(identity => identity.adapter === actor.identity.adapter);
    const chosen = level === 'global' ? local ?? person.identities[0] : local;
    if (!chosen) return refuse('person-no-identity', messages(locale, 'principalNoIdentity', { adapter: actor.identity.adapter }));
    target = { adapter: chosen.adapter, userId: chosen.userId };
  }
  if (!isChatIdentity(target)) return refuse('usage', messages(locale, 'userMissing'));
  const current = deps.roles.store.get(level, scope, target);
  // A revoke with nothing stored is checked like handling the named role (no silent "unchanged" for outsiders).
  const denial = sub === 'revoke' && !current
    ? chatRoleChangeDenial(deps.roles, actor.identity, scope, role, undefined)
    : chatRoleChangeDenial(deps.roles, actor.identity, scope, sub === 'grant' ? role : undefined, current?.role);
  if (denial) {
    audit(sub, level, scope, 'denied', { role: denial.role, reason: denial.reason });
    return denial.reason === 'owner' ? refuse('owner-denied', messages(locale, 'ownerDenied'))
      : refuse(denial.reason === 'peer' ? 'peer-denied' : 'role-denied', messages(locale, denial.reason === 'peer' ? 'peerDenied' : 'roleDenied', { role: denial.role }));
  }
  let status: 'saved' | 'unchanged';
  try {
    status = sub === 'grant'
      ? await deps.roles.store.grant({ level, key: scope, ...target, role, grantedBy: actorName(actor) })
      : current && current.role === role ? await deps.roles.store.revoke({ level, key: scope, ...target }) : 'unchanged';
  } catch (error) {
    audit(sub, level, scope, 'error', { role });
    if (error instanceof ChatRoleStorageUnavailableError) return refuse('roles-unpersisted', messages(locale, 'unpersisted'));
    return refuse('failed', messages(locale, 'failed', { error: (error as Error).message }));
  }
  audit(sub, level, scope, 'ok', { role });
  if (status === 'saved') deps.publishEvent?.('chat-roles:updated', { level, key: scope });
  return status === 'saved' ? messages(locale, 'saved', { level: levelName(locale, level) }) : messages(locale, 'unchanged');
}

/** Shortest person id prefix accepted after `#` (without `cp_`). */
const PERSON_PREFIX_MIN = 4;

/**
 * `#cp_ab12…` / `#ab12…`: the stored person whose id starts with the prefix — only when exactly one
 * does (a prefix shorter than {@link PERSON_PREFIX_MIN} symbols never matches).
 */
export function resolvePersonRef(store: InstanceChatRoleService['store'], raw: string):
  { readonly id: string; readonly identities: readonly ChatIdentity[] } | { readonly error: 'principalNotFound' | 'principalAmbiguous'; readonly prefix: string } {
  const text = raw.trim().toLowerCase();
  const prefix = text.startsWith('cp_') ? text : `cp_${text}`;
  const shown = `#${prefix}`;
  if (prefix.length < 3 + PERSON_PREFIX_MIN || !/^cp_[a-z2-7]+$/u.test(prefix)) return { error: 'principalNotFound', prefix: shown };
  const matches = store.principals.principals().filter(person => person.id.startsWith(prefix));
  if (matches.length === 0) return { error: 'principalNotFound', prefix: shown };
  if (matches.length > 1) return { error: 'principalAmbiguous', prefix: shown };
  const id = matches[0]!.id;
  return { id, identities: store.principals.identitiesOf(id).map(identity => ({ adapter: identity.adapter, userId: identity.userId })) };
}

/** Opening quote → closing quote: ASCII, Chinese curly quotes and corner brackets. */
const QUOTE_PAIRS: Readonly<Record<string, string>> = Object.freeze({
  '"': '"', "'": "'", '\u201C': '\u201D', '\u2018': '\u2019', '\u300C': '\u300D', '\u300E': '\u300F',
});

/**
 * Whitespace-separated words; a word starting with a quote runs to its closing quote and keeps the
 * whitespace inside (`"欢迎 {name}"` → `欢迎 {name}`), marked `quoted` so it is never read as a
 * keyword. An unclosed quote keeps the rest of the text.
 */
function splitQuotedWords(text: string): FeatureChatToken[] {
  const words: FeatureChatToken[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index]!)) index++;
    if (index >= text.length) break;
    const close = QUOTE_PAIRS[text[index]!];
    if (close !== undefined) {
      const end = text.indexOf(close, index + 1);
      words.push(Object.freeze({ text: end === -1 ? text.slice(index + 1) : text.slice(index + 1, end), quoted: true as const }));
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    let end = index;
    while (end < text.length && !/\s/u.test(text[end]!)) end++;
    words.push(text.slice(index, end));
    index = end;
  }
  return words;
}

/** Text tokens (quote-aware) and mentioned users from the command's remaining segments. */
export function featureChatTokens(command: Pick<CommandContext, 'segments' | 'args'>): readonly FeatureChatToken[] {
  const tokens: FeatureChatToken[] = [];
  for (const segment of command.segments) {
    const type = typeof segment.type === 'string' ? segment.type : segment.type.name;
    if (type === 'text' && typeof segment.data.text === 'string') {
      tokens.push(...splitQuotedWords(segment.data.text));
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
    const actorOf = (command: CommandContext): FeatureChatActor | FeatureChatActorFailure => {
      const lease = options.snapshots.acquire();
      let resolved: FeatureChatActorResolution;
      try { resolved = resolveFeatureChatActor(lease.value, command.input); } finally { lease.release(); }
      if (!resolved.ok) return resolved.reason;
      options.onActor?.(resolved.actor);
      return resolved.actor;
    };
    // Refusals throw (FeatureChatRefusal): the reply is the same, the outcome is `refused` with the reason.
    const run = (command: CommandContext, execute: typeof runFeatureChat, localPath: 'feature' | 'role') => {
      const clientAdapter = operationClientAdapter(command.input);
      const invocation = command.formatCommand(localPath);
      return execute({ tokens: featureChatTokens(command), actor: actorOf(command), locale: command.locale,
        ...(clientAdapter ? { clientAdapter } : {}), ...(invocation ? { command: invocation } : {}) }, { ...options, pending });
    };
    context.addFeature(commandFeatureId, 'feature', defineCommand({
      description: messages('zh-CN', 'description'), descriptionI18n: { en: messages('en', 'description') },
      alias: ['功能'], options: {},
      execute: (command: CommandContext) => run(command, runFeatureChat, 'feature'),
    }));
    context.addFeature(commandFeatureId, 'role', defineCommand({
      description: messages('zh-CN', 'roleDescription'), descriptionI18n: { en: messages('en', 'roleDescription') },
      alias: ['角色'], options: {},
      execute: (command: CommandContext) => run(command, runRoleChat, 'role'),
    }));
  };
}
