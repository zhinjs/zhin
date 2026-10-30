import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { bilibiliLiveRuntimeStateToken } from './src/bilibili-live-runtime-state.js';
import { createBilibiliLiveConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/bilibili-live` 连直播弹幕 WebSocket，声明 `liveDanmaku`；回复直接发弹幕（`sendMode: off` 只听不说）。
 * - Page: `pages/index` → 「Bilibili 直播弹幕」：连接状态、测试与 endpoint 增删。
 */
export default definePlugin({
  name: 'bilibili-live',
  metadata: {
    displayName: 'Bilibili Live Danmaku Adapter (Experimental)',
  },
  setup(context) {
    context.resources.provide(bilibiliLiveRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createBilibiliLiveConsoleRpc(context.resources, () => context.config.get()));
  },
});
