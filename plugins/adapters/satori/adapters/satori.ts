/**
 * Convention entry: discover `adapters/satori.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { SatoriWebhookEndpoint, SatoriWsEndpoint } from '../src/endpoint.js';
import {
  resolveSatoriConfig,
  type SatoriAdapterConfig,
} from '../src/protocol.js';

export { SatoriWebhookEndpoint, SatoriWsEndpoint } from '../src/endpoint.js';
export type {
  CreateSatoriWebSocket,
  SatoriApiCaller,
  SatoriWebhookEndpointOptions,
  SatoriWsEndpointOptions,
  SatoriWsSocket,
} from '../src/endpoint.js';

export default defineAdapter<SatoriAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveSatoriConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'webhook') {
      return new SatoriWebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new SatoriWsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
