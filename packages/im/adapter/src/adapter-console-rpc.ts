/**
 * Adapter Console RPC — 每个平台适配器 Console 页共享的服务端实现。
 *
 * 页面（`pages/index/index.ts`）只负责展示；这里把适配器原本只能在聊天命令里完成的
 * endpoint 管理（add / remove）和适配器自有的少量动作（如 QQ 扫码绑定）收拢成
 * `plugin.<pluginId>.*` Console RPC：
 *
 * - `status`：适配器标识、字段元数据、运行中 / 已配置 endpoint、可用动作与平台状态。
 * - `endpoint-add` / `endpoint-remove`：写 `plugins.<adapterKey>.endpoints`（凭据进 `.env`）。
 * - `actions`：适配器按需扩展的只读查询 / 有限动作；动作名只能用小写字母、数字和 `-`。
 *
 * 安全边界：
 * - 不返回原始错误、日志、聊天内容或密钥；`env` 字段只在配置里以 `${ENV}` 引用形式出现，
 *   其他字段标了 `secret` 的一律遮蔽。
 * - 读取、写入分别用 `<adapterKey>:read` / `<adapterKey>:write` 权限；页面和方法各自声明，
 *   非管理员令牌必须同时满足。
 * - 没有配置存储（例如单元测试 / 非 CLI 装配）时 `canAdd` / `canRemove` 为 false，页面隐藏写操作。
 */
import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcDefinition,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
  type Token,
} from '@zhin.js/plugin-runtime';
import {
  buildEndpointEnvKey,
  type EndpointRunningInfo,
} from './endpoint-commands.js';
import {
  EndpointConfigurationError,
  endpointConfigurationStoreToken,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
} from './endpoint-configuration.js';

/** 适配器 Console 页面里可编辑的字段；`env` 表示凭据写入 `.env`。 */
export interface AdapterConsoleField {
  readonly key: string;
  readonly required?: boolean;
  /** 凭据字段：写入 `.env`，配置里保存 `${ENV_KEY}` 引用。 */
  readonly env?: boolean;
  /** 非 env 字段也要遮蔽展示（例如 PEM 内容）。 */
  readonly secret?: boolean;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<string, string>>>;
  readonly placeholder?: string;
}

/** 适配器自有动作的输入字段（单一文本 / 密码输入）。 */
export interface AdapterConsoleActionField {
  readonly key: string;
  readonly label: string;
  readonly labelI18n?: Readonly<Partial<Record<string, string>>>;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly secret?: boolean;
}

/** 适配器自有动作的选择项；`value` 会放进 `{ value }` 传给处理器。 */
export interface AdapterConsoleActionOption {
  readonly value: string;
  readonly label: string;
  readonly labelI18n?: Readonly<Partial<Record<string, string>>>;
}

