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

export type AdapterConsoleMutation = 'add' | 'update' | 'start' | 'stop' | 'remove' | 'replace';

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

export async function mutateConsoleAdapter(spec: AdapterConsoleSpec, call: PluginConsoleRpcCall, action: AdapterConsoleMutation,
  input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
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
  const options = { waitForExecution: false, beforeCommit: () => { call.signal.throwIfAborted(); call.commitStarted?.(); } };
  try {
    let result;
    if (action === 'add') {
      if (spec.canAdd === false) throw new PluginConsoleRpcError('unsupported', '此 Adapter 不支持新增账号');
      const id = requireRuntimeId(spec, input.id);
      result = await adapter.add(revision, { endpointId: id, config: { id, ...runtimeValues(spec, input.values, false) } }, options);
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
          result = await adapter.replace(target.instanceId, revision, { endpointId: id, config: { id, ...runtimeValues(spec, input.values, false) } }, options);
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
      message: action === 'add' || action === 'replace' ? '账号配置已保存，尚未启动' : '账号期望状态已保存，请查看运行状态',
    };
  } catch (error) {
    if (error instanceof PluginConsoleRpcError) throw error;
    if (error instanceof AdapterManagementError) {
      const code = error.code === 'duplicate_entry' || error.code === 'conflict' || error.code === 'closed' ? 'conflict'
        : error.code === 'not_found' ? 'not_found' : error.code === 'invalid_configuration' ? 'invalid_input'
          : error.code === 'unsupported' ? 'unsupported' : error.code === 'commit_unknown' ? 'commit_unknown' : 'unavailable';
      throw new PluginConsoleRpcError(code, code === 'commit_unknown' ? '提交结果未知，请刷新状态，勿重复提交' : '账号操作未能完成，请检查输入并刷新状态');
    }
    throw new PluginConsoleRpcError('commit_unknown', '提交结果尚未确认，请刷新状态，勿重复提交');
  }
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

/** Same string authoring fields as legacy Console, with no environment-file writer. */
function runtimeValues(spec: AdapterConsoleSpec, raw: unknown, patch: boolean): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PluginConsoleRpcError('invalid_input', '缺少账号字段');
  const fields = spec.fields ?? [];
  const known = new Map(fields.map(field => [field.key, field]));
  const values: Record<string, string> = {};
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
    values[key] = text;
  }
  if (!patch && fields.some(field => field.required && values[field.key] === undefined)) {
    throw new PluginConsoleRpcError('invalid_input', '缺少必填账号字段');
  }
  return values;
}
