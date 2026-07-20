/**
 * Convention entry: discover `adapters/kook.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / ws / protocol).
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../src/endpoint.js';
import {
  resolveKookConfig,
  type KookAdapterConfig,
} from '../src/protocol.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../src/endpoint.js';
export type {
  KookEndpointOptions,
  KookWebhookEndpointOptions,
} from '../src/endpoint.js';
export type { CreateKookClient, KookClientTransport } from '../src/ws.js';

export default defineAdapter<KookAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveKookConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'webhook') {
      return new KookWebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new KookWebsocketEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
