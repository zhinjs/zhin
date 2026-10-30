import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { resolveOneBot12Config, type OneBot12EndpointConfig } from './protocol.js';
import { OneBot12WsEndpoint } from './ws-endpoint.js';
import { OneBot12WssEndpoint } from './wss-endpoint.js';
import { OneBot12WebhookEndpoint } from './webhook.js';
import { probeOnebot12Identity, probeOnebot12HttpIdentity } from './identity.js';
import type { Onebot12ClientEventMap } from './client.js';

export class Onebot12Adapter extends Adapter<OneBot12WsEndpoint | OneBot12WssEndpoint | OneBot12WebhookEndpoint, OneBot12EndpointConfig, Onebot12ClientEventMap> {
  readonly #context: AdapterContext<OneBot12EndpointConfig>;
  constructor(context: AdapterContext<OneBot12EndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'platform', 'userId']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['connection', 'access_token', 'url', 'api_url']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['connection', 'url', 'path', 'api_url', 'access_token', 'reconnect_interval', 'heartbeat_interval'];
  }
  protected override validateConfiguration(config: OneBot12EndpointConfig): void { resolveOneBot12Config(config); }
  protected override async identifyConfiguration(input: OneBot12EndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveOneBot12Config(input);
    if (config.connection === 'ws') return probeOnebot12Identity(config, signal);
    if (config.connection === 'webhook') return probeOnebot12HttpIdentity(config, signal);
    return undefined;
  }
  protected createEndpoint(input: OneBot12EndpointConfig, execution: EndpointCreationContext): OneBot12WsEndpoint | OneBot12WssEndpoint | OneBot12WebhookEndpoint {
    const config = resolveOneBot12Config(input);
    const id = execution.canonicalId;
    if (config.connection === 'webhook') return new OneBot12WebhookEndpoint({ id, signal: execution.signal, http: this.#context.use(httpHostToken), config });
    if (config.connection === 'wss') return new OneBot12WssEndpoint({ id, http: this.#context.use(httpHostToken), config });
    return new OneBot12WsEndpoint({ id, config });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly onebot12: Onebot12Adapter; }
}