/** 动作返回给页面的小对象；不要放日志、聊天原文或密钥。 */
export interface AdapterConsoleActionResult {
  readonly message?: string;
  readonly tone?: 'ok' | 'error';
  readonly url?: string;
  readonly image?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * 适配器自有动作。`availableActions` 决定当前状态下页面展示哪些动作；
 * 动作本身仍注册在 RPC 里，调用时由处理器校验状态。
 */
export interface AdapterConsoleAction {
  readonly label: string;
  readonly labelI18n?: Readonly<Partial<Record<string, string>>>;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<string, string>>>;
  readonly confirm?: string;
  readonly fields?: readonly AdapterConsoleActionField[];
  readonly options?: readonly AdapterConsoleActionOption[];
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
  handler(input: PluginConsoleRpcInput): AdapterConsoleActionResult | PluginConsoleRpcJson | Promise<AdapterConsoleActionResult | PluginConsoleRpcJson>;
}

/** Token 读取面：Plugin setup 的 `context.resources` 满足它。 */
export interface AdapterConsoleResources {
  has<T>(token: Token<T>): boolean;
  use<T>(token: Token<T>): T;
}

export interface AdapterConsoleSpec {
  /** 实例 key（`zhin.config.yml` 的 `plugins.<key>`）。 */
  readonly adapterKey: string;
  readonly adapterDisplayName: string;
  /** Console Page 的 localName，默认 `index`。 */
  readonly page?: string;
  readonly fields?: readonly AdapterConsoleField[];
  readonly docsUrl?: string;
  readonly readPermission?: string;
  readonly writePermission?: string;
  /** 默认 true；没有配置存储时仍会降级为 false。 */
  readonly canAdd?: boolean;
  readonly canRemove?: boolean;
  /** endpoint id 校验（例如 ICQQ 只接受数字 UIN）。 */
  readonly idPattern?: RegExp;
  readonly idHint?: string;
  readonly idHintI18n?: Readonly<Partial<Record<string, string>>>;
  /** 运行中 endpoint 数据源；通常读 adapter runtime state。 */
  readonly running?: () => Iterable<EndpointRunningInfo>;
  /** 当前实例配置；没有配置存储时用于只读展示。 */
  readonly getConfig?: () => unknown;
  /** 页面展示的平台状态（只放少量、非敏感字段）。 */
  readonly extraStatus?: () => Readonly<Record<string, string | number | boolean>> | Promise<Readonly<Record<string, string | number | boolean>>>;
  /** 当前状态下页面应展示的动作名；默认全部。 */
  readonly availableActions?: (input: {
    readonly running: readonly EndpointRunningInfo[];
    readonly configured: readonly ConfiguredEndpointEntry[];
  }) => Iterable<string>;
  readonly actions?: Readonly<Record<string, AdapterConsoleAction>>;
}

interface StatusView {
  adapterKey: string;
  displayName: string;
  page: string;
  fields: AdapterConsoleFieldView[];
  canAdd: boolean;
  canRemove: boolean;
  configStore: boolean;
  running: { id: string; mode?: string }[];
  configured: { id: string; values: Record<string, string> }[];
  actions: AdapterConsoleActionView[];
  extra?: Record<string, string | number | boolean>;
  readPermission?: string;
  writePermission?: string;
  docsUrl?: string;
  idPattern?: string;
  idHint?: string;
  idHintI18n?: Record<string, string>;
}

interface AdapterConsoleFieldView {
  key: string;
  required: boolean;
  env: boolean;
  secret: boolean;
  description?: string;
  descriptionI18n?: Record<string, string>;
  placeholder?: string;
}

interface AdapterConsoleActionView {
  name: string;
  label: string;
  labelI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
  confirm?: string;
  fields: {
    key: string;
    label: string;
    labelI18n?: Record<string, string>;
    required: boolean;
    placeholder?: string;
    secret: boolean;
  }[];
  options: { value: string; label: string; labelI18n?: Record<string, string> }[];
}

const ACTION_NAME = /^[a-z0-9][a-z0-9-]*$/;
const ENV_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/** 过滤掉 i18n 里的 undefined，保证返回值是纯 JSON 对象。 */
function stringsI18n(input: Readonly<Partial<Record<string, string>>> | undefined): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value) output[key] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/**
 * 创建适配器 Console RPC。每个适配器在 `plugin.ts` 的 `setup` 里调用一次，
 * 并 `context.resources.provide(pluginConsoleRpcToken, rpc)`。
 */
