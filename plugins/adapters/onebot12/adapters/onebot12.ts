/**
 * Convention entry: discover `adapters/onebot12.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { OneBot12WebhookEndpoint } from '../src/webhook.js';
import { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
import {
  resolveOneBot12Config,
  type OneBot12AdapterConfig,
} from '../src/protocol.js';

export { OneBot12WebhookEndpoint } from '../src/webhook.js';
export type { OneBot12WebhookEndpointOptions } from '../src/webhook.js';
export { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
export type { OneBot12WsEndpointOptions } from '../src/ws-endpoint.js';
export { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
export type { OneBot12WssEndpointOptions } from '../src/wss-endpoint.js';
export type { OneBot12WsSocket, OneBot12WsCreateOptions } from '../src/ws-types.js';

export default defineAdapter<OneBot12AdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveOneBot12Config(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'webhook') {
      return new OneBot12WebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'wss') {
      return new OneBot12WssEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new OneBot12WsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
