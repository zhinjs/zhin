import { definePlugin } from 'zhin.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/douyin-live` 连抖音直播弹幕 WebSocket（非官方协议，Experimental），声明 `liveDanmaku`。
 * - 出站默认 `sendMode: off`（只听不说）；`direct` 尚无稳定可测的发送接口，返回 `not_implemented`。
 * - 本切片不提供 Console 页面 / RPC（#1135 Accept：Console UI 后置）。
 */
export default definePlugin({
  name: 'douyin-live',
  metadata: {
    displayName: 'Douyin Live Danmaku Adapter (Experimental)',
  },
});
