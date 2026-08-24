import { defineEndpointClient } from 'zhin.js/adapter';
import type { DiscordRestClient } from './endpoint.js';
import type { DiscordClientTransport } from './gateway.js';

/** Exact Client variants produced by the Gateway and Interactions Endpoints. */
export type DiscordClient = DiscordClientTransport | DiscordRestClient;
export type DiscordClientEventMap = Record<string, unknown>;

/** Narrow an adapter Client for Gateway-only SDK operations. */
export function requireDiscordGatewayClient(client: DiscordClient): DiscordClientTransport {
  if ('guilds' in client && 'channels' in client) return client;
  throw new Error('This Discord tool requires a Gateway Endpoint Client');
}

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly discord: {
      readonly client: DiscordClient;
      readonly events: DiscordClientEventMap;
    };
  }
}

export const discordClient = defineEndpointClient<DiscordClient, DiscordClientEventMap>('discord');
