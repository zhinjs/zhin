/**
 * Milky Console RPC：运行状态 + endpoint 增删（原 `milky endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { milkyRuntimeStateToken } from './milky-runtime-state.js';
import { milkyConsoleSpec } from './console-spec.js';

export function createMilkyConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(milkyRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...milkyConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
