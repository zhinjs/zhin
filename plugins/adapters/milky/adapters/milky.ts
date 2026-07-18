/**
 * Convention entry: discover `adapters/milky.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
} from '../src/endpoint.js';
import {
  resolveMilkyConfig,
  type MilkyAdapterConfig,
} from '../src/protocol.js';

export {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
} from '../src/endpoint.js';
export type {
  CreateMilkySseStream,
  MilkySseEndpointOptions,
  MilkyWebhookEndpointOptions,
  MilkyWssEndpointOptions,
  MilkyWsEndpointOptions,
  MilkyWsCreateOptions,
  MilkyWsSocket,
} from '../src/endpoint.js';

export default defineAdapter<MilkyAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveMilkyConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'webhook') {
      return new MilkyWebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'wss') {
      return new MilkyWssEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'sse') {
      return new MilkySseEndpoint({
        id: context.id,
        gateway,
        config,
      });
    }
    return new MilkyWsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
