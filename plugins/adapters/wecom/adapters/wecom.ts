/**
 * Convention entry: discover `adapters/wecom.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / protocol).
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { WecomEndpoint } from '../src/endpoint.js';
import {
  resolveWecomConfig,
  type WecomAdapterConfig,
} from '../src/protocol.js';

export { WecomEndpoint } from '../src/endpoint.js';
export type { WecomEndpointOptions, WecomFetch } from '../src/endpoint.js';

export default defineAdapter<WecomAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new WecomEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config: resolveWecomConfig(context.config),
    });
  },
});
