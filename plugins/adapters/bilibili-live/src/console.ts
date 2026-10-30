/**
 * Bilibili Live Console RPC：运行状态 + endpoint 增删。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `bilibili-live:read` / `bilibili-live:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { bilibiliLiveConsoleSpec } from './console-spec.js';

export function createBilibiliLiveConsoleRpc(
  _resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...bilibiliLiveConsoleSpec,
    getConfig,
  });
}
