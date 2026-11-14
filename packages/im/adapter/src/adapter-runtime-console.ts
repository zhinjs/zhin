import { writeConfigurationPath } from './configuration-fields.js';
import { PluginConsoleRpcError, type PluginConsoleRpcCall, type PluginConsoleRpcInput, type PluginConsoleRpcJson } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from './provider.js';
import { isOwnedAdapterDirectory } from './adapter-index.js';
import { AdapterManagementError, type EndpointExecution, type EndpointMetadata } from './adapter-types.js';
import type { AdapterInstance } from './adapter.js';
import type { AdapterConsoleSpec } from './adapter-console-rpc.js';

export interface AdapterConsoleRuntimeView {
  readonly adapterId: string;
  readonly generation: number;
  readonly revision: number | null;
  readonly needsMigration: boolean;
  readonly canManage: boolean;
  readonly canMigrate: boolean;
  readonly canUpdate: boolean;
  readonly canReplace: boolean;
  readonly mutableFields: readonly string[];
  readonly identityFields: readonly string[];
  readonly endpoints: readonly EndpointMetadata[];
  readonly lastMutation?: EndpointExecution;
}

export type AdapterConsoleMutation = 'add' | 'update' | 'start' | 'stop' | 'remove' | 'replace' | 'import';
/** Account methods that act on the configuration file rather than the persisted directory. */
export type AdapterConsoleConfigAction = 'writeback';

/** Selection only from a Host-granted owner directory, never a Root snapshot or latest lookup. */
export function ownedConsoleAdapter(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall): AdapterInstance {
  const runtime = call.runtime;
  if (!runtime) throw new PluginConsoleRpcError('unsupported', '此入口未绑定账号运行目录');
  const directory = runtime.project(adapterFeatureId);
  if (!isOwnedAdapterDirectory(directory) || directory.owner !== runtime.owner) {
    throw new PluginConsoleRpcError('unavailable', '账号目录与插件所有权不匹配');
  }
  const owned = directory.adapters().filter(adapter => adapter.descriptor.owner === runtime.owner);
  const matching = owned.filter(adapter => adapter.descriptor.name === spec.adapterKey);
  const selected = matching.length === 1 ? matching[0] : owned.length === 1 ? owned[0] : undefined;
  if (!selected) throw new PluginConsoleRpcError('unavailable', '无法唯一确定此插件所属的 Adapter');
  return selected;
}

export function consoleRuntimeView(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall, adapter = ownedConsoleAdapter(spec, call)): AdapterConsoleRuntimeView {
  if (!call.runtime) throw new PluginConsoleRpcError('unsupported', '账号运行目录不可用');
  const knownFields = new Set((spec.fields ?? []).map(field => field.key));
  const mutableFields = (adapter.configurationUpdateFields ?? []).filter(field => knownFields.has(field));
  const identityFields = adapter.configurationIdentityFields ?? [];
  return Object.freeze({
    adapterId: adapter.descriptor.id, generation: call.runtime.generation, revision: adapter.revision,
    needsMigration: adapter.needsMigration, canManage: adapter.canManage,
    canMigrate: adapter.needsMigration && adapter.canManage && call.runtime.operator,
    canUpdate: adapter.canManage && mutableFields.length > 0,
    canReplace: adapter.canManage && identityFields.length > 0 && spec.canAdd !== false && spec.canRemove !== false,
    mutableFields: Object.freeze([...mutableFields]), identityFields: Object.freeze([...identityFields]),
    endpoints: adapter.runtimeStatus(), ...(adapter.lastMutation ? { lastMutation: adapter.lastMutation } : {}),
  });
}

