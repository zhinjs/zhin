import type { ClientEvents } from 'discord.js';
import type { DiscordAdapter } from './adapter.js';
import type { DiscordGatewayEndpoint, DiscordInteractionsEndpoint } from './endpoint.js';
import type { DiscordClientTransport } from './gateway.js';

/** Exact Client variants produced by the Gateway and Interactions Endpoints. */
export type DiscordClient = DiscordGatewayEndpoint | DiscordInteractionsEndpoint;
export type DiscordClientEventMap = { readonly [K in keyof ClientEvents]: ClientEvents[K][0] } & Record<string, unknown>;

/** Narrow an adapter Client for Gateway-only SDK operations. */
export function requireDiscordGatewayClient(client: DiscordClient): DiscordClientTransport {
  if ('guilds' in client && 'channels' in client) return client;
  throw new Error('This Discord tool requires a Gateway Endpoint Client');
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly discord: DiscordAdapter; }
}
