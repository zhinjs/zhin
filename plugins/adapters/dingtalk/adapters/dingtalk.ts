/**
 * Convention entry: discover `adapters/dingtalk.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { DingTalkEndpoint } from '../src/endpoint.js';
import {
  resolveDingTalkConfig,
  type DingTalkAdapterConfig,
} from '../src/protocol.js';

export { DingTalkEndpoint } from '../src/endpoint.js';
export type { DingTalkEndpointOptions, DingTalkFetch } from '../src/endpoint.js';

export default defineAdapter<DingTalkAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new DingTalkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config: resolveDingTalkConfig(context.config),
    });
  },
});
