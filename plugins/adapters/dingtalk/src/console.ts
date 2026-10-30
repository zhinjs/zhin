/**
 * DingTalk Console RPC：运行状态 + endpoint 增删（原 `dingtalk endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { dingtalkRuntimeStateToken } from './dingtalk-runtime-state.js';
import { dingtalkConsoleSpec } from './console-spec.js';

export function createDingtalkConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(dingtalkRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...dingtalkConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
