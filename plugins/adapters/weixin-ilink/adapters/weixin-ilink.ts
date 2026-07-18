/**
 * Convention entry: discover `adapters/weixin-ilink.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import {
  resolveWeixinIlinkConfig,
  type WeixinIlinkAdapterConfig,
} from '../src/protocol.js';

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
  create(context) {
    return new WeixinIlinkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config: resolveWeixinIlinkConfig(context.config),
    });
  },
});
