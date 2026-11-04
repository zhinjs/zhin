import { redactConfigurationUrl } from './configuration-metadata.js';
import { readConfigurationPath } from './configuration-fields.js';
/**
 * Adapter Console RPC — 每个平台适配器 Console 页共享的服务端实现。
 *
 * 页面（`pages/index/index.ts`）只负责展示；这里把适配器原本只能在聊天命令里完成的
 * endpoint 管理和适配器自有的少量动作（如 QQ 扫码绑定）收拢成
 * `plugin.<pluginId>.*` Console RPC：
 *
 * - `status`：适配器标识、字段元数据、运行中 / 已配置 endpoint、可用动作与平台状态。
 * - Runtime 管理入口将 add/update/start/stop/remove/replace 委派给 exact-owned Adapter，
 *   通过私有 repository CAS 保存，不写启动配置或 `.env`，不重建 Root。
 * - 缺少 runtime 目录时仅展示安全配置视图；账号写入明确不可用。
 * - `actions`：适配器按需扩展的只读查询 / 有限动作；动作名只能用小写字母、数字和 `-`。
 *
 * 安全边界：
 * - 不返回原始错误、日志、聊天内容或密钥；`env` / `secret` 字段在管理清单一律遮蔽。
 * - 读取、写入分别用 `<adapterKey>:read` / `<adapterKey>:write` 权限；页面和方法各自声明，
 *   非管理员令牌必须同时满足。
 * - 没有持久化账号目录时 `canAdd` / `canRemove` 为 false，页面隐藏写操作。
 */
import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcDefinition,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcJson,
  type Token,
} from '@zhin.js/plugin-runtime';
import type { EndpointRunningInfo } from './endpoint-commands.js';
import {
  type ConfiguredEndpointEntry,
} from './endpoint-configuration.js';
import { consoleRuntimeView, mutateConsoleAdapter, ownedConsoleAdapter, type AdapterConsoleRuntimeView } from './adapter-runtime-console.js';
export type { AdapterConsoleRuntimeView } from './adapter-runtime-console.js';

/** 适配器 Console 页面字段；`env` 和 `secret` 都声明需要遮蔽的敏感字段。 */
export interface AdapterConsoleField {
  readonly key: string;
  readonly type?: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  /** 凭据字段；由所属 Adapter 保存到 Host 私有持久库。 */
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
  /** Uses the same runtime account revision and first-migration admission as standard account mutations. */
  readonly accountMutation?: boolean;
  readonly label: string;
  readonly labelI18n?: Readonly<Partial<Record<string, string>>>;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Partial<Record<string, string>>>;
  readonly confirm?: string;
  readonly fields?: readonly AdapterConsoleActionField[];
  readonly options?: readonly AdapterConsoleActionOption[];
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
  handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): AdapterConsoleActionResult | PluginConsoleRpcJson | Promise<AdapterConsoleActionResult | PluginConsoleRpcJson>;
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
  /** 无 runtime 目录的独立只读状态来源；Host 管理页始终使用所属 Adapter 目录。 */
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
  configured: { id: string; instanceId?: string; values: Record<string, string> }[];
  runtime?: AdapterConsoleRuntimeView;
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
  type?: 'string' | 'number' | 'boolean';
  required: boolean;
  env: boolean;
  secret: boolean;
  description?: string;
  descriptionI18n?: Record<string, string>;
  placeholder?: string;
}

