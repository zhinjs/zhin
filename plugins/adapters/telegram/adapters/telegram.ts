/**
 * Convention entry: discover `adapters/telegram.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { TelegramEndpoint } from '../src/endpoint.js';
import {
  resolveTelegramConfig,
  type TelegramAdapterConfig,
} from '../src/protocol.js';

export { TelegramEndpoint } from '../src/endpoint.js';
export type { TelegramEndpointOptions, TelegramFetch } from '../src/endpoint.js';

export default defineAdapter<TelegramAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveTelegramConfig(context.config);
    return new TelegramEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
      http: config.mode === 'webhook' ? context.use(httpHostToken) : undefined,
    });
  },
});
