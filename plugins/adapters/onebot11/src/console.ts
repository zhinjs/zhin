/**
 * OneBot 11 Console RPC：运行状态 + endpoint 增删（原 `onebot11 endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { onebot11RuntimeStateToken } from './onebot11-runtime-state.js';
import { onebot11ConsoleSpec } from './console-spec.js';

export function createOnebot11ConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(onebot11RuntimeStateToken);
  return createAdapterConsoleRpc({
    ...onebot11ConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
