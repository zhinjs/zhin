/**
 * createEndpointCommands — 适配器 endpoint 管理命令套件（list / add / remove）。
 *
 * 把 QQ 适配器独有的 `qq.endpoint` 命令族泛化为任意适配器可复用的套件：
 *
 * - `<adapter>.endpoint list`：运行中的 endpoints（adapter create 注册的 runtime state）
 *   + zhin.config.yml 配置里的 `plugins.<adapterKey>.endpoints`。
 * - `<adapter>.endpoint add <name> <key=value...>`：手动录入字段，
 *   凭据类字段（env: true）值写入 .env（`<ADAPTER>_<NAME>_<FIELD>` 大写键），
 *   yaml 中保存 `${REF}` 引用；其余字段内联写入。yaml 用 Document 节点级操作保留注释。
 * - `<adapter>.endpoint remove <name>`：从 `plugins.<adapterKey>.endpoints` 移除（重启生效）。
 * - 权限：实例 config 声明了 master（顶层或 endpoints[i]）时仅 master 可用 add/remove，
 *   未配置放行（isEndpointOperator）。
 * - 特殊 add 流程（如 QQ 扫码绑定）经 spec.bindFlow 钩子接管 add 命令。
 *
 * 接入步骤（以 telegram 为例）：
 * 1. plugin.ts setup 里 `context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState())`，
 *    token 由 `defineEndpointRuntimeStateToken('telegram')` 创建。
 * 2. adapters/telegram.ts create() 里 `context.use(token).endpoints.set(config.name, { name, mode })`。
 * 3. src 下 `export const telegramEndpointCommands = createEndpointCommands({ adapterKey: 'telegram', ... }, defineCommand)`
 *    （defineCommand 由调用方从 @zhin.js/command 传入——provider 包之间禁止互相 import，
 *    见 scripts/check-architecture-layers.mjs，故 defineCommand 走依赖注入）。
 * 4. commands/endpoint/{list.ts, add/[name:string].ts, remove/[name:string].ts} 分别
 *    `export default telegramEndpointCommands.list|add|remove`。
 *
 * 注意：adapterKey 即实例 key（zhin.config.yml 的 plugins.<key>）；多实例自定义 key 时
 * 写回目标以 spec.adapterKey 为准（与 QQ 现状一致）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createToken, type Token } from '@zhin.js/plugin-runtime';
import { isMap, isSeq, parseDocument, type YAMLSeq } from 'yaml';

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
  const sender = String((input as { sender?: unknown } | null | undefined)?.sender ?? '').trim();
  return !!sender && masters.has(sender);
}

/** add/remove 的拒绝文案（list 只读，不校验）。 */
export function endpointCommandForbidden(adapterDisplayName: string): string {
  return `仅 master 可执行 ${adapterDisplayName} endpoint 管理命令`;
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

// ---------------------------------------------------------------------------
// 运行时状态：adapter create() 注册的 running endpoints
// ---------------------------------------------------------------------------

export interface EndpointRunningInfo {
  readonly name: string;
  /** 连接模式（ws / wss / polling / socket-mode …），仅用于 list 展示。 */
  readonly mode?: string;
}

export interface EndpointRuntimeState {
  /** 当前 generation 已成功创建的 endpoint（name → 描述） */
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

// ---------------------------------------------------------------------------
// .env 凭据持久化
// ---------------------------------------------------------------------------

/** 项目根：ZHIN_PROJECT_ROOT 优先，缺省 process.cwd()（替代 legacy runtimeCwd） */
export function resolveProjectRoot(): string {
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  return path.resolve(envRoot || process.cwd());
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
  endpointName: string,
  fieldKey: string,
): string {
  return `${envSlug(adapterKey)}_${envSlug(endpointName)}_${envSlug(fieldKey)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
  const newLine = `${key}=${value}`;
  if (lineRe.test(content)) {
    return content.replace(lineRe, newLine);
  }
  const trimmed = content.replace(/\s*$/, '');
  if (trimmed.length === 0) {
    return `${newLine}\n`;
  }
  return `${trimmed}\n${newLine}\n`;
}

/** 写入或更新 `.env` 中的键值，并同步到当前进程 `process.env` */
export function persistEndpointEnvValues(
  values: Readonly<Record<string, string>>,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolveProjectRoot();
  const envPath = path.join(root, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  for (const [key, value] of Object.entries(values)) {
    content = upsertEnvLine(content, key, value);
    process.env[key] = value;
  }
  fs.writeFileSync(envPath, content);
}

// ---------------------------------------------------------------------------
// zhin.config.yml 读写（yaml Document 节点级操作，保留注释；仅支持 .yml/.yaml）
// ---------------------------------------------------------------------------

export interface ConfiguredEndpointEntry {
  name: string;
  [key: string]: unknown;
}

const CONFIG_BASENAME = 'zhin.config';
const YAML_EXTENSIONS = ['.yml', '.yaml'] as const;

/** 定位项目配置文件：ZHIN_CONFIG 指定优先，否则发现 zhin.config.yml/.yaml，都没有则默认新建 zhin.config.yml */
export function findEndpointConfigFile(adapterKey: string, projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  const envConfig = process.env.ZHIN_CONFIG?.trim();
  if (envConfig) return path.resolve(root, envConfig);
  for (const ext of YAML_EXTENSIONS) {
    const candidate = path.join(root, `${CONFIG_BASENAME}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of ['.json', '.toml', '.ts'] as const) {
    const candidate = path.join(root, `${CONFIG_BASENAME}${ext}`);
    if (fs.existsSync(candidate)) {
      throw new Error(`暂不支持写入 ${ext} 配置文件，请手动在 ${CONFIG_BASENAME}${ext} 的 plugins.${adapterKey}.endpoints 中维护`);
    }
  }
  return path.join(root, `${CONFIG_BASENAME}.yml`);
}

interface EndpointConfigDocument {
  filePath: string;
  doc: ReturnType<typeof parseDocument>;
}

function readConfigDocument(adapterKey: string, projectRoot?: string): EndpointConfigDocument {
  const filePath = findEndpointConfigFile(adapterKey, projectRoot);
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const doc = parseDocument(content || '{}');
  return { filePath, doc };
}

function writeConfigDocument({ filePath, doc }: EndpointConfigDocument): void {
  fs.writeFileSync(filePath, doc.toString());
}

/** 读取 plugins.<adapterKey>.endpoints（plain JS）；plugins/<adapterKey> 缺失或形态不符时返回 [] */
export function listConfiguredEndpoints(
  adapterKey: string,
  projectRoot?: string,
): ConfiguredEndpointEntry[] {
  const { doc } = readConfigDocument(adapterKey, projectRoot);
  const plugins = doc.toJS()?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  const endpoints = (plugins as Record<string, { endpoints?: unknown }>)[adapterKey]?.endpoints;
  if (!Array.isArray(endpoints)) return [];
  return endpoints.filter(
    (entry): entry is ConfiguredEndpointEntry =>
      !!entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string',
  );
}

function entryName(item: unknown): string | undefined {
  if (!isMap(item)) return undefined;
  const name = item.get('name');
  return typeof name === 'string' && name ? name : undefined;
}

/**
 * 确保 plugins.<adapterKey>.endpoints 存在并返回其 YAMLSeq（节点级操作，保留既有条目与注释）。
 * `plugins: []`（legacy 空列表，Runtime 忽略）可直接替换为 map；非空数组拒绝写入。
 */
function ensureEndpointsSeq(
  doc: ReturnType<typeof parseDocument>,
  adapterKey: string,
): YAMLSeq {
  const plugins = doc.get('plugins');
  if (isSeq(plugins) && plugins.items.length > 0) {
    throw new Error('配置的 plugins 是数组形态（legacy 插件名列表），请手动迁移为 map 后再试');
  }
  if (plugins !== undefined && !isMap(plugins) && !isSeq(plugins)) {
    throw new Error('配置的 plugins 字段形态异常，请手动检查 zhin.config.yml');
  }
  if (!isMap(doc.get('plugins'))) {
    // 注意：空对象 {} 不会被 doc.set 自动包装为 YAMLMap，必须显式 createNode
    doc.set('plugins', doc.createNode({}));
  }
  const adapterNode = doc.getIn(['plugins', adapterKey]);
  if (adapterNode !== undefined && !isMap(adapterNode)) {
    throw new Error(`配置的 plugins.${adapterKey} 字段形态异常，请手动检查 zhin.config.yml`);
  }
  if (!isMap(doc.getIn(['plugins', adapterKey]))) {
    doc.setIn(['plugins', adapterKey], doc.createNode({}));
  }
  const endpoints = doc.getIn(['plugins', adapterKey, 'endpoints']);
  if (endpoints !== undefined && !isSeq(endpoints)) {
    throw new Error(`配置的 plugins.${adapterKey}.endpoints 字段形态异常，请手动检查 zhin.config.yml`);
  }
  if (!isSeq(doc.getIn(['plugins', adapterKey, 'endpoints']))) {
    doc.setIn(['plugins', adapterKey, 'endpoints'], doc.createNode([]));
  }
  return doc.getIn(['plugins', adapterKey, 'endpoints']) as YAMLSeq;
}

/** 追加 endpoint 到 plugins.<adapterKey>.endpoints；name 已存在时报错 */
export function addEndpointToConfig(
  adapterKey: string,
  entry: ConfiguredEndpointEntry,
  projectRoot?: string,
): string {
  const document = readConfigDocument(adapterKey, projectRoot);
  const seq = ensureEndpointsSeq(document.doc, adapterKey);
  if (seq.items.some((item) => entryName(item) === entry.name)) {
    throw new Error(`配置中已存在 ${adapterKey} endpoint「${entry.name}」，可先 ${adapterKey}.endpoint remove ${entry.name} 再重新添加`);
  }
  seq.items.push(document.doc.createNode(entry));
  writeConfigDocument(document);
  return document.filePath;
}

/** 按 name 移除 plugins.<adapterKey>.endpoints 项；不存在返回 false */
export function removeEndpointFromConfig(
  adapterKey: string,
  name: string,
  projectRoot?: string,
): { removed: boolean; filePath: string } {
  const document = readConfigDocument(adapterKey, projectRoot);
  const seq = ensureEndpointsSeq(document.doc, adapterKey);
  const next = seq.items.filter((item) => entryName(item) !== name);
  if (next.length === seq.items.length) {
    return { removed: false, filePath: document.filePath };
  }
  seq.items = next;
  writeConfigDocument(document);
  return { removed: true, filePath: document.filePath };
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
  /** 字段说明（用于用法提示） */
  readonly description?: string;
}

export type EndpointCommandUse = <T>(token: Token<T>) => T;

/** bindFlow 钩子上下文：接管 add 命令的自定义绑定流程（如 QQ 扫码）。 */
export interface EndpointBindFlowContext {
  /** 命令参数 name（未指定时为 undefined，流程可自行决定终名） */
  readonly name?: string;
  /** 向当前会话推送后续状态（二维码刷新 / 成功 / 失败） */
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
  readonly describeEntry?: (entry: ConfiguredEndpointEntry) => string;
  /** list 末尾的附加行（如 QQ 的进行中扫码提示）；返回 undefined 不加行 */
  readonly listFooter?: (use: EndpointCommandUse) => string | undefined;
  /** 自定义 add 流程（扫码绑定等）；提供时 add 命令忽略 kv 参数，交给钩子 */
  readonly bindFlow?: (context: EndpointBindFlowContext) => Promise<string> | string;
  /** add 命令描述覆盖 */
  readonly addDescription?: string;
}

/**
 * 命令定义的最小结构（与 @zhin.js/command 的 CommandDefinition 结构兼容）。
 * provider 层不允许 import @zhin.js/command，故 defineCommand 由调用方注入，
 * 这里只描述结构；适配器侧传入 defineCommand 后 TCommand 即 Readonly<CommandDefinition>。
 *
 * `params` 值域须与 CommandParameterValue 对齐（含 null / 结构化对象），
 * 否则注入的 defineCommand 会因 TS 逆变检查失败（TS2345）。
 */
export interface EndpointCommandContext {
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
    string | number | boolean | Readonly<Record<string, unknown>> | null
  >>;
  readonly use: EndpointCommandUse;
}

export interface EndpointCommandDefinition {
  readonly description?: string;
  execute(context: EndpointCommandContext): unknown;
}

export interface EndpointCommands<TCommand = EndpointCommandDefinition> {
  readonly list: TCommand;
  readonly add: TCommand;
  readonly remove: TCommand;
}

function endpointNameParam(params: Readonly<Record<string, unknown>>): string | undefined {
  const name = params.name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

/** list 文案：运行中 + 配置中两段，footer 可选。 */
export function formatEndpointList(
  spec: Pick<EndpointCommandsSpec, 'adapterKey' | 'adapterDisplayName' | 'describeEntry'>,
  source: {
    readonly running: Iterable<EndpointRunningInfo>;
    readonly configured: readonly ConfiguredEndpointEntry[];
    readonly footer?: string;
  },
): string {
  const running = [...source.running];
  const lines: string[] = [];
  lines.push(`【运行中的 ${spec.adapterDisplayName} endpoints】`);
  if (running.length === 0) {
    lines.push('  （无）');
  } else {
    for (const endpoint of running) {
      lines.push(endpoint.mode ? `  - ${endpoint.name}（${endpoint.mode}）` : `  - ${endpoint.name}`);
    }
  }
  lines.push(`【配置中的 ${spec.adapterDisplayName} endpoints】（zhin.config.yml → plugins.${spec.adapterKey}.endpoints）`);
  if (source.configured.length === 0) {
    lines.push('  （无）');
  } else {
    for (const entry of source.configured) {
      const detail = spec.describeEntry?.(entry);
      lines.push(detail ? `  - ${entry.name}（${detail}）` : `  - ${entry.name}`);
    }
  }
  if (source.footer) lines.push(source.footer);
  return lines.join('\n');
}

function addUsage(spec: EndpointCommandsSpec): string {
  const fields = spec.fields ?? [];
  const fieldText = fields.length === 0
    ? ''
    : `\n字段：${fields.map((field) => {
      const marks = [
        field.required ? '必填' : '',
        field.env ? '写入 .env' : '',
        field.description ?? '',
      ].filter(Boolean).join('，');
      return marks ? `${field.key}（${marks}）` : field.key;
    }).join('、')}`;
  return `用法：${spec.adapterKey}.endpoint add <name> <key=value...>${fieldText}`;
}

/** add（kv 模式）的完整业务逻辑：解析 kv → 凭据写 .env → 追加 yaml；返回回复文本。 */
export function addEndpointFromKeyValues(
  spec: EndpointCommandsSpec,
  name: string,
  args: readonly string[],
  projectRoot?: string,
): string {
  const fields = spec.fields ?? [];
  const known = new Map(fields.map((field) => [field.key, field]));
  const values = new Map<string, string>();
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) return `参数「${arg}」不是 key=value 形式。${addUsage(spec)}`;
    const key = arg.slice(0, eq);
    const value = arg.slice(eq + 1).trim();
    const field = known.get(key);
    if (!field) {
      return `未知字段「${key}」，可用字段：${fields.map((item) => item.key).join('、')}`;
    }
    if (!value) return `字段「${key}」的值不能为空`;
    values.set(key, value);
  }
  const missing = fields.filter((field) => field.required && !values.has(field.key));
  if (missing.length > 0) {
    return `缺少必填字段：${missing.map((field) => field.key).join('、')}。${addUsage(spec)}`;
  }
  const entry: ConfiguredEndpointEntry = { name };
  const envValues: Record<string, string> = {};
  for (const field of fields) {
    const value = values.get(field.key);
    if (value === undefined) continue;
    if (field.env) {
      const envKey = buildEndpointEnvKey(spec.adapterKey, name, field.key);
      envValues[envKey] = value;
      entry[field.key] = `\${${envKey}}`;
    } else {
      entry[field.key] = value;
    }
  }
  try {
    // 先写配置（重名等校验失败时不留孤儿 .env 键），再落 .env 凭据
    const filePath = addEndpointToConfig(spec.adapterKey, entry, projectRoot);
    if (Object.keys(envValues).length > 0) persistEndpointEnvValues(envValues, projectRoot);
    return (
      `✅ endpoint「${name}」已追加到 ${filePath} 的 plugins.${spec.adapterKey}.endpoints` +
      `${Object.keys(envValues).length > 0 ? '（凭据已写入 .env）' : ''}。\n` +
      '⚠️ 需重启 zhin 后新 endpoint 才会生效。'
    );
  } catch (error) {
    return `添加失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** remove 的完整业务逻辑：从 yaml 移除；返回回复文本。 */
export function removeEndpointByName(
  spec: Pick<EndpointCommandsSpec, 'adapterKey'>,
  name: string,
  projectRoot?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) return `用法：${spec.adapterKey}.endpoint remove <name>`;
  try {
    const { removed, filePath } = removeEndpointFromConfig(spec.adapterKey, trimmed, projectRoot);
    if (!removed) {
      return `配置中不存在 ${spec.adapterKey} endpoint「${trimmed}」（${filePath} → plugins.${spec.adapterKey}.endpoints）`;
    }
    return (
      `已从 ${filePath} 的 plugins.${spec.adapterKey}.endpoints 移除「${trimmed}」。\n` +
      '⚠️ 需重启 zhin 后生效（运行中的连接届时才会断开）；.env 中的凭据键未删除，可手动清理。'
    );
  } catch (error) {
    return `移除失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** 生成 `<adapter> endpoint` 的 list / add / remove 三个命令定义（见文件头接入步骤）。 */
export function createEndpointCommands<TCommand>(
  spec: EndpointCommandsSpec,
  defineCommand: (definition: EndpointCommandDefinition) => TCommand,
): EndpointCommands<TCommand> {
  const forbidden = endpointCommandForbidden(spec.adapterDisplayName);
  return Object.freeze({
    list: defineCommand({
      description: `列出 ${spec.adapterDisplayName} endpoints（运行中 + zhin.config.yml 配置）`,
      execute({ use }) {
        return formatEndpointList(spec, {
          running: spec.running?.(use) ?? [],
          configured: listConfiguredEndpoints(spec.adapterKey),
          footer: spec.listFooter?.(use),
        });
      },
    }),
    add: defineCommand({
      description: spec.addDescription
        ?? `手动添加 ${spec.adapterDisplayName} endpoint（凭据写入 .env 并追加到 zhin.config.yml，重启生效）`,
      execute({ config, input, params, args, use }) {
        if (!isEndpointOperator(config, input)) return forbidden;
        const name = endpointNameParam(params);
        if (spec.bindFlow) {
          return spec.bindFlow({
            name,
            reply: extractEndpointCommandReply(input),
            config,
            input,
            use,
          });
        }
        if (!name) return addUsage(spec);
        return addEndpointFromKeyValues(spec, name, args);
      },
    }),
    remove: defineCommand({
      description: `从 zhin.config.yml 的 plugins.${spec.adapterKey}.endpoints 移除指定 endpoint（重启生效）`,
      execute({ config, input, params }) {
        if (!isEndpointOperator(config, input)) return forbidden;
        return removeEndpointByName(spec, String(params.name ?? ''));
      },
    }),
  });
}
