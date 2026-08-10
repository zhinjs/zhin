import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  createCapabilityContext,
  type CapabilityContext,
} from '@zhin.js/feature-kit';
import { assertPermitSyntax } from '@zhin.js/permission';

const commandBrand = 'zhin.command/1' as const;

export type CommandParameterType =
  | 'string'
  | 'number'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'word'
  | 'text'
  | 'mention'
  | 'image'
  | 'face'
  | 'reply'
  | 'forward'
  | 'dice'
  | 'rps';
export type CommandParameterValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number | boolean>
  | Readonly<Record<string, unknown>>
  | null;

export const commandParameterTypes: ReadonlySet<CommandParameterType> = new Set([
  'string',
  'number',
  'integer',
  'float',
  'boolean',
  'word',
  'text',
  'mention',
  'image',
  'face',
  'reply',
  'forward',
  'dice',
  'rps',
]);

/**
 * Next.js 风格参数声明（`defineCommand({ params: ... })`）。
 * 文件名只声明参数形态（`[name]` / `[[name]]` / `[...name]` / `[[...name]]`），
 * 类型与默认值统一在这里声明。
 */
export interface CommandParamSchema {
  readonly type: CommandParameterType;
  readonly default?: CommandParameterValue;
  readonly description?: string;
}

/** Minimal structural contract shared with canonical IM segments. */
export interface CommandSegment {
  readonly type: string | { readonly name: string };
  readonly data: Readonly<Record<string, unknown>>;
}

export interface CommandParameterDefinition {
  readonly name: string;
  readonly type: CommandParameterType;
  readonly defaultValue?: CommandParameterValue;
  /** `[[name]]` / `[[...name]]` 可选段；缺省按 `defaultValue === undefined` 推断。 */
  readonly optional?: boolean;
  /** `[...name]` / `[[...name]]` 捕获所有段，运行时值为 `string[]`。 */
  readonly rest?: boolean;
  readonly description?: string;
}

/** 场景：群 / 私聊 / 频道等。 */
export interface CommandScene {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
}

/**
 * 发送者。
 * `role` 为角色列表（如 `user` / `trusted` / `master`，以及平台侧 `owner` / `admin` 等）。
 */
export interface CommandSender {
  readonly id: string;
  readonly name?: string;
  readonly role: readonly string[];
}

/**
 * 命令侧入站会话契约（结构对齐 `@zhin.js/im-contract` 的 ConversationRef；
 * command 为 Feature 层，不能 import core / IM 契约包，故独立声明）。
 */
export interface CommandConversation {
  readonly endpoint: Readonly<{
    readonly id: string;
    /** 适配器插件 owner（PluginId），与 `snapshot.config.get(adapter)` 对齐。 */
    readonly adapter: string;
  }>;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{
    readonly kind: 'group' | 'channel';
    readonly id: string;
  }>;
  readonly threadId?: string;
}

/**
 * 命令侧入站消息契约。
 *
 * `@zhin.js/core/runtime` 的 `Message` 结构兼容本接口（duck typing）。
 * 因架构分层（command 为 Feature 层，不能 import core），此处独立声明。
 */
export interface CommandMessage {
  readonly conversation: CommandConversation;
  readonly content: string;
  /** 发送者 id（扁平字段；结构化视图见 CommandContext.sender）。 */
  readonly sender?: string;
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** 若上游已结构化，优先采用。 */
  readonly scene?: CommandScene;
  readonly $reply?: (content: unknown) => Promise<unknown>;
  readonly $replyFrom?: (requester: string, content: unknown) => Promise<unknown>;
  /** 向同 Endpoint 的另一个通道发送消息（结构兼容 `Message.$sendTo`）。 */
  readonly $sendTo?: (
    conversation: {
      readonly kind: 'private' | 'group' | 'channel';
      readonly id: string;
      readonly parent?: Readonly<{ readonly kind: 'group' | 'channel'; readonly id: string }>;
      readonly threadId?: string;
    },
    content: unknown,
  ) => Promise<unknown>;
  /** 私信当前消息的发送者（结构兼容 `Message.$replyToPrivate`）。 */
  readonly $replyToPrivate?: (
    content: unknown,
    from?: boolean | { readonly kind: 'group' | 'channel'; readonly id: string },
  ) => Promise<unknown>;
  /** 向指定群发送消息（结构兼容 `Message.$replyToGroup`）。 */
  readonly $replyToGroup?: (groupId: string, content: unknown) => Promise<unknown>;
  /** 向指定频道发送消息（结构兼容 `Message.$replyToChannel`）。 */
  readonly $replyToChannel?: (channelId: string, guildId: string, content: unknown, threadId?: string) => Promise<unknown>;
}

