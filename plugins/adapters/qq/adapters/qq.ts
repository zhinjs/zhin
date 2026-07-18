/**
 * Convention entry: discover `adapters/qq.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { QqHttpEndpoint, QqWebsocketEndpoint } from '../src/endpoint.js';
import {
  resolveQqConfig,
  type QqAdapterConfig,
} from '../src/protocol.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
} from '../src/endpoint.js';
export type {
  CreateQqBot,
  CreateQqHttpBot,
  QqBotTransport,
  QqEndpointOptions,
  QqHttpBotTransport,
  QqHttpEndpointOptions,
} from '../src/endpoint.js';

export default defineAdapter<QqAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveQqConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.mode === 'webhook' || config.mode === 'middleware') {
      return new QqHttpEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new QqWebsocketEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
