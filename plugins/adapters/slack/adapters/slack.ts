/**
 * Convention entry: discover `adapters/slack.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { SlackEndpoint } from '../src/endpoint.js';
import {
  resolveSlackConfig,
  type SlackAdapterConfig,
} from '../src/protocol.js';

export { SlackEndpoint } from '../src/endpoint.js';
export type { SlackEndpointOptions, SlackSocketLike, SlackWebClientLike } from '../src/endpoint.js';

export default defineAdapter<SlackAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveSlackConfig(context.config);
    if (config.mode === 'http') {
      return new SlackEndpoint({
        id: context.id,
        gateway: context.use(messageGatewayToken),
        http: context.use(httpHostToken),
        config,
      });
    }
    return new SlackEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
    });
  },
});