/**
 * IM 入站快捷字段。
 * 有 `CommandMessage` 来源时由 {@link resolveCommandSession} 填充；
 * `CommandIndex.execute(name)` 等无消息路径下为 `undefined`。
 */
export interface CommandSession {
  /**
   * 适配器插件实例 id（CapabilityId 的 owner 段，如 `root/icqq`）。
   * 与 `snapshot.config.get(adapter)` 对齐。
   */
  readonly adapter?: string;
  /** Endpoint 名（`metadata.endpoint`）。 */
  readonly endpoint?: string;
  /** 场景对象（id / type / name）。 */
  readonly scene?: CommandScene;
  /** 发送者对象（id / name / role[]）。 */
  readonly sender?: CommandSender;
}

export interface CommandContext<
  TConfig = unknown,
  TInput extends CommandMessage = CommandMessage,
> extends CapabilityContext<TConfig>, CommandSession {
  readonly args: readonly string[];
  readonly params: Readonly<Record<string, CommandParameterValue>>;
  /** Structured arguments left after the command pattern was consumed. */
  readonly segments: readonly Readonly<CommandSegment>[];
  /**
   * 派发来源。IM 命中时为 Runtime `Message`（满足 {@link CommandMessage}）；
   * Host / `CommandIndex.execute` 等无消息路径可能为 `undefined`。
   */
  readonly input?: TInput;
}

export interface CommandDefinition<
  TConfig = unknown,
  TResult = unknown,
  TInput extends CommandMessage = CommandMessage,
> {
  readonly $feature: typeof commandBrand;
  readonly $parameter?: CommandParameterDefinition;
  readonly description?: string;
  /**
   * Next.js 风格参数声明：动态段文件名（`[name]` 等）的形态配合这里的
   * 类型 / 默认值 / 描述使用。静态命令可忽略本字段。
   */
  readonly params?: Readonly<Record<string, CommandParamSchema>>;
  /**
   * 本地静态段别名（可多词，如 `'gh issue'`）。替换全部本地静态段后仍挂
   * owner 前缀；不打破子插件命名空间。
   */
  readonly alias?: readonly string[];
  /**
   * 内置 permit DSL（AND）。单项内逗号为 OR。
   * 例：`adapter(icqq)`、`role(master)`、`group(123,456)`。
   */
  readonly permit?: readonly string[];
  /**
   * 全局整句快捷方式：触发串（trim 后全文相等）→ 预填 params。
   * 可打破 owner 命名空间。
   */
  readonly shortcut?: Readonly<Record<string, Readonly<Record<string, CommandParameterValue>>>>;
  execute(context: CommandContext<TConfig, TInput>): TResult | Promise<TResult>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig> {
    addCommand<TResult = unknown, TInput extends CommandMessage = CommandMessage>(
      localName: string,
      definition: CommandDefinition<TConfig, TResult, TInput>,
    ): void;
  }
}

/**
 * 定义一个命令模块（`commands/` 约定目录下默认导出）。
 * @public 用户侧创作面，承诺 semver（见 docs/contributing/public-api-surface.md）。
 */
export function defineCommand<
  TConfig = unknown,
  TResult = unknown,
  TInput extends CommandMessage = CommandMessage,
