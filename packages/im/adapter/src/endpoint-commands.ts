/**
 * Owned Adapter account commands (list/add/remove).
 * The same desired repository backs Console and chat commands. First migration requires
 * administrator confirmation in Console; new accounts remain inactive until explicitly started.
 * Account changes never write startup configuration or environment files or rebuild the Root.
 */
import {
  resolveLocale,
  outboundHostToken,
  PluginConsoleRpcError,
  type OutboundHost,
  type OutboundSendInput,
  type Token,
  type Locale,
  type PluginId,
  type FeatureId,
  type PluginConsoleRpcCall,
} from '@zhin.js/plugin-runtime';
import { isAdapterIndex } from './adapter-index.js';
import { adapterFeatureId } from './provider.js';
import { mutateConsoleAdapter, ownedConsoleAdapter } from './adapter-runtime-console.js';
import { endpointCommandMessages } from './endpoint-command-messages.js';
import type { ConfiguredEndpointEntry } from './endpoint-configuration.js';

// ---------------------------------------------------------------------------
// 权限：master 判定
// ---------------------------------------------------------------------------

/**
 * endpoint 管理命令的操作者校验：实例配置声明了 master（顶层或任一端点项）时
 * 仅 master 可执行管理命令；未配置则放行。
 */
export function isEndpointOperator(config: unknown, input: unknown): boolean {
  const cfg = (config ?? {}) as { master?: unknown; endpoints?: unknown };
  const masters = new Set<string>();
  const collect = (value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text) masters.add(text);
  };
  collect(cfg.master);
  if (Array.isArray(cfg.endpoints)) {
    for (const entry of cfg.endpoints) {
      collect((entry as { master?: unknown } | null | undefined)?.master);
    }
  }
  if (masters.size === 0) return true;
  const senderRaw = (input as { sender?: { id?: string } | null } | null | undefined)?.sender;
  const senderId = (typeof senderRaw === 'object' && senderRaw?.id) ? senderRaw.id.trim() : '';
  return !!senderId && masters.has(senderId);
}

/** add/remove 的拒绝文案（list 只读，不校验）。 */
export function endpointCommandForbidden(adapterDisplayName: string, locale: Locale = 'zh-CN'): string {
  return endpointCommandMessages(locale, 'forbidden', { adapter: adapterDisplayName });
}

// ---------------------------------------------------------------------------
// 回复提取
// ---------------------------------------------------------------------------

export type EndpointCommandReply = (text: string) => Promise<unknown>;

/**
 * 从命令 input（Runtime Message）提取 $reply；非消息来源（如 Host API 调用）降级为 no-op。
 */
export function extractEndpointCommandReply(input: unknown): EndpointCommandReply {
  const reply = (input as { $reply?: unknown } | null | undefined)?.$reply;
  if (typeof reply === 'function') {
    return (text) => (reply as (content: string) => Promise<unknown>).call(input, text);
  }
  return async () => undefined;
}

/**
 * 平台异步登录流程的后续状态推送优先走 OutboundHost（不受 inbound Message reply scope 限制）。
 * 扫码绑定等长流程会在命令结果已送达、`$reply` 已冻结后继续 notify，必须用 durable 出站。
 */
export function createDurableEndpointCommandReply(
  input: unknown,
  use: EndpointCommandUse,
): EndpointCommandReply {
  const scoped = extractEndpointCommandReply(input);
  const target = readOutboundSendTarget(input);
  if (!target) return scoped;

  return async (text) => {
    let outbound: OutboundHost | undefined;
    try {
      outbound = use(outboundHostToken);
    } catch {
      outbound = undefined;
    }
    if (outbound) {
      await outbound.send({ ...target, content: text });
      return;
    }
    await scoped(text);
  };
}

