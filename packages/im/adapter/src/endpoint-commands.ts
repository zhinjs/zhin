/**
 * createEndpointCommands — 适配器 endpoint 管理命令套件（list / add / remove）。
 *
 * 把 QQ 适配器独有的 `qq endpoint` 命令族泛化为任意适配器可复用的套件：
 *
 * - Runtime 命令从所属 Adapter 读取账号清单，并直接提交同一 desired repository。
 *   首次修改前需管理员在 Console 确认迁移；新增仅保存，移除取消并清理目标账号。
 *   Runtime 路径不写启动文件或 `.env`，不重建 Root；目录错误不能降为旧文件路径。
 * - 以下文件写入和 bindFlow 仅兼容没有 project 上下文的手工 embedded 调用。
 * - `<adapter> endpoint list`：旧入口显示运行状态及启动配置。
 * - `<adapter> endpoint add <name> <key=value...>`：手动录入字段，
 *   凭据类字段转换成环境变量引用，其余字段保持内联值；具体项目文件持久化由根级
 *   EndpointConfigurationStore 负责。
 * - `<adapter> endpoint remove <name>`：从 `plugins.<adapterKey>.endpoints` 移除（重启生效）。
 * - 权限：实例 config 声明了 master（顶层或 endpoints[i]）时仅 master 可用 add/remove，
 *   未配置放行（isEndpointOperator）。
 * - 特殊 add 流程（如 QQ 扫码绑定）经 spec.bindFlow 钩子接管 add 命令。
 *
 * 接入步骤（以 telegram 为例）：
 * 1. composition root 提供 `endpointConfigurationStoreToken`；CLI 默认提供 YAML/.env 实现。
 * 2. plugin.ts setup 里 `context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState())`，
 *    token 由 `defineEndpointRuntimeStateToken('telegram')` 创建。
 * 3. adapters/telegram/index.ts create() 里 `context.use(token).endpoints.set(config.id, { id, mode })`。
 * 4. src 下 `export const telegramEndpointCommands = createEndpointCommands({ adapterKey: 'telegram', ... }, defineCommand)`
 *    （defineCommand 由调用方从 @zhin.js/command 传入——provider 包之间禁止互相 import，
 *    见 scripts/check-architecture-layers.mjs，故 defineCommand 走依赖注入）。
 * 5. commands/<adapter>/endpoint/{list/index.ts, add/[name]/index.ts, remove/[name]/index.ts} 分别
 *    `export default telegramEndpointCommands.list|add|remove`。
 *
 * 注意：adapterKey 即实例 key（zhin.config.yml 的 plugins.<key>）；多实例自定义 key 时
 * 写回目标以 spec.adapterKey 为准（与 QQ 现状一致）。
 */