/** Common admission for typed platform actions such as a verified QR account binding. */
export function prepareConsoleAdapterMutation(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall,
  input: PluginConsoleRpcInput) {
  const adapter = ownedConsoleAdapter(spec, call);
  const runtime = call.runtime;
  if (!runtime || !adapter.canManage) throw new PluginConsoleRpcError('unsupported', '此环境不支持持久化账号管理');
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration !== runtime.generation) {
    throw new PluginConsoleRpcError('conflict', '运行代次已变化，请刷新账号清单');
  }
  const revision = input.expectedRevision;
  if (!Object.hasOwn(input, 'expectedRevision') || !(revision === null || (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0))) {
    throw new PluginConsoleRpcError('invalid_input', '需要 expectedRevision（null 或整数）');
  }
  if (revision !== adapter.revision) throw new PluginConsoleRpcError('conflict', '账号配置已变化，请刷新清单');
  if (adapter.needsMigration) {
    if (!runtime.operator) throw new PluginConsoleRpcError('forbidden', '首次迁移需要管理员确认');
    if (input.confirmMigration !== true) throw new PluginConsoleRpcError('conflict', '请先确认迁移当前账号清单；将保留原身份和历史');
  }
  call.signal.throwIfAborted();
  const options = { signal: call.signal, waitForExecution: false, beforeCommit: () => { call.signal.throwIfAborted(); call.commitStarted?.(); } };
  return { adapter, revision, options };
}

export async function mutateConsoleAdapter(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall, action: AdapterConsoleMutation,
  input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
  if (action === 'import') {
    // `expectedGeneration` may be omitted (the current generation); `expectedRevision` may not: an
    // import overwrites a saved account, so the caller must name the account list it looked at.
    if (!Object.hasOwn(input, 'expectedRevision')) {
      throw new PluginConsoleRpcError('invalid_input', '导入需要 expectedRevision（刷新账号清单后使用其中的 revision）');
    }
    input = { ...input,
      ...(input.expectedGeneration === undefined && call.runtime ? { expectedGeneration: call.runtime.generation } : {}) };
  }
  const { adapter, revision, options } = prepareConsoleAdapterMutation(spec, call, input);
  try {
    let result;
    if (action === 'add') {
      if (spec.canAdd === false) throw new PluginConsoleRpcError('unsupported', '此 Adapter 不支持新增账号');
      const id = requireRuntimeId(spec, input.id);
      result = await adapter.add(revision, { endpointId: id, config: accountConfiguration(id, runtimeValues(spec, input.values, false)) }, options);
    } else if (action === 'import') {
      if (typeof input.id !== 'string' || !input.id.trim()) throw new PluginConsoleRpcError('invalid_input', '需要账号 id');
      if (input.start !== undefined && typeof input.start !== 'boolean') throw new PluginConsoleRpcError('invalid_input', 'start 必须是布尔值');
      result = await adapter.importConfigured(input.id.trim(), revision, { ...options, start: input.start === true });
    } else {
      const target = runtimeTarget(adapter, input, action === 'replace');
      switch (action) {
        case 'update': {
          const patch = runtimeValues(spec, input.values, true);
          result = await adapter.patchConfiguration(target.instanceId, revision, patch, options);
          break;
        }
        case 'replace': {
          if (spec.canAdd === false || spec.canRemove === false) throw new PluginConsoleRpcError('unsupported', '此 Adapter 不支持替换账号');
          if (!adapter.configurationIdentityFields?.length) throw new PluginConsoleRpcError('unsupported', '平台尚未声明账号身份替换合同');
          const id = requireRuntimeId(spec, input.id);
          result = await adapter.replace(target.instanceId, revision, { endpointId: id, config: accountConfiguration(id, runtimeValues(spec, input.values, false)) }, options);
          break;
        }
        case 'start': result = await adapter.start(target.instanceId, revision, options); break;
        case 'stop': result = await adapter.stop(target.instanceId, revision, options); break;
        case 'remove': {
          if (spec.canRemove === false) throw new PluginConsoleRpcError('unsupported', '此 Adapter 不支持删除账号');
          result = await adapter.remove(target.instanceId, revision, options); break;
        }
      }
    }
    return { saved: true, restartRequired: false, execution: { ...result.execution },
      ...(result.operation ? { operation: { ...result.operation } } : {}),
      runtime: consoleRuntimeView(spec, call, adapter) as unknown as PluginConsoleRpcJson,
      message: action === 'add' || action === 'replace' ? '账号配置已保存，尚未启动'
        : action === 'import' ? (input.start === true ? '已从配置文件导入账号并开始启动' : '已从配置文件导入账号，尚未启动')
          : '账号期望状态已保存，请查看运行状态',
    };
  } catch (error) {
    throw consoleAccountError(error, action === 'import');
  }
}

