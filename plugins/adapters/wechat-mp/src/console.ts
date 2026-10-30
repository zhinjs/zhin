/**
 * 微信公众号 Console RPC：运行状态 + endpoint 增删（原 `wechat-mp endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { wechatMpConsoleSpec } from './console-spec.js';

export function createWechatMpConsoleRpc(
  _resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...wechatMpConsoleSpec,
    getConfig,
  });
}