>(
  definition: Omit<CommandDefinition<TConfig, TResult, TInput>, '$feature' | '$parameter'>,
): Readonly<CommandDefinition<TConfig, TResult, TInput>> {
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Command execute must be a function');
  }
  if (definition.params !== undefined) {
    if (!definition.params || typeof definition.params !== 'object') {
      throw new TypeError('Command params must be a Record<string, CommandParamSchema>');
    }
    for (const [name, schema] of Object.entries(definition.params)) {
      if (!schema || typeof schema !== 'object'
        || !commandParameterTypes.has((schema as CommandParamSchema).type)) {
        throw new TypeError(`Command params.${name} requires a valid type`);
      }
    }
  }
  validateCommandAlias(definition.alias);
  validateCommandPermit(definition.permit);
  validateCommandShortcutShape(definition.shortcut);
  return Object.freeze({ $feature: commandBrand, ...definition });
}

function validateCommandAlias(alias: readonly string[] | undefined): void {
  if (alias === undefined) return;
  if (!Array.isArray(alias)) {
    throw new TypeError('Command alias must be a readonly string[]');
  }
  for (const [index, entry] of alias.entries()) {
    if (typeof entry !== 'string') {
      throw new TypeError(`Command alias[${index}] must be a string`);
    }
    const tokens = entry.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) {
      throw new TypeError(`Command alias[${index}] must contain at least one token`);
    }
  }
}

function validateCommandPermit(permit: readonly string[] | undefined): void {
  if (permit === undefined) return;
  if (!Array.isArray(permit)) {
    throw new TypeError('Command permit must be a readonly string[]');
  }
  for (const [index, entry] of permit.entries()) {
    if (typeof entry !== 'string') {
      throw new TypeError(`Command permit[${index}] must be a string`);
    }
  }
  assertPermitSyntax(permit);
}

function validateCommandShortcutShape(
  shortcut: Readonly<Record<string, Readonly<Record<string, CommandParameterValue>>>> | undefined,
): void {
  if (shortcut === undefined) return;
  if (!shortcut || typeof shortcut !== 'object' || Array.isArray(shortcut)) {
    throw new TypeError('Command shortcut must be a Record<string, Record<string, value>>');
  }
  for (const [trigger, params] of Object.entries(shortcut)) {
    if (!trigger.trim()) {
      throw new TypeError('Command shortcut keys must be non-empty after trim');
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new TypeError(`Command shortcut[${JSON.stringify(trigger)}] must be a params Record`);
    }
  }
}

export function bindCommandParameter<
  TConfig,
  TResult,
  TInput extends CommandMessage,
>(
  definition: CommandDefinition<TConfig, TResult, TInput>,
  parameter: CommandParameterDefinition | undefined,
): Readonly<CommandDefinition<TConfig, TResult, TInput>> {
  if (!parameter) return definition;
  return Object.freeze({ ...definition, $parameter: Object.freeze({ ...parameter }) });
}

export function parseCommandDefinition(value: unknown): CommandDefinition {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Command module must default-export defineCommand(...)');
  }
  const definition = value as Partial<CommandDefinition>;
  if (definition.$feature !== commandBrand || typeof definition.execute !== 'function') {
    throw new TypeError('Command module must default-export defineCommand(...)');
  }
  return definition as CommandDefinition;
}

export function createCommandContext(
  snapshot: RuntimeSnapshot,
  ownerId: PluginId,
  args: readonly string[],
  params: Readonly<Record<string, CommandParameterValue>> = Object.freeze({}),
  input: unknown = undefined,
  segments: readonly Readonly<CommandSegment>[] = Object.freeze([]),
): CommandContext {
  const context = createCapabilityContext(snapshot, ownerId);
  const session = resolveCommandSession(input);
  return Object.freeze({
    ...context,
    ...session,
    args: Object.freeze([...args]),
    params: Object.freeze({ ...params }),
    segments: freezeSegments(segments),
    ...(input !== undefined ? { input: input as CommandMessage } : {}),
  });
}

/**
 * 从派发来源（通常是 Runtime `Message`）解析入站快捷字段。
 * 不依赖 `@zhin.js/core`，按 {@link CommandMessage} 结构鸭式识别。
 */
