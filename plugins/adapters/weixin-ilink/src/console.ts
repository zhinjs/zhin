/**
 * 微信 iLink Console RPC：运行状态 + endpoint 增删（原 `weixin-ilink endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { weixinIlinkRuntimeStateToken } from './weixin-ilink-runtime-state.js';
import { weixinIlinkConsoleSpec } from './console-spec.js';

export function createWeixinIlinkConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(weixinIlinkRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...weixinIlinkConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