/** Fixed, credential-free texts for account failures; conflicts name the CAS that failed. */
function consoleAccountError(error: unknown, configuration = false): PluginConsoleRpcError {
  if (error instanceof PluginConsoleRpcError) return error;
  if (error instanceof AdapterManagementError) {
    const code = error.code === 'duplicate_entry' || error.code === 'conflict' || error.code === 'closed' ? 'conflict'
      : error.code === 'not_found' ? 'not_found' : error.code === 'invalid_configuration' ? 'invalid_input'
        : error.code === 'unsupported' ? 'unsupported' : error.code === 'commit_unknown' ? 'commit_unknown' : 'unavailable';
    const message = code === 'commit_unknown' ? '提交结果未知，请刷新状态，勿重复提交'
      : code === 'conflict' ? (configuration ? '账号或配置文件已被其他操作修改，请刷新后重试' : '账号配置已变化，请刷新清单')
        : code === 'not_found' && configuration ? '配置文件或已保存账号中没有该账号'
          : code === 'unsupported' && configuration ? '此账号不能按这种方式导入或写回（单账号写法或列表中的 ${VAR} 引用）'
            : '账号操作未能完成，请检查输入并刷新状态';
    return new PluginConsoleRpcError(code, message);
  }
  return new PluginConsoleRpcError('commit_unknown', '提交结果尚未确认，请刷新状态，勿重复提交');
}

function sensitiveFields(spec: AdapterConsoleSpec): string[] {
  return (spec.fields ?? []).filter(field => field.env || field.secret).map(field => field.key);
}

/** `endpoint-drift`: configuration file accounts versus persisted accounts (ids and paths only). */
export async function consoleConfigDrift(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
  const adapter = ownedConsoleAdapter(spec, call);
  try {
    const drift = await adapter.configDrift({ signal: call.signal, sensitiveFields: sensitiveFields(spec) });
    return JSON.parse(JSON.stringify({
      ...drift, generation: call.runtime?.generation ?? null,
      canImport: adapter.canManage && drift.authority === 'snapshot',
      canWriteback: adapter.canManage && drift.authority === 'snapshot',
    })) as PluginConsoleRpcJson;
  } catch (error) {
    throw consoleAccountError(error, true);
  }
}

/** `endpoint-writeback { ids }`: persisted accounts into `zhin.config.yml`; credentials only as `${VAR}`. */
export async function consoleConfigWriteback(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall,
  input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
  const adapter = ownedConsoleAdapter(spec, call);
  const runtime = call.runtime;
  if (!runtime || !adapter.canManage) throw new PluginConsoleRpcError('unsupported', '此环境不支持持久化账号管理');
  if (input.expectedGeneration !== undefined && input.expectedGeneration !== runtime.generation) {
    throw new PluginConsoleRpcError('conflict', '运行代次已变化，请刷新账号清单');
  }
  const ids = input.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 64 || ids.some(id => typeof id !== 'string' || !id.trim())) {
    throw new PluginConsoleRpcError('invalid_input', 'ids 需要 1-64 个账号 id');
  }
  call.signal.throwIfAborted();
  try {
    // The file write may cross its save boundary even if this call then times out.
    call.commitStarted?.();
    const result = await adapter.writeBackConfigured(ids.map(id => (id as string).trim()),
      { signal: call.signal, sensitiveFields: sensitiveFields(spec) });
    // Rewriting `<instance>.endpoints` reloads that plugin instance: every account of this Adapter
    // instance reconnects, not only the written ones.
    const reconnect = '该 Adapter 实例的全部账号会随配置重载重新连接';
    return JSON.parse(JSON.stringify({ saved: true, ...result, reconnectsAll: true,
      message: result.placeholders.length
        ? `已写回配置文件，${reconnect}；请在 .env 中设置 ${result.placeholders.map(item => item.variable).join('、')}`
        : `已写回配置文件，${reconnect}` })) as PluginConsoleRpcJson;
  } catch (error) {
    throw consoleAccountError(error, true);
  }
}

/**
 * The account an `endpoint-<action>` call acts on, resolved exactly like {@link mutateConsoleAdapter}
 * selects it (`instanceId` first, else `id`; `add` / `replace` name no existing account for scoping).
 * The Host authorizes against this before calling the handler. `undefined`: adapter-level target.
 * Throws `invalid_input` when `id` and `instanceId` are both present and disagree.
 */
