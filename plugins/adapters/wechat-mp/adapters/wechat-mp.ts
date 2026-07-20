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

export { WeChatMpEndpoint } from '../src/endpoint.js';
export type { WeChatMpEndpointOptions, WeChatMpFetch } from '../src/endpoint.js';

export default defineAdapter<WeChatMpAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new WeChatMpEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config: resolveWeChatMpConfig(context.config),
    });
  },
});
