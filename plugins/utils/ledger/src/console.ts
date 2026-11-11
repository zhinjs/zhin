import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
} from 'zhin.js';
import { ledgerServiceToken } from './runtime.js';
import type { LedgerService } from './service.js';

function resolveService(
  provided: LedgerService | undefined,
  call: PluginConsoleRpcCall,
): LedgerService {
  if (provided) return provided;
  const runtimeWithUse = call.runtime as { use?: (token: typeof ledgerServiceToken) => LedgerService } | undefined;
  const fromRuntime = runtimeWithUse?.use?.(ledgerServiceToken);
  if (fromRuntime) return fromRuntime;
  throw new PluginConsoleRpcError('unavailable', '记账服务尚未就绪');
}

export function createLedgerConsoleRpc(service?: LedgerService): PluginConsoleRpc {
  const rpc = definePluginConsoleRpc({
    // Day-to-day edits belong to operators; `:write` would otherwise infer `manage` (ADR 0049).
    permissions: [{ id: 'ledger:write', level: 'operate', description: '记账' }],
    status: {
      page: 'index',
      requiredPermissions: ['ledger:read'],
      async handler(_input, call) {
        return resolveService(service, call).getConsoleSnapshot();
      },
    },
    actions: {
      'run-daily-reports': {
        page: 'index',
        requiredPermissions: ['ledger:write'],
        async handler(_input, call) {
          const sent = await resolveService(service, call).runDailyReports();
          return { sent };
        },
      },
    },
  });
  const methods = rpc.methods as Map<string, ReturnType<PluginConsoleRpc['methods']['get']>>;
  const originalGet = methods.get.bind(methods);
  const originalHas = methods.has.bind(methods);
  methods.get = (key: string) => originalGet(key === 'runDailyReports' ? 'run-daily-reports' : key);
  methods.has = (key: string) => originalHas(key === 'runDailyReports' ? 'run-daily-reports' : key);
  return rpc;
}
