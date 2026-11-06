import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
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
  return definePluginConsoleRpc({
    status: {
      page: 'index',
      requiredPermissions: ['reminder:read'],
      async handler(_input, call) {
        return resolveService(service, call).getConsoleSnapshot();
      },
    },
  });
}
