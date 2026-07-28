/**
 * Convention entry: discover `adapters/wechat-mp.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { WeChatMpEndpoint } from '../src/endpoint.js';
import {
  resolveWeChatMpConfig,
  type WeChatMpAdapterConfig,
} from '../src/protocol.js';
import { wechatMpRuntimeStateToken } from '../src/wechat-mp-runtime-state.js';

export { WeChatMpEndpoint } from '../src/endpoint.js';
export type { WeChatMpEndpointOptions, WeChatMpFetch } from '../src/endpoint.js';

export default defineAdapter<WeChatMpAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 客服消息图片经 /cgi-bin/media/upload 物化为 media_id（url 下载后上传）；
  // 公众号无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveWeChatMpConfig(context.config);
    // 注册到插件运行时状态（wechat-mp endpoint list 的"运行中"数据源）
    context.use(wechatMpRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: 'webhook',
    });
    return new WeChatMpEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
