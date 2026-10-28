import { definePlugin } from 'zhin.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/bilibili-live` 连直播弹幕 WebSocket，声明 `liveDanmaku`；回复直接发弹幕（`sendMode: off` 只听不说）。
 */
export default definePlugin({
  name: 'bilibili-live',
  metadata: {
    displayName: 'Bilibili Live Danmaku Adapter (Experimental)',
  },
  setup() {},
});
