/**
 * ICQQ Console RPC：运行状态 + endpoint 增删（原 `icqq endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { icqqRuntimeStateToken } from './icqq-runtime-state.js';
import { icqqConsoleSpec } from './console-spec.js';

export function createIcqqConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(icqqRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...icqqConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
