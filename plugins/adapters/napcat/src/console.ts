/**
 * NapCat Console RPC：运行状态 + endpoint 增删（原 `napcat endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { napcatConsoleSpec } from './console-spec.js';

export function createNapcatConsoleRpc(
  _resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...napcatConsoleSpec,
    getConfig,
  });
}
