/**
 * KOOK Console RPC：运行状态 + endpoint 增删（原 `kook endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { kookRuntimeStateToken } from './kook-runtime-state.js';
import { kookConsoleSpec } from './console-spec.js';

export function createKookConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(kookRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...kookConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
