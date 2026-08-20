/**
 * Convention entry: discover `adapters/weixin-ilink.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import {
  resolveWeixinIlinkConfig,
  type WeixinIlinkAdapterConfig,
} from '../src/protocol.js';
import { weixinIlinkRuntimeStateToken } from '../src/weixin-ilink-runtime-state.js';

export { WeixinIlinkEndpoint } from '../src/endpoint.js';
export type {
  WeixinIlinkEndpointOptions,
  WeixinIlinkGetUpdates,
  WeixinIlinkNotifyStart,
  WeixinIlinkNotifyStop,
  WeixinIlinkSendText,
} from '../src/endpoint.js';

export default defineAdapter<WeixinIlinkAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 所有媒体（url 下载 / base64 落盘 / 本地 path）统一物化后走 CDN 上传（sendWeixinMediaFile），
  // 无直发面；微信无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['upload'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveWeixinIlinkConfig(context.config);
    // 注册到插件运行时状态（weixin-ilink.endpoint list 的"运行中"数据源）
    context.use(weixinIlinkRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      // iLink 仅长轮询一种接入方式，无 config.connection 字段
      mode: 'long-poll',
    });
    return new WeixinIlinkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
    });
  },
});
