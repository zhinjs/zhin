/**
 * Convention entry: discover `adapters/bilibili-live/index.ts` → defineAdapter.
 * Experimental：连 B 站直播弹幕 WebSocket；声明 `liveDanmaku`，Agent 按弹幕窗口一窗只回一条（ADR 0038 §5）。
 */
import { defineAdapter } from 'zhin.js/adapter';
import { BilibiliLiveEndpoint } from '../../src/endpoint.js';
import { resolveBilibiliLiveConfig, type BilibiliLiveEndpointConfig } from '../../src/protocol.js';
import { bilibiliLiveRuntimeStateToken } from '../../src/bilibili-live-runtime-state.js';

export { BilibiliLiveEndpoint } from '../../src/endpoint.js';
export type { BilibiliLiveEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<BilibiliLiveEndpointConfig>({
  capabilities: ['inbound', 'outbound', 'liveDanmaku'],
  // 弹幕只支持纯文本；mention 转成平台的「回复」字段。
  segments: {
    supported: ['text', 'mention'],
    html: 'text',
    markdown: 'text',
    interactive: 'text',
  },
  create(context) {
    const config = resolveBilibiliLiveConfig(context.config);
    context.use(bilibiliLiveRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'ws',
    });
    return new BilibiliLiveEndpoint({
      id: context.id,
      config,
    });
  },
});
