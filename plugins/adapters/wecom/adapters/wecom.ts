/**
 * Convention entry: discover `adapters/wecom.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import { messageGatewayToken, sideEventGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { WecomEndpoint } from '../src/endpoint.js';
import {
  resolveWecomConfig,
  type WecomAdapterConfig,
} from '../src/protocol.js';
import { wecomRuntimeStateToken } from '../src/wecom-runtime-state.js';

export { WecomEndpoint } from '../src/endpoint.js';
export type { WecomEndpointOptions, WecomFetch } from '../src/endpoint.js';

export default defineAdapter<WecomAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // image 段全部经 /cgi-bin/media/upload 物化为 media_id（url 下载后上传、
  // base64/path 直接上传、file 引用直用 media_id）；无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['upload'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveWecomConfig(context.config);
    // 注册到插件运行时状态（wecom.endpoint list 的"运行中"数据源）
    context.use(wecomRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'webhook',
    });
    return new WecomEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      sideEvents: context.use(sideEventGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
