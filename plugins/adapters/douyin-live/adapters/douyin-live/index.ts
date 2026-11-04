/**
 * Convention entry: discover `adapters/douyin-live/index.ts` → defineAdapter.
 * Experimental：连抖音直播弹幕 WebSocket（非官方协议）；声明 `liveDanmaku`，Agent 按弹幕窗口一窗只回一条（ADR 0038 §5）。
 */
import { defineAdapter } from 'zhin.js/adapter';
import { DouyinLiveAdapter } from '../../src/adapter.js';
import type { DouyinLiveEndpointConfig } from '../../src/protocol.js';

export { DouyinLiveEndpoint } from '../../src/endpoint.js';
export type { DouyinLiveEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<DouyinLiveEndpointConfig>({
  capabilities: ['inbound', 'outbound', 'liveDanmaku'],
  // 弹幕只支持纯文本；平台没有「回复」字段，mention 折叠进正文 `@昵称`。
  profile: {
    default: {
      messaging: {
        segments: {
          supported: ['text', 'mention'],
          html: 'text',
          markdown: 'text',
          interactive: 'text',
        },
      },
      delivery: { send: true, spool: true },
    },
  },
  createAdapter: context => new DouyinLiveAdapter(context),
});
