import { WeChatMpAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/wechat-mp/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type WeChatMpEndpointConfig,
} from '../../src/protocol.js';

export { WeChatMpEndpoint } from '../../src/endpoint.js';
export type { WeChatMpEndpointOptions } from '../../src/endpoint.js';
export type { WeChatMpFetch } from '../../src/client.js';

export default defineAdapter<WeChatMpEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 客服消息媒体统一经 /cgi-bin/media/upload 物化为 media_id（url 下载后上传，
  // kind=file 的 MediaRef 视为既有 media_id 直传）；公众号无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['upload'],
    interactive: 'text',
  },
  createAdapter: context => new WeChatMpAdapter(context),
});