function readOutboundSendTarget(input: unknown): Omit<OutboundSendInput, 'content'> | undefined {
  const message = input as {
    conversation?: {
      endpoint?: { id?: unknown; adapter?: unknown };
      kind?: unknown;
      id?: unknown;
      parent?: OutboundSendInput['conversation']['parent'];
      threadId?: unknown;
    };
    metadata?: Readonly<Record<string, unknown>>;
  } | null | undefined;
  const conversation = message?.conversation;
  const endpointKeyRaw = conversation?.endpoint?.id;
  const adapterRaw = conversation?.endpoint?.adapter;
  const kind = conversation?.kind;
  const id = conversation?.id;
  if (
    endpointKeyRaw == null
    || adapterRaw == null
    || (kind !== 'private' && kind !== 'group' && kind !== 'channel')
    || typeof id !== 'string'
    || !id
  ) {
    return undefined;
  }
  const live = String(message?.metadata?.endpoint ?? message?.metadata?.endpointKey ?? '').trim();
  return {
    adapter: String(adapterRaw),
    endpointKey: live || String(endpointKeyRaw),
    conversation: {
      kind,
      id,
      parent: conversation.parent,
      threadId: typeof conversation.threadId === 'string' ? conversation.threadId : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 运行状态只读展示字段；账号目录由所属 Adapter 持有
// ---------------------------------------------------------------------------

export interface EndpointRunningInfo {
  readonly id: string;
  /** 连接模式（ws / wss / polling / socket-mode …），仅用于 list 展示。 */
  readonly mode?: string;
}

// ---------------------------------------------------------------------------
// 命令套件
// ---------------------------------------------------------------------------

/** add 命令可录入的字段描述（与 schema.json 的 endpoints.items.properties 对齐）。 */
export interface EndpointFieldSpec {
  /** 配置字段 key（如 token / access_token / url / baseUrl） */
  readonly key: string;
  readonly type?: 'string' | 'number' | 'boolean';
  /** add 时必填（schema 中 required 的凭据/连接字段） */
  readonly required?: boolean;
  /** 敏感凭据字段；管理视图遮蔽其值，持久化由所属 Adapter 的私有 repository 负责。 */
  readonly env?: boolean;
  readonly secret?: boolean;
  /** 字段说明（用于用法提示） */
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<Locale, string>>>;
}

export type EndpointCommandUse = <T>(token: Token<T>) => T;

export interface EndpointCommandsSpec {
  /** 当前 owner 内实际注册的 Adapter 名称（如 telegram / napcat）。 */
  readonly adapterKey: string;
  /** 展示名（QQ / Telegram / NapCat …），用于权限与列表文案 */
  readonly adapterDisplayName: string;
  /** 通用 add 命令可录入的闭合字段；平台自有登录流程单独声明命令。 */
  readonly fields?: readonly EndpointFieldSpec[];
  /** list 中配置项的附加描述（如 entry => `appid: ${entry.appid}`） */
  readonly describeEntry?: (entry: ConfiguredEndpointEntry, locale?: Locale) => string;
  /** list 末尾的附加行（如 QQ 的进行中扫码提示）；返回 undefined 不加行 */
  readonly listFooter?: (use: EndpointCommandUse, locale?: Locale) => string | undefined;
  /** add 命令描述覆盖 */
  readonly addDescription?: string;
  readonly addDescriptionI18n?: Readonly<Partial<Record<Locale, string>>>;
}

/**
 * 命令定义的最小结构（与 @zhin.js/command 的 CommandDefinition 结构兼容）。
 * provider 层不允许 import @zhin.js/command，故 defineCommand 由调用方注入，
 * 这里只描述结构；适配器侧传入 defineCommand 后 TCommand 即 Readonly<CommandDefinition>。
 *
 * `params` 值域须与 CommandParameterValue 对齐（含 null / 结构化对象 / rest 段的
 * `ReadonlyArray<string | number | boolean>`），否则注入的 defineCommand 会因
 * TS 逆变检查失败（TS2345）。
 */
export interface EndpointCommandContext {
  readonly owner?: PluginId | Readonly<{ id: PluginId }>;
  readonly generation?: number;
  readonly signal?: AbortSignal;
  project?<T>(feature: FeatureId): T;
  readonly locale?: Locale;
  readonly formatCommand?: (localPath: string) => string | undefined;
  readonly config: unknown;
  /**
   * 与 `@zhin.js/command` 的 `CommandContext.input` 对齐：IM 命中时有值，
   * Host / 无消息路径可为 `undefined`。须保持可选，否则注入 `defineCommand` 会因
   * execute 参数逆变检查失败（TS2345）。
   */
  readonly input?: unknown;
  readonly args: readonly string[];
  readonly params: Readonly<Record<
    string,
    | string
    | number
    | boolean
    | ReadonlyArray<string | number | boolean>
    | Readonly<Record<string, unknown>>
    | null
  >>;
  readonly use: EndpointCommandUse;
}

export interface EndpointCommandDefinition {
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<Locale, string>>>;
  // 与 @zhin.js/command 的 CommandParamSchema 结构对齐（provider 层不能 import
  // command，字面量联合在此镜像声明；新增参数类型须两侧同步）。
  readonly params?: Readonly<Record<string, {
    readonly type:
      | 'string' | 'number' | 'integer' | 'float' | 'boolean' | 'word' | 'text'
      | 'mention' | 'image' | 'face' | 'reply' | 'forward' | 'dice' | 'rps';
    readonly default?:
      | string
      | number
      | boolean
      | ReadonlyArray<string | number | boolean>
      | Readonly<Record<string, unknown>>
      | null;
    readonly description?: string;
    readonly descriptionI18n?: Readonly<Partial<Record<Locale, string>>>;
  }>>;
  execute(context: EndpointCommandContext): unknown;
}

export interface EndpointCommands<TCommand = EndpointCommandDefinition> {
  readonly list: TCommand;
  readonly add: TCommand;
  readonly remove: TCommand;
}

function endpointIdParam(params: Readonly<Record<string, unknown>>): string | undefined {
  const id = params.id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

/** list 文案：运行中 + 配置中两段，footer 可选。 */
export function formatEndpointList(
  spec: Pick<EndpointCommandsSpec, 'adapterKey' | 'adapterDisplayName' | 'describeEntry'>,
  source: {
    readonly running: Iterable<EndpointRunningInfo>;
    readonly configured: readonly ConfiguredEndpointEntry[];
    readonly footer?: string;
    readonly locale?: Locale;
  },
): string {
  const running = [...source.running];
  const locale = resolveLocale(source.locale);
  const lines: string[] = [];
  lines.push(endpointCommandMessages(locale, 'running', { adapter: spec.adapterDisplayName }));
  if (running.length === 0) {
    lines.push(endpointCommandMessages(locale, 'none'));
  } else {
    for (const endpoint of running) {
      lines.push(endpoint.mode ? `  - ${endpoint.id}（${endpoint.mode}）` : `  - ${endpoint.id}`);
    }
  }
  lines.push(endpointCommandMessages(locale, 'runtimeConfigured', { adapter: spec.adapterDisplayName, key: spec.adapterKey }));
  if (source.configured.length === 0) {
    lines.push(endpointCommandMessages(locale, 'none'));
  } else {
    for (const entry of source.configured) {
      const detail = spec.describeEntry?.(entry, locale);
      lines.push(detail ? `  - ${entry.id}（${detail}）` : `  - ${entry.id}`);
    }
  }
  if (source.footer) lines.push(source.footer);
  return lines.join('\n');
}

function addUsage(spec: EndpointCommandsSpec, locale: Locale, command?: string): string {
  if (command === undefined) return endpointCommandMessages(locale, 'noCommand');
  const fields = spec.fields ?? [];
  const fieldText = fields.length === 0
    ? ''
    : endpointCommandMessages(locale, 'fieldList', { fields: fields.map((field) => {
      const marks = [
        field.required ? endpointCommandMessages(locale, 'required') : '',
        field.env ? endpointCommandMessages(locale, 'credential') : '',
        field.descriptionI18n?.[locale] ?? field.description ?? '',
      ].filter(Boolean).join(locale === 'en' ? ', ' : '，');
      return marks ? `${field.key}（${marks}）` : field.key;
    }).join(locale === 'en' ? ', ' : '、') });
  return endpointCommandMessages(locale, 'addUsage', { command, fields: fieldText });
}

/** 解析命令所属 owner 的真实账号目录，不回退项目文件资源。 */
function commandRuntime(spec: EndpointCommandsSpec, context: EndpointCommandContext) {
  if (!context.project) throw new PluginConsoleRpcError('unsupported', '账号运行目录不可用');
  const projection = context.project<unknown>(adapterFeatureId);
  if (!isAdapterIndex(projection)) throw new Error('Adapter projection is unavailable');
  const owner = typeof context.owner === 'string' ? context.owner : context.owner?.id;
  const generation = context.generation;
  if (!owner || typeof generation !== 'number') throw new Error('Command runtime owner or generation is unavailable');
  const directory = projection.forOwner(owner);
  const call: PluginConsoleRpcCall = { signal: context.signal ?? new AbortController().signal,
    runtime: { owner, generation, operator: false, project(feature) {
      if (feature !== adapterFeatureId) throw new PluginConsoleRpcError('unsupported', 'Projection is not granted');
      return directory;
    } },
  };
  const consoleSpec = { adapterKey: spec.adapterKey, adapterDisplayName: spec.adapterDisplayName, fields: spec.fields };
  const adapter = ownedConsoleAdapter(consoleSpec, call);
  return { adapter, call, consoleSpec, revision: adapter.revision, generation };
}

function runtimePairs(args: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const argument of args) {
    const separator = argument.indexOf('=');
    if (separator <= 0) throw new PluginConsoleRpcError('invalid_input', 'Use declared key=value fields');
    values[argument.slice(0, separator)] = argument.slice(separator + 1);
  }
  return values;
}

async function runtimeCommandMutation(runtime: NonNullable<ReturnType<typeof commandRuntime>>, action: 'add' | 'remove', id: string,
  values: Record<string, string> | undefined, locale: Locale): Promise<string> {
  if (runtime.adapter.needsMigration) return endpointCommandMessages(locale, 'migrationRequired');
  if (action === 'add') {
    const missing = runtime.consoleSpec.fields?.filter(field => field.required && !values?.[field.key]?.trim()) ?? [];
    if (missing.length) return endpointCommandMessages(locale, 'missingFields', {
      fields: missing.map(field => field.key).join(locale === 'en' ? ', ' : '、'), usage: '',
    });
  }
  try {
    await mutateConsoleAdapter(runtime.consoleSpec, runtime.call, action, {
      expectedGeneration: runtime.generation, expectedRevision: runtime.revision, id,
      ...(values ? { values } : {}),
    });
    return endpointCommandMessages(locale, action === 'add' ? 'runtimeAdded' : 'runtimeRemoved', { id });
  } catch (error) {
    if (error instanceof PluginConsoleRpcError) {
      if (error.code === 'invalid_input') return error.message;
      if (error.code === 'conflict') return endpointCommandMessages(locale, 'runtimeConflict');
      if (error.code === 'not_found') return endpointCommandMessages(locale, 'runtimeNotFound', { id });
      if (error.code === 'commit_unknown') return endpointCommandMessages(locale, 'runtimeUnknown');
    }
    return endpointCommandMessages(locale, 'runtimeFailed');
  }
}

export function createEndpointCommands<TCommand>(
  spec: EndpointCommandsSpec,
  defineCommand: (definition: EndpointCommandDefinition) => TCommand,
): EndpointCommands<TCommand> {
  return Object.freeze({
    list: defineCommand({
      description: endpointCommandMessages('zh-CN', 'listDescription', { adapter: spec.adapterDisplayName }),
      descriptionI18n: { en: endpointCommandMessages('en', 'listDescription', { adapter: spec.adapterDisplayName }) },
      async execute(context) {
        const { use, locale: preference } = context;
        const locale = resolveLocale(preference);
        const runtime = commandRuntime(spec, context);
        return formatEndpointList(spec, {
          running: runtime.adapter.list().filter(entry => entry.started).map(entry => ({ id: entry.endpointId })),
          configured: runtime.adapter.configurationView(spec.fields ?? []).map(entry => ({ id: entry.id, ...entry.values })),
          footer: spec.listFooter?.(use, locale), locale,
        });
      },
    }),
    add: defineCommand({
      description: spec.addDescription
        ?? endpointCommandMessages('zh-CN', 'addDescription', { adapter: spec.adapterDisplayName }),
      descriptionI18n: spec.addDescriptionI18n ?? (spec.addDescription === undefined
        ? { en: endpointCommandMessages('en', 'addDescription', { adapter: spec.adapterDisplayName }) } : undefined),
      params: { id: { type: 'string', description: 'endpoint ID' } },
      async execute(context) {
        const { config, input, params, args, locale: preference, formatCommand } = context;
        const locale = resolveLocale(preference);
        if (!isEndpointOperator(config, input)) return endpointCommandForbidden(spec.adapterDisplayName, locale);
        const id = endpointIdParam(params);
        const runtime = commandRuntime(spec, context);
        if (runtime.adapter.needsMigration) return endpointCommandMessages(locale, 'migrationRequired');
        if (!id) return addUsage(spec, locale, formatCommand?.(`${spec.adapterKey} endpoint add`));
        let values: Record<string, string>;
        try { values = runtimePairs(args); } catch { return endpointCommandMessages(locale, 'runtimeFailed'); }
        return runtimeCommandMutation(runtime, 'add', id, values, locale);
      },
    }),
    remove: defineCommand({
      description: endpointCommandMessages('zh-CN', 'removeDescription', { key: spec.adapterKey }),
      descriptionI18n: { en: endpointCommandMessages('en', 'removeDescription', { key: spec.adapterKey }) },
      params: { id: { type: 'string', description: 'endpoint ID' } },
      async execute(context) {
        const { config, input, params, locale: preference, formatCommand } = context;
        const locale = resolveLocale(preference);
        if (!isEndpointOperator(config, input)) return endpointCommandForbidden(spec.adapterDisplayName, locale);
        const runtime = commandRuntime(spec, context);
        const id = endpointIdParam(params);
        if (!id) {
          const command = formatCommand?.(`${spec.adapterKey} endpoint remove`);
          return endpointCommandMessages(locale, command ? 'removeUsage' : 'noCommand', command ? { command } : {});
        }
        return runtimeCommandMutation(runtime, 'remove', id, undefined, locale);
      },
    }),
  });
}
