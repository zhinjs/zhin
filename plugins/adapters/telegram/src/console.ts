/**
 * Telegram Console RPC：运行状态 + endpoint 增删（原 `telegram endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { telegramRuntimeStateToken } from './telegram-runtime-state.js';
import { telegramConsoleSpec } from './console-spec.js';

export function createTelegramConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(telegramRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...telegramConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
