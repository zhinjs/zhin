/**
 * LINE Console RPC：运行状态 + endpoint 增删（原 `line endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { lineRuntimeStateToken } from './line-runtime-state.js';
import { lineConsoleSpec } from './console-spec.js';

export function createLineConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(lineRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...lineConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
