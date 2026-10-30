import { WeixinIlinkAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/weixin-ilink/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type WeixinIlinkEndpointConfig,
} from '../../src/protocol.js';

export { WeixinIlinkEndpoint } from '../../src/endpoint.js';
export type {
  WeixinIlinkEndpointOptions,
  WeixinIlinkGetUpdates,
  WeixinIlinkNotifyStart,
  WeixinIlinkNotifyStop,
  WeixinIlinkSendText,
} from '../../src/endpoint.js';

export default defineAdapter<WeixinIlinkEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['typing'],
  // 所有媒体（url 下载 / base64 落盘 / 本地 path）统一物化后走 CDN 上传（sendWeixinMediaFile），
  // 无直发面；微信无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['upload'],
    interactive: 'text',
  },
  createAdapter: () => new WeixinIlinkAdapter(),
});
