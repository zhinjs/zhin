/**
 * Convention entry: discover `adapters/discord.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
} from '../src/endpoint.js';
import {
  resolveDiscordConfig,
  type DiscordAdapterConfig,
} from '../src/protocol.js';

export {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
} from '../src/endpoint.js';
export type {
  CreateDiscordClient,
  DiscordClientTransport,
  DiscordEndpointOptions,
  DiscordInteractionsEndpointOptions,
} from '../src/endpoint.js';

export default defineAdapter<DiscordAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveDiscordConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'interactions') {
      return new DiscordInteractionsEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new DiscordGatewayEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