interface AdapterConsoleActionView {
  name: string;
  accountMutation?: boolean;
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
): PluginConsoleRpc {
  if (!spec.adapterKey) throw new TypeError('Adapter console RPC requires an adapterKey');
  const page = spec.page ?? 'index';
  if (!/^[a-z][a-z0-9-]*$/.test(page)) throw new TypeError(`Invalid page name: ${page}`);
  const readPermission = spec.readPermission;
  const writePermission = spec.writePermission;
  const fields = spec.fields ?? [];
  const writePermissions = writePermission ? [writePermission] : undefined;
  const actions = spec.actions ?? {};

  for (const name of Object.keys(actions)) {
    if (!ACTION_NAME.test(name)) throw new TypeError(`Invalid adapter console action: ${name}`);
    if (name === 'status' || ['endpoint-add', 'endpoint-update', 'endpoint-start', 'endpoint-stop', 'endpoint-remove', 'endpoint-replace'].includes(name)) {
      throw new TypeError(`Reserved adapter console action: ${name}`);
    }
  }

  const definition: PluginConsoleRpcDefinition = {
    status: {
      page,
      ...(readPermission ? { requiredPermissions: [readPermission] } : {}),
      handler: async (_input, call) => statusView(call) as unknown as PluginConsoleRpcJson,
    },
  };

  const methods: Record<string, {
    page: string;
    requiredPermissions?: readonly string[];
    requiredRoles?: readonly string[];
    handler: (input: PluginConsoleRpcInput, call: PluginConsoleRpcCall) => Promise<PluginConsoleRpcJson>;
  }> = {};

  if (spec.canAdd !== false) {
    methods['endpoint-add'] = {
      page,
      ...(writePermissions ? { requiredPermissions: writePermissions } : {}),
      handler: async (input, call) => mutateConsoleAdapter(spec, call, 'add', input),
    };
  }
  if (spec.canRemove !== false) {
    methods['endpoint-remove'] = {
      page,
      ...(writePermissions ? { requiredPermissions: writePermissions } : {}),
      handler: async (input, call) => mutateConsoleAdapter(spec, call, 'remove', input),
    };
  }
  for (const action of ['update', 'start', 'stop', 'replace'] as const) {
    methods[`endpoint-${action}`] = {
      page, ...(writePermissions ? { requiredPermissions: writePermissions } : {}),
      handler: async (input, call) => mutateConsoleAdapter(spec, call, action, input),
    };
  }

  for (const [name, action] of Object.entries(actions)) {
    methods[name] = {
      page,
      requiredPermissions: action.requiredPermissions ?? writePermissions,
      ...(action.requiredRoles ? { requiredRoles: action.requiredRoles } : {}),
      handler: async (input, call) => normalizeActionOutput(await action.handler(input, call)),
    };
  }

  return definePluginConsoleRpc({ ...definition, actions: methods });
  async function statusView(call: PluginConsoleRpcCall): Promise<StatusView> {
    const adapter = call.runtime ? ownedConsoleAdapter(spec, call) : undefined;
    if (adapter) {
      try { await adapter.verifyPendingCommit(); }
      catch { throw new PluginConsoleRpcError('commit_unknown', '提交结果尚未核实，请刷新状态，勿重复提交'); }
    }
    const runtime = adapter ? consoleRuntimeView(spec, call, adapter) : undefined;
    const runtimeConfigured = adapter?.configurationView(fields);
    const running: EndpointRunningInfo[] = adapter ? adapter.list().filter(entry => entry.started).map(entry => ({ id: entry.endpointId })) : listRunning();
    const configured = runtimeConfigured ? runtimeConfigured.map(entry => ({ id: entry.id, ...entry.values })) : await listConfigured();
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
      canAdd: Boolean(adapter?.canManage) && spec.canAdd !== false,
      canRemove: Boolean(adapter?.canManage) && spec.canRemove !== false,
      configStore: Boolean(adapter?.canManage),
      running: running.map((endpoint) => ({
        id: endpoint.id,
        ...(endpoint.mode ? { mode: endpoint.mode } : {}),
      })),
      configured: runtimeConfigured ? runtimeConfigured.map(entry => ({ id: entry.id, instanceId: entry.instanceId, values: { ...entry.values } })) : configured.map((entry) => ({
        id: String(entry.id),
        values: entryValues(entry),
      })),
      actions: Object.entries(actions)
        .filter(([name]) => names.has(name))
        .map(([name, action]) => actionView(name, action)),
      ...(extra ? { extra } : {}),
      ...(runtime ? { runtime } : {}),
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
      const raw = readConfigurationPath(entry, field.key);
      if (raw === undefined || raw === null) continue;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (!text) continue;
      if (field.env) {
        values[field.key] = ENV_REFERENCE.test(text) ? text : '••••••';
      } else if (field.secret) {
        values[field.key] = '••••••';
      } else {
        values[field.key] = redactConfigurationUrl(field.key, text);
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

  function fieldView(field: AdapterConsoleField): AdapterConsoleFieldView {
    const descriptionI18n = stringsI18n(field.descriptionI18n);
    return {
      key: field.key,
      ...(field.type ? { type: field.type } : {}),
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
      ...(action.accountMutation ? { accountMutation: true } : {}),
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
