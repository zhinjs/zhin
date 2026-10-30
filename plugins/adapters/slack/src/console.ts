/**
 * Slack Console RPC：运行状态 + endpoint 增删（原 `slack endpoint` 聊天命令）。
 *
 * 页面绑定 `pages/index`，读取 / 写入分别要求 `<adapter>:read` / `<adapter>:write`。
 */
import { createAdapterConsoleRpc, type AdapterConsoleResources } from 'zhin.js/adapter';
import type { PluginConsoleRpc } from 'zhin.js';
import { slackRuntimeStateToken } from './slack-runtime-state.js';
import { slackConsoleSpec } from './console-spec.js';

export function createSlackConsoleRpc(
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const state = resources.use(slackRuntimeStateToken);
  return createAdapterConsoleRpc({
    ...slackConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
  }, resources);
}
