import { definePlugin } from 'zhin.js';
import { createBilibiliLiveConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/bilibili-live` 连直播弹幕 WebSocket，声明 `liveDanmaku`；回复直接发弹幕（`sendMode: off` 只听不说）。
 * - Page: `pages/index` → 「Bilibili 直播弹幕」：连接状态、测试与 endpoint 增删。
 */
export default definePlugin({
  name: 'bilibili-live',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Bilibili Live Danmaku Adapter (Experimental)',
    displayNameI18n: { 'zh-CN': '哔哩哔哩直播弹幕适配器（实验性）', en: 'Bilibili Live Danmaku Adapter (Experimental)' },
  },
  setup(context) {
    return {
      consoleRpc: createBilibiliLiveConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
