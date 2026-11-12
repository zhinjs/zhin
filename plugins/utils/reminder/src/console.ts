import {
  createDeliveryTarget,
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
} from 'zhin.js';
import { reminderServiceToken } from './runtime.js';
import type { ReminderService } from './service.js';

function resolveService(
  provided: ReminderService | undefined,
  call: PluginConsoleRpcCall,
): ReminderService {
  if (provided) return provided;
  const runtimeWithUse = call.runtime as { use?: (token: typeof reminderServiceToken) => ReminderService } | undefined;
  const fromRuntime = runtimeWithUse?.use?.(reminderServiceToken);
  if (fromRuntime) return fromRuntime;
  throw new PluginConsoleRpcError('unavailable', '提醒服务尚未就绪');
}

export function createReminderConsoleRpc(service?: ReminderService): PluginConsoleRpc {
  const rpc = definePluginConsoleRpc({
    // Day-to-day edits belong to operators; `:write` would otherwise infer `manage` (ADR 0049).
    permissions: [{ id: 'reminder:write', level: 'operate', description: '管理提醒' }],
    status: {
      page: 'index',
      requiredPermissions: ['reminder:read'],
      async handler(_input, call) {
        return resolveService(service, call).getConsoleSnapshot();
      },
    },
    actions: {
      create: {
        page: 'index',
        requiredPermissions: ['reminder:write'],
        async handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall) {
          const svc = resolveService(service, call);
          const content =
            typeof input.content === 'string'
              ? input.content.trim()
              : typeof input.text === 'string'
                ? input.text.trim()
                : '';
          if (!content) {
            throw new PluginConsoleRpcError('invalid_input', '请输入提醒内容');
          }
          const rawMinutes =
            input.minutes !== undefined && input.minutes !== null && input.minutes !== ''
              ? Number(input.minutes)
              : 10;
          const minutes =
            Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.round(rawMinutes) : 10;
          const targetType = input.targetType === 'group' ? 'group' : 'private';
          const targetId =
            typeof input.targetId === 'string' && input.targetId.trim()
              ? input.targetId.trim()
              : 'console';
          const adapter =
            typeof input.adapter === 'string' && input.adapter.trim()
              ? input.adapter.trim()
              : 'sandbox';
          const target = createDeliveryTarget({
            conversation: {
              endpoint: { adapter, id: adapter },
              kind: targetType,
              id: targetId,
            },
          });
          const task = await svc.add(
            { senderId: targetId, target },
            content,
            Date.now() + minutes * 60_000,
            null,
          );
          return {
            ok: true,
            id: task.id,
            message: `已创建提醒：${content}（${minutes} 分钟后触发）`,
          };
        },
      },
      delete: {
        page: 'index',
        requiredPermissions: ['reminder:write'],
        async handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall) {
          const svc = resolveService(service, call);
          const id = typeof input.id === 'string' ? input.id.trim() : '';
          if (!id) {
            throw new PluginConsoleRpcError('invalid_input', '请提供提醒 ID');
          }
          const removed = await svc.deleteById(id);
          return {
            ok: removed,
            id,
            message: removed ? `提醒 ${id} 已删除` : `未找到提醒 ${id}`,
          };
        },
      },
      'clear-completed': {
        page: 'index',
        requiredPermissions: ['reminder:write'],
        async handler(_input: PluginConsoleRpcInput, call: PluginConsoleRpcCall) {
          const svc = resolveService(service, call);
          const cleared = await svc.clearCompleted();
          return {
            ok: true,
            cleared,
            message: `已清理 ${cleared} 条已完成提醒记录`,
          };
        },
      },
    },
  });

  const methods = rpc.methods as Map<string, NormalizedPluginConsoleRpcMethod>;
  const origGet = methods.get.bind(methods);
  const origHas = methods.has.bind(methods);
  const normalizeKey = (key: string) => (key === 'clearCompleted' ? 'clear-completed' : key);
  methods.get = (key: string) => origGet(normalizeKey(key));
  methods.has = (key: string) => origHas(normalizeKey(key));
  return rpc;
}
