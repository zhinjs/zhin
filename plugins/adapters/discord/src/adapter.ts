import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { REST, Routes } from 'discord.js';
import { DiscordGatewayEndpoint, DiscordInteractionsEndpoint } from './endpoint.js';
import { createDiscordRestApiAgent } from './rest-api-proxy.js';
import { resolveDiscordConfig, type DiscordEndpointConfig } from './protocol.js';
import type { DiscordClientEventMap } from './client.js';

export class DiscordAdapter extends Adapter<DiscordGatewayEndpoint | DiscordInteractionsEndpoint, DiscordEndpointConfig, DiscordClientEventMap> {
  constructor(private readonly context: AdapterContext<DiscordEndpointConfig>) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'applicationId']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['token', 'publicKey']; }
  override get configurationUpdateFields(): readonly string[] { return ['token', 'connection', 'restApiProxy', 'restApiProxy.port',
    'gatewayFaultProxyUrl', 'intents', 'defaultActivity', 'defaultActivity.name', 'defaultActivity.type', 'defaultActivity.url', 'publicKey', 'interactionsPath']; }
  protected override validateConfiguration(input: DiscordEndpointConfig): void { resolveDiscordConfig(input); }
  protected override async identifyConfiguration(input: DiscordEndpointConfig, signal: AbortSignal): Promise<string> {
    const config = resolveDiscordConfig(input);
    const agent = config.connection === 'gateway' && config.restApiProxy ? createDiscordRestApiAgent(config.restApiProxy) : undefined;
    const rest = new REST({ version: '10', retries: 0, rejectOnRateLimit: () => true, ...(agent ? { agent } : {}) }).setToken(config.token);
    try {
      const application = await rest.get(Routes.currentApplication(), { signal }) as { id?: unknown; verify_key?: unknown };
      if (typeof application?.id !== 'string' || !application.id.trim()) throw new Error('Discord identity response is incomplete');
      if (config.connection === 'interactions' && application.id !== config.applicationId) throw new Error('Discord application identity configuration does not match');
      if (config.connection === 'interactions' && (typeof application.verify_key !== 'string'
        || application.verify_key.toLowerCase() !== config.publicKey.toLowerCase())) {
        throw new Error('Discord verification key does not match the application identity');
      }
      return JSON.stringify(['discord', application.id]);
    } finally { rest.clearHashSweeper(); rest.clearHandlerSweeper(); await agent?.destroyProxy(); }
  }
  protected async createEndpoint(input: DiscordEndpointConfig, execution: EndpointCreationContext): Promise<DiscordGatewayEndpoint | DiscordInteractionsEndpoint> {
    const config = resolveDiscordConfig(input);
    if (config.connection === 'interactions') return new DiscordInteractionsEndpoint({ id: execution.canonicalId, config, http: this.context.use(httpHostToken) });
    const restApiAgent = config.restApiProxy ? createDiscordRestApiAgent(config.restApiProxy) : undefined;
    try { return new DiscordGatewayEndpoint({ id: execution.canonicalId, config, restApiAgent }); }
    catch (error) { await restApiAgent?.destroyProxy(); throw error; }
  }
}