export function resolveCommandSession(input: unknown): CommandSession {
  if (!isCommandMessageLike(input)) return Object.freeze({});

  const metadata = input.metadata && typeof input.metadata === 'object'
    ? input.metadata as Readonly<Record<string, unknown>>
    : undefined;

  const adapter = input.conversation.endpoint.adapter || undefined;
  const endpoint = typeof metadata?.endpoint === 'string' && metadata.endpoint
    ? metadata.endpoint
    : undefined;

  const scene = resolveScene(input, metadata);
  const sender = resolveSender(input, metadata);

  return Object.freeze({
    ...(adapter ? { adapter } : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(scene !== undefined ? { scene } : {}),
    ...(sender !== undefined ? { sender } : {}),
  });
}

function isCommandMessageLike(input: unknown): input is CommandMessage {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<CommandMessage>;
  return !!value.conversation
    && typeof value.conversation === 'object'
    && typeof value.content === 'string';
}

function resolveScene(
  input: CommandMessage,
  metadata: Readonly<Record<string, unknown>> | undefined,
): CommandScene | undefined {
  if (isCommandScene(input.scene)) {
    return Object.freeze({
      id: input.scene.id,
      type: input.scene.type,
      ...(input.scene.name !== undefined ? { name: input.scene.name } : {}),
    });
  }

  const conversation = input.conversation;
  const type = (typeof metadata?.channelType === 'string' && metadata.channelType)
    || (typeof metadata?.type === 'string' && metadata.type)
    || conversation.kind;
  const id = (typeof metadata?.channelId === 'string' && metadata.channelId)
    || conversation.id;
  if (!type || !id) return undefined;

  const name = firstString(
    metadata?.channelName,
    metadata?.group_name,
    metadata?.groupName,
    metadata?.sceneName,
  );

  return Object.freeze({
    id,
    type,
    ...(name !== undefined ? { name } : {}),
  });
}

function resolveSender(
  input: CommandMessage,
  metadata: Readonly<Record<string, unknown>> | undefined,
): CommandSender | undefined {
  const structured = (input as { readonly from?: unknown }).from;
  if (isCommandSender(structured)) {
    return freezeSender(structured);
  }
  // 允许上游把 sender 直接做成对象（未来 Runtime Message 演进）
  if (isCommandSender(input.sender)) {
    return freezeSender(input.sender);
  }

  const id = typeof input.sender === 'string' && input.sender
    ? input.sender
    : firstString(metadata?.user_id, metadata?.userId);
  if (!id) return undefined;

  const name = firstString(metadata?.nickname, metadata?.senderName, metadata?.name);
  const role = resolveRoles(metadata);

  return Object.freeze({
    id,
    ...(name !== undefined ? { name } : {}),
    role,
  });
}

function resolveRoles(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const roles: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed && !roles.includes(trimmed)) roles.push(trimmed);
  };

  if (Array.isArray(metadata?.roles)) {
    for (const item of metadata.roles) push(item);
  }
  push(metadata?.senderRole);
  push(metadata?.role);
  if (metadata?.isMaster === true) push('master');
  if (metadata?.isTrusted === true) push('trusted');
  if (roles.length === 0) roles.push('user');
  return Object.freeze(roles);
}

function isCommandScene(value: unknown): value is CommandScene {
  if (!value || typeof value !== 'object') return false;
  const scene = value as Partial<CommandScene>;
  return typeof scene.id === 'string'
    && scene.id.length > 0
    && typeof scene.type === 'string'
    && scene.type.length > 0;
}

function isCommandSender(value: unknown): value is CommandSender {
  if (!value || typeof value !== 'object') return false;
  const sender = value as Partial<CommandSender>;
  return typeof sender.id === 'string'
    && sender.id.length > 0
    && Array.isArray(sender.role)
    && sender.role.every((item) => typeof item === 'string');
}

function freezeSender(sender: CommandSender): CommandSender {
  return Object.freeze({
    id: sender.id,
    ...(sender.name !== undefined ? { name: sender.name } : {}),
    role: Object.freeze([...sender.role]),
  });
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function freezeSegments(
  segments: readonly Readonly<CommandSegment>[],
): readonly Readonly<CommandSegment>[] {
  return Object.freeze(segments.map((segment) => Object.freeze({
    type: typeof segment.type === 'string'
      ? segment.type
      : Object.freeze({ name: segment.type.name }),
    data: Object.freeze({ ...segment.data }),
  })));
}