export function createAdapterConsoleRpc(
  spec: AdapterConsoleSpec,
  resources: AdapterConsoleResources,
): PluginConsoleRpc {
  if (!spec.adapterKey) throw new TypeError('Adapter console RPC requires an adapterKey');
  const page = spec.page ?? 'index';
  if (!/^[a-z][a-z0-9-]*$/.test(page)) throw new TypeError(`Invalid page name: ${page}`);
  const readPermission = spec.readPermission;
  const writePermission = spec.writePermission;
  const store: EndpointConfigurationStore | undefined = resources.has(endpointConfigurationStoreToken)
    ? resources.use(endpointConfigurationStoreToken)
    : undefined;
  const fields = spec.fields ?? [];
  const writePermissions = writePermission ? [writePermission] : undefined;
  const actions = spec.actions ?? {};

  for (const name of Object.keys(actions)) {
    if (!ACTION_NAME.test(name)) throw new TypeError(`Invalid adapter console action: ${name}`);
    if (name === 'status' || name === 'endpoint-add' || name === 'endpoint-remove') {
      throw new TypeError(`Reserved adapter console action: ${name}`);
    }
  }

  const definition: PluginConsoleRpcDefinition = {
    status: {
      page,
      ...(readPermission ? { requiredPermissions: [readPermission] } : {}),
      handler: async () => statusView() as unknown as PluginConsoleRpcJson,
    },
  };

  const methods: Record<string, {
    page: string;
    requiredPermissions?: readonly string[];
    requiredRoles?: readonly string[];
    handler: (input: PluginConsoleRpcInput) => Promise<PluginConsoleRpcJson>;
  }> = {};

  if (store && spec.canAdd !== false) {
    methods['endpoint-add'] = {
      page,
      ...(writePermissions ? { requiredPermissions: writePermissions } : {}),
      handler: async (input) => addEndpoint(input),
    };
  }
  if (store && spec.canRemove !== false) {
    methods['endpoint-remove'] = {
      page,
      ...(writePermissions ? { requiredPermissions: writePermissions } : {}),
      handler: async (input) => removeEndpoint(input),
    };
  }

  for (const [name, action] of Object.entries(actions)) {
    methods[name] = {
      page,
      requiredPermissions: action.requiredPermissions ?? writePermissions,
      ...(action.requiredRoles ? { requiredRoles: action.requiredRoles } : {}),
      handler: async (input) => normalizeActionOutput(await action.handler(input)),
    };
  }

  return definePluginConsoleRpc({ ...definition, actions: methods });
  async function statusView(): Promise<StatusView> {
    const running = listRunning();
    const configured = await listConfigured();
    const names = new Set(
      [...(spec.availableActions
        ? spec.availableActions({ running, configured })
        : Object.keys(actions))],
    );
    const extra = await readExtra();
    const view: StatusView = {
      adapterKey: spec.adapterKey,
      displayName: spec.adapterDisplayName,
      page,
      fields: fields.map(fieldView),
      canAdd: Boolean(store) && spec.canAdd !== false,
      canRemove: Boolean(store) && spec.canRemove !== false,
      configStore: Boolean(store),
      running: running.map((endpoint) => ({
        id: endpoint.id,
        ...(endpoint.mode ? { mode: endpoint.mode } : {}),
      })),
      configured: configured.map((entry) => ({
        id: String(entry.id),
        values: entryValues(entry),
      })),
      actions: Object.entries(actions)
        .filter(([name]) => names.has(name))
        .map(([name, action]) => actionView(name, action)),
      ...(extra ? { extra } : {}),
    };
    if (readPermission) view.readPermission = readPermission;
    if (writePermission) view.writePermission = writePermission;
    if (spec.docsUrl) view.docsUrl = spec.docsUrl;
    if (spec.idPattern) view.idPattern = spec.idPattern.source;
    if (spec.idHint) view.idHint = spec.idHint;
    if (spec.idHintI18n) view.idHintI18n = stringsI18n(spec.idHintI18n);
    return view;
  }

  function listRunning(): EndpointRunningInfo[] {
    if (!spec.running) return [];
    try {
      return [...spec.running()];
    } catch {
      return [];
    }
  }

  async function listConfigured(): Promise<readonly ConfiguredEndpointEntry[]> {
    if (store) {
      try {
        return await store.list(spec.adapterKey);
      } catch {
        return [];
      }
    }
    return configuredFromConfig(spec.getConfig?.());
  }

  /** 没有配置存储时只读展示配置里的 endpoint id 与可安全展示的字段。 */
  function configuredFromConfig(config: unknown): ConfiguredEndpointEntry[] {
    if (!config || typeof config !== 'object') return [];
    const record = config as Record<string, unknown>;
    const endpoints = Array.isArray(record.endpoints) ? record.endpoints : [];
    if (endpoints.length > 0) {
      return endpoints.filter((entry): entry is ConfiguredEndpointEntry =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string');
    }
    if (typeof record.id === 'string' && record.id) {
      return [record as unknown as ConfiguredEndpointEntry];
    }
    return [];
  }

  function entryValues(entry: ConfiguredEndpointEntry): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const raw = entry[field.key];
      if (raw === undefined || raw === null) continue;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (!text) continue;
      if (field.env) {
        values[field.key] = ENV_REFERENCE.test(text) ? text : '••••••';
      } else if (field.secret) {
        values[field.key] = '••••••';
      } else {
        values[field.key] = text;
      }
    }
    return values;
  }

  async function readExtra(): Promise<Record<string, string | number | boolean> | undefined> {
    if (!spec.extraStatus) return undefined;
    try {
      const value = await spec.extraStatus();
      if (!value || typeof value !== 'object') return undefined;
      const output: Record<string, string | number | boolean> = {};
      for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
          output[key] = raw;
        }
      }
      return Object.keys(output).length > 0 ? output : undefined;
    } catch {
      return undefined;
    }
  }

  async function addEndpoint(input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
    if (!store) throw new PluginConsoleRpcError('unsupported', '当前运行环境不支持写入 endpoint 配置');
    const id = requireId(input.id);
    const values = input.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new PluginConsoleRpcError('invalid_input', '缺少 endpoint 字段');
    }
    const record = values as Record<string, unknown>;
    const known = new Map(fields.map((field) => [field.key, field]));
    const entry: Record<string, unknown> = { id };
    const environment: Record<string, string> = {};
    for (const [key, raw] of Object.entries(record)) {
      const field = known.get(key);
      if (!field) throw new PluginConsoleRpcError('invalid_input', `未知字段：${key}`);
      if (typeof raw !== 'string') throw new PluginConsoleRpcError('invalid_input', `字段 ${key} 必须是字符串`);
      const value = raw.trim();
      if (!value) continue;
      if (field.env) {
        const envKey = buildEndpointEnvKey(spec.adapterKey, id, field.key);
        environment[envKey] = value;
        entry[field.key] = `\${${envKey}}`;
      } else {
        entry[field.key] = value;
      }
    }
    const missing = fields.filter((field) => field.required && entry[field.key] === undefined);
    if (missing.length > 0) {
      throw new PluginConsoleRpcError('invalid_input', `缺少必填字段：${missing.map((field) => field.key).join('、')}`);
    }
    try {
      await store.add({ adapterKey: spec.adapterKey, entry: entry as ConfiguredEndpointEntry, environment });
    } catch (error) {
      if (error instanceof EndpointConfigurationError && error.code === 'duplicate_entry') {
        throw new PluginConsoleRpcError('conflict', `endpoint「${id}」已经存在，请先删除或换一个 id`);
      }
      throw new PluginConsoleRpcError('unavailable', '写入配置失败，请检查配置文件和 .env 的权限');
    }
    return {
      id,
      message: `已写入 endpoint「${id}」；重启或热重载后生效`,
      restartRequired: true,
    };
  }

  async function removeEndpoint(input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
    if (!store) throw new PluginConsoleRpcError('unsupported', '当前运行环境不支持写入 endpoint 配置');
    const id = requireId(input.id);
    let removed: boolean;
    try {
      removed = (await store.remove(spec.adapterKey, id)).removed;
    } catch {
      throw new PluginConsoleRpcError('unavailable', '删除配置失败，请检查配置文件的权限');
    }
    if (!removed) throw new PluginConsoleRpcError('not_found', `配置里没有 endpoint「${id}」`);
    return { id, removed, message: `已从配置中删除 endpoint「${id}」`, restartRequired: true };
  }

  function requireId(raw: unknown): string {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) throw new PluginConsoleRpcError('invalid_input', '请填写 endpoint id');
    if (id.length > 128) throw new PluginConsoleRpcError('invalid_input', 'endpoint id 过长');
    if (spec.idPattern && !spec.idPattern.test(id)) {
      throw new PluginConsoleRpcError('invalid_input', spec.idHint ?? 'endpoint id 格式不正确');
    }
    return id;
  }

  function fieldView(field: AdapterConsoleField): AdapterConsoleFieldView {
    const descriptionI18n = stringsI18n(field.descriptionI18n);
    return {
      key: field.key,
      required: field.required === true,
      env: field.env === true,
      secret: field.secret === true || field.env === true,
      ...(field.description ? { description: field.description } : {}),
      ...(descriptionI18n ? { descriptionI18n } : {}),
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    };
  }

  function actionView(name: string, action: AdapterConsoleAction): AdapterConsoleActionView {
    const labelI18n = stringsI18n(action.labelI18n);
    const descriptionI18n = stringsI18n(action.descriptionI18n);
    return {
      name,
      label: action.label,
      ...(labelI18n ? { labelI18n } : {}),
      ...(action.description ? { description: action.description } : {}),
      ...(descriptionI18n ? { descriptionI18n } : {}),
      ...(action.confirm ? { confirm: action.confirm } : {}),
      fields: (action.fields ?? []).map((field) => {
        const fieldI18n = stringsI18n(field.labelI18n);
        return {
          key: field.key,
          label: field.label,
          ...(fieldI18n ? { labelI18n: fieldI18n } : {}),
          required: field.required === true,
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          secret: field.secret === true,
        };
      }),
      options: (action.options ?? []).map((option) => {
        const optionI18n = stringsI18n(option.labelI18n);
        return {
          value: option.value,
          label: option.label,
          ...(optionI18n ? { labelI18n: optionI18n } : {}),
        };
      }),
    };
  }

  function normalizeActionOutput(value: AdapterConsoleActionResult | PluginConsoleRpcJson): PluginConsoleRpcJson {
    if (typeof value === 'string') return { message: value };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PluginConsoleRpcError('unavailable', '操作没有返回结果');
    }
    return value as PluginConsoleRpcJson;
  }
}
