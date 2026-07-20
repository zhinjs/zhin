/**
 * Convention entry: discover `adapters/lark.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { LarkEndpoint } from '../src/endpoint.js';
import {
  resolveLarkConfig,
  type LarkAdapterConfig,
} from '../src/protocol.js';

export { LarkEndpoint } from '../src/endpoint.js';
export type { LarkEndpointOptions, LarkFetch } from '../src/endpoint.js';

export default defineAdapter<LarkAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new LarkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config: resolveLarkConfig(context.config),
    });
  },
});
