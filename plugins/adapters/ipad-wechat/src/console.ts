/**
 * 微信 iPad Console RPC：运行状态 + endpoint 增删。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 * 扫码与设备验证走 LoginAssist（Console 登录面板），不在这里另开入口。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { ipadWechatConsoleSpec } from './console-spec.js';

export function createIpadWechatConsoleRpc(
  _resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  return createAdapterConsoleRpc({
    ...ipadWechatConsoleSpec,
    getConfig,
  });
}
