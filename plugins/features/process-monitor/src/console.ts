import {
  definePluginConsoleRpc,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
} from 'zhin.js';
import {
  ProcessMonitor,
  processMonitorToken,
} from './monitor.js';

export const PROCESS_MONITOR_CONSOLE_PAGE = 'index';
export const PROCESS_MONITOR_READ_PERMISSION = 'process-monitor:read';

type RuntimeWithTokenUse = {
  use?: <T>(token: unknown) => T | undefined;
};

function readMonitorFromCall(
  call: PluginConsoleRpcCall,
  fallbackMonitor?: ProcessMonitor,
): ProcessMonitor {
  const runtime = call.runtime as RuntimeWithTokenUse | undefined;
  if (typeof runtime?.use === 'function') {
    const resolved = runtime.use<ProcessMonitor>(processMonitorToken);
    if (resolved) return resolved;
  }
  return fallbackMonitor ?? new ProcessMonitor();
}

export function createProcessMonitorConsoleRpc(
  monitor?: ProcessMonitor,
): PluginConsoleRpc {
  return definePluginConsoleRpc({
    status: {
      page: PROCESS_MONITOR_CONSOLE_PAGE,
      requiredPermissions: [PROCESS_MONITOR_READ_PERMISSION],
      handler(_input, call) {
        const active = readMonitorFromCall(call, monitor);
        return { ...active.getStatus() };
      },
    },
  });
}