import {
  createToken,
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
import {
  endpointConfigurationStoreToken,
  EndpointConfigurationError,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
} from './endpoint-configuration.js';

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
 * bindFlow 后续状态推送：优先走 OutboundHost（不受 inbound Message reply scope 限制）。
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
// 运行时状态：adapter create() 注册的 running endpoints
// ---------------------------------------------------------------------------

export interface EndpointRunningInfo {
  readonly id: string;
  /** 连接模式（ws / wss / polling / socket-mode …），仅用于 list 展示。 */
  readonly mode?: string;
}

export interface EndpointRuntimeState {
  /** 当前 generation 已成功创建的 endpoint（id → 描述） */
  readonly endpoints: Map<string, EndpointRunningInfo>;
}

export function createEndpointRuntimeState(): EndpointRuntimeState {
  return { endpoints: new Map() };
}

/** 每个适配器在模块顶层调用一次，创建自己的 runtime state token。 */
export function defineEndpointRuntimeStateToken(adapterKey: string): Token<EndpointRuntimeState> {
  return createToken<EndpointRuntimeState>(
    `zhin.${adapterKey}.runtime-state`,
    `${adapterKey} adapter runtime state (running endpoints)`,
  );
}

function envSlug(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toUpperCase();
}

/** 派生 endpoint 凭据的 env 键：`${ADAPTER}_${NAME}_${FIELD}`（如 `TELEGRAM_MY_BOT_TOKEN`） */
export function buildEndpointEnvKey(
  adapterKey: string,
  endpointId: string,
  fieldKey: string,
): string {
  return `${envSlug(adapterKey)}_${envSlug(endpointId)}_${envSlug(fieldKey)}`;
}

// ---------------------------------------------------------------------------
// 命令套件
// ---------------------------------------------------------------------------

/** add 命令可录入的字段描述（与 schema.json 的 endpoints.items.properties 对齐）。 */
export interface EndpointFieldSpec {
  /** 配置字段 key（如 token / access_token / url / baseUrl） */
  readonly key: string;
  /** add 时必填（schema 中 required 的凭据/连接字段） */
  readonly required?: boolean;
  /** 凭据类字段：值写入 .env，yaml 保存 ${REF} 引用；否则内联写入 yaml */
  readonly env?: boolean;
  readonly secret?: boolean;
  /** 字段说明（用于用法提示） */
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<Locale, string>>>;
}

export type EndpointCommandUse = <T>(token: Token<T>) => T;

/** bindFlow 钩子上下文：接管 add 命令的自定义绑定流程（如 QQ 扫码）。 */
export interface EndpointBindFlowContext {
  readonly locale: Locale;
  readonly formatCommand?: (localPath: string) => string | undefined;
  /** 命令参数 id（未指定时为 undefined，流程可自行决定终名） */
  readonly id?: string;
  /** 向当前会话推送后续状态（二维码刷新 / 成功 / 失败；走 durable OutboundHost，可在命令 reply scope 结束后调用） */
  readonly reply: EndpointCommandReply;
  readonly config: unknown;
  readonly input: unknown;
  readonly use: EndpointCommandUse;
}

export interface EndpointCommandsSpec {
  /** 实例 key（zhin.config.yml 的 plugins.<key>，如 telegram / napcat） */
  readonly adapterKey: string;
  /** 展示名（QQ / Telegram / NapCat …），用于权限与列表文案 */
  readonly adapterDisplayName: string;
  /** add 命令可录入字段（bindFlow 接管 add 时仅用于展示） */
  readonly fields?: readonly EndpointFieldSpec[];
  /** 运行中 endpoints 数据源（可选）：通常读 adapter create 注册的 runtime state */
  readonly running?: (use: EndpointCommandUse) => Iterable<EndpointRunningInfo>;
  /** list 中配置项的附加描述（如 entry => `appid: ${entry.appid}`） */
  readonly describeEntry?: (entry: ConfiguredEndpointEntry, locale?: Locale) => string;
  /** list 末尾的附加行（如 QQ 的进行中扫码提示）；返回 undefined 不加行 */
  readonly listFooter?: (use: EndpointCommandUse, locale?: Locale) => string | undefined;
  /** 自定义 add 流程（扫码绑定等）；提供时 add 命令忽略 kv 参数，交给钩子 */
  readonly bindFlow?: (context: EndpointBindFlowContext) => Promise<string> | string;
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
    readonly runtime?: boolean;
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
  lines.push(endpointCommandMessages(locale, source.runtime ? 'runtimeConfigured' : 'configured', { adapter: spec.adapterDisplayName, key: spec.adapterKey }));
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

function addUsage(spec: EndpointCommandsSpec, locale: Locale, command?: string, runtime = false): string {
  if (command === undefined) return endpointCommandMessages(locale, 'noCommand');
  const fields = spec.fields ?? [];
  const fieldText = fields.length === 0
    ? ''
    : endpointCommandMessages(locale, 'fieldList', { fields: fields.map((field) => {
      const marks = [
        field.required ? endpointCommandMessages(locale, 'required') : '',
        field.env ? endpointCommandMessages(locale, runtime ? 'credential' : 'environment') : '',
        field.descriptionI18n?.[locale] ?? field.description ?? '',
      ].filter(Boolean).join(locale === 'en' ? ', ' : '，');
      return marks ? `${field.key}（${marks}）` : field.key;
    }).join(locale === 'en' ? ', ' : '、') });
  return endpointCommandMessages(locale, 'addUsage', { command, fields: fieldText });
}

/** add（kv 模式）的完整业务逻辑：解析 kv → 凭据写 .env → 更新 Root 配置。 */
export async function addEndpointFromKeyValues(
  spec: EndpointCommandsSpec,
  id: string,
  args: readonly string[],
  store: EndpointConfigurationStore,
  presentation: Readonly<{ locale?: Locale; command?: string; removeCommand?: string }> = {},
): Promise<string> {
  const locale = resolveLocale(presentation.locale);
  const fields = spec.fields ?? [];
  const known = new Map(fields.map((field) => [field.key, field]));
  const values = new Map<string, string>();
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) return endpointCommandMessages(locale, 'invalidPair', { argument: arg, usage: addUsage(spec, locale, presentation.command) });
    const key = arg.slice(0, eq);
    const value = arg.slice(eq + 1).trim();
    const field = known.get(key);
    if (!field) {
      return endpointCommandMessages(locale, 'unknownField', { field: key, fields: fields.map((item) => item.key).join(locale === 'en' ? ', ' : '、') });
    }
    if (!value) return endpointCommandMessages(locale, 'emptyField', { field: key });
    values.set(key, value);
  }
  const missing = fields.filter((field) => field.required && !values.has(field.key));
  if (missing.length > 0) {
    return endpointCommandMessages(locale, 'missingFields', { fields: missing.map((field) => field.key).join(locale === 'en' ? ', ' : '、'), usage: addUsage(spec, locale, presentation.command) });
  }
  const entry: Record<string, unknown> = { id };
  const envValues: Record<string, string> = {};
  for (const field of fields) {
    const value = values.get(field.key);
    if (value === undefined) continue;
    if (field.env) {
      const envKey = buildEndpointEnvKey(spec.adapterKey, id, field.key);
      envValues[envKey] = value;
      entry[field.key] = `\${${envKey}}`;
    } else {
      entry[field.key] = value;
    }
  }
  try {
    const { filePath } = await store.add({
      adapterKey: spec.adapterKey,
      entry: entry as ConfiguredEndpointEntry,
      environment: envValues,
    });
    return endpointCommandMessages(locale, 'added', { id, file: filePath, key: spec.adapterKey,
      credentials: Object.keys(envValues).length > 0 ? endpointCommandMessages(locale, 'credentialsSaved') : '' });
  } catch (error) {
    if (error instanceof EndpointConfigurationError && error.code === 'duplicate_entry') {
      const detail = endpointCommandMessages(locale, 'duplicate', { adapter: error.details.adapterKey, id: error.details.endpointId });
      const hint = presentation.removeCommand === undefined ? '' : '\n' + endpointCommandMessages(locale, 'removeExisting', {
        command: `${presentation.removeCommand} ${JSON.stringify(error.details.endpointId)}`,
      });
      return endpointCommandMessages(locale, 'addFailed', { error: detail + hint });
    }
    return endpointCommandMessages(locale, 'addFailed', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** remove 的完整业务逻辑：从 Root 配置移除；返回回复文本。 */
export async function removeEndpointById(
  spec: Pick<EndpointCommandsSpec, 'adapterKey'>,
  id: string,
  store: EndpointConfigurationStore,
  presentation: Readonly<{ locale?: Locale; command?: string }> = {},
): Promise<string> {
  const locale = resolveLocale(presentation.locale);
  const trimmed = id.trim();
  if (!trimmed) return presentation.command === undefined ? endpointCommandMessages(locale, 'noCommand')
    : endpointCommandMessages(locale, 'removeUsage', { command: presentation.command });
  try {
    const { removed, filePath } = await store.remove(spec.adapterKey, trimmed);
    if (!removed) {
      return endpointCommandMessages(locale, 'notFound', { key: spec.adapterKey, id: trimmed, file: filePath });
    }
    return endpointCommandMessages(locale, 'removed', { file: filePath, key: spec.adapterKey, id: trimmed });
  } catch (error) {
    return endpointCommandMessages(locale, 'removeFailed', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** 生成 `<adapter> endpoint` 的 list / add / remove 三个命令定义（见文件头接入步骤）。 */
function commandRuntime(spec: EndpointCommandsSpec, context: EndpointCommandContext) {
  if (!context.project) return undefined;
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
  try {
    await mutateConsoleAdapter(runtime.consoleSpec, runtime.call, action, {
      expectedGeneration: runtime.generation, expectedRevision: runtime.revision, id,
      ...(values ? { values } : {}),
    });
    return endpointCommandMessages(locale, action === 'add' ? 'runtimeAdded' : 'runtimeRemoved', { id });
  } catch (error) {
    return endpointCommandMessages(locale, error instanceof PluginConsoleRpcError && error.code === 'conflict' ? 'runtimeConflict' : 'runtimeFailed');
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
        if (runtime) return formatEndpointList(spec, {
          running: runtime.adapter.list().filter(entry => entry.started).map(entry => ({ id: entry.endpointId })),
          configured: runtime.adapter.configurationView(spec.fields ?? []).map(entry => ({ id: entry.id, ...entry.values })),
          footer: spec.listFooter?.(use, locale), locale, runtime: true,
        });
        const store = use(endpointConfigurationStoreToken);
        return formatEndpointList(spec, {
          running: spec.running?.(use) ?? [],
          configured: await store.list(spec.adapterKey),
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
        const { config, input, params, args, use, locale: preference, formatCommand } = context;
        const locale = resolveLocale(preference);
        if (!isEndpointOperator(config, input)) return endpointCommandForbidden(spec.adapterDisplayName, locale);
        const id = endpointIdParam(params);
        const runtime = commandRuntime(spec, context);
        if (runtime) {
          if (runtime.adapter.needsMigration) return endpointCommandMessages(locale, 'migrationRequired');
          if (!id) return addUsage(spec, locale, formatCommand?.(`${spec.adapterKey} endpoint add`), true);
          let values: Record<string, string>;
          try { values = runtimePairs(args); } catch { return endpointCommandMessages(locale, 'runtimeFailed'); }
          return runtimeCommandMutation(runtime, 'add', id, values, locale);
        }
        if (spec.bindFlow) {
          return await spec.bindFlow({
            id,
            reply: createDurableEndpointCommandReply(input, use),
            config,
            input,
            use,
            locale, formatCommand,
          });
        }
        const command = formatCommand?.(`${spec.adapterKey} endpoint add`);
        if (!id) return addUsage(spec, locale, command);
        return await addEndpointFromKeyValues(spec, id, args, use(endpointConfigurationStoreToken), {
          locale, command, removeCommand: formatCommand?.(`${spec.adapterKey} endpoint remove`),
        });
      },
    }),
    remove: defineCommand({
      description: endpointCommandMessages('zh-CN', 'removeDescription', { key: spec.adapterKey }),
      descriptionI18n: { en: endpointCommandMessages('en', 'removeDescription', { key: spec.adapterKey }) },
      params: { id: { type: 'string', description: 'endpoint ID' } },
      async execute(context) {
        const { config, input, params, use, locale: preference, formatCommand } = context;
        const locale = resolveLocale(preference);
        if (!isEndpointOperator(config, input)) return endpointCommandForbidden(spec.adapterDisplayName, locale);
        const runtime = commandRuntime(spec, context);
        if (runtime) {
          const id = endpointIdParam(params);
          if (!id) return endpointCommandMessages(locale, 'runtimeFailed');
          return runtimeCommandMutation(runtime, 'remove', id, undefined, locale);
        }
        return await removeEndpointById(
          spec,
          String(params.id ?? ''),
          use(endpointConfigurationStoreToken),
          { locale, command: formatCommand?.(`${spec.adapterKey} endpoint remove`) },
        );
      },
    }),
  });
}
