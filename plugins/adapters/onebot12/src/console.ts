/**
 * OneBot 12 Console RPC：运行状态 + endpoint 增删（原 `onebot12 endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { onebot12RuntimeStateToken } from './onebot12-runtime-state.js';
import { onebot12ConsoleSpec } from './console-spec.js';

export function createOnebot12ConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(onebot12RuntimeStateToken);
  return createAdapterConsoleRpc({
    ...onebot12ConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
