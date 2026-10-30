/**
 * Email Console RPC：连接状态与只读 endpoint 列表。
 * SMTP/IMAP 嵌套配置不在页面里修改（用配置文件 / `config:patch`）。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { emailRuntimeStateToken } from './email-runtime-state.js';
import { emailConsoleSpec } from './console-spec.js';

export function createEmailConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(emailRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...emailConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
