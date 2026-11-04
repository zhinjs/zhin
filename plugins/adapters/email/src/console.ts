/**
 * Email Console RPC：所属 Adapter 的连接状态与持久化账号管理。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { emailConsoleSpec } from './console-spec.js';

export function createEmailConsoleRpc(
  _resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...emailConsoleSpec,
    getConfig,
  });
}
