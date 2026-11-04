/**
 * ICQQ Console RPC：运行状态 + endpoint 增删（原 `icqq endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { icqqConsoleSpec } from './console-spec.js';

export function createIcqqConsoleRpc(
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...icqqConsoleSpec,
    getConfig,
  });
}