export function consoleAccountTarget(adapters: readonly AdapterInstance[], action: AdapterConsoleMutation | AdapterConsoleConfigAction,
  input: PluginConsoleRpcInput): string | undefined {
  if (action === 'add' || action === 'replace' || action === 'writeback') return undefined;
  if (action === 'import') {
    // Importing over a saved account acts on that account; importing a new one adds an account,
    // which (like `add`) needs the adapter level — an endpoint binding never covers a new account.
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) return undefined;
    return adapters.some(adapter => adapter.list().some(entry => entry.endpointId === id)) ? id : undefined;
  }
  if (typeof input.instanceId === 'string' && input.instanceId) {
    const selected = adapters.flatMap(adapter => adapter.list()).find(entry => entry.instanceId === input.instanceId);
    if (!selected) return undefined;
    if (input.id !== undefined && input.id !== selected.endpointId) throw new PluginConsoleRpcError('invalid_input', '账号实例与 id 不匹配');
    return selected.endpointId;
  }
  return typeof input.id === 'string' ? input.id : undefined;
}

function runtimeTarget(adapter: AdapterInstance, input: PluginConsoleRpcInput, replacing: boolean): EndpointMetadata {
  const entries = adapter.list();
  if (typeof input.instanceId === 'string' && input.instanceId) {
    const selected = entries.find(entry => entry.instanceId === input.instanceId);
    if (!selected) throw new PluginConsoleRpcError('not_found', '此 Adapter 没有该账号实例');
    if (!replacing && input.id !== undefined && input.id !== selected.endpointId) throw new PluginConsoleRpcError('invalid_input', '账号实例与 id 不匹配');
    return selected;
  }
  if (!replacing && typeof input.id === 'string') {
    const matches = entries.filter(entry => entry.endpointId === input.id);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) throw new PluginConsoleRpcError('not_found', '此 Adapter 没有该账号');
  }
  throw new PluginConsoleRpcError('invalid_input', '需要明确的账号 instanceId');
}

function requireRuntimeId(spec: AdapterConsoleSpec, raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id.length > 128 || (spec.idPattern && !spec.idPattern.test(id))) {
    throw new PluginConsoleRpcError('invalid_input', spec.idHint ?? 'endpoint id 格式不正确');
  }
  return id;
}

/** UI values are parsed using only explicitly declared account fields. */
function runtimeValues(spec: AdapterConsoleSpec, raw: unknown, patch: boolean): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PluginConsoleRpcError('invalid_input', '缺少账号字段');
  const fields = spec.fields ?? [];
  const known = new Map(fields.map(field => [field.key, field]));
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = known.get(key);
    if (!field || key === 'id') throw new PluginConsoleRpcError('invalid_input', '包含未声明或不可修改的字段');
    if (typeof value !== 'string') throw new PluginConsoleRpcError('invalid_input', '账号字段必须是字符串');
    const text = value.trim();
    if (text === '••••••') {
      if (patch && (field.secret || field.env)) continue;
      throw new PluginConsoleRpcError('invalid_input', '请重新填写密钥，不能提交遮蔽值');
    }
    if (!text && (field.secret || field.env || !patch)) continue;
    if (field.type === 'number') {
      const number = Number(text);
      if (!text || !Number.isFinite(number)) throw new PluginConsoleRpcError('invalid_input', `字段 ${key} 需要有效数字`);
      values[key] = number;
    } else if (field.type === 'boolean') {
      if (text !== 'true' && text !== 'false') throw new PluginConsoleRpcError('invalid_input', `字段 ${key} 需要 true 或 false`);
      values[key] = text === 'true';
    } else values[key] = text;
  }
  if (!patch && fields.some(field => field.required && values[field.key] === undefined)) {
    throw new PluginConsoleRpcError('invalid_input', '缺少必填账号字段');
  }
  return values;
}

function accountConfiguration(id: string, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const config: Record<string, unknown> = { id };
  for (const [field, value] of Object.entries(values)) writeConfigurationPath(config, field, value);
  return config;
}
