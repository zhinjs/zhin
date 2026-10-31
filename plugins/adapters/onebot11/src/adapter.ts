import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { resolveOneBot11Config, type OneBot11EndpointConfig } from './protocol.js';
import { OneBot11WsEndpoint } from './ws-endpoint.js';
import { OneBot11WssEndpoint } from './wss-endpoint.js';
import { probeOnebot11Identity } from './identity.js';
import type { Onebot11ClientEventMap } from './client.js';

export class Onebot11Adapter extends Adapter<OneBot11WsEndpoint | OneBot11WssEndpoint, OneBot11EndpointConfig, Onebot11ClientEventMap> {
  readonly #context: AdapterContext<OneBot11EndpointConfig>;
  constructor(context: AdapterContext<OneBot11EndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['connection', 'access_token', 'url']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['connection', 'url', 'path', 'access_token', 'reconnect_interval', 'heartbeat_interval'];
  }
  protected override validateConfiguration(config: OneBot11EndpointConfig): void { resolveOneBot11Config(config); }
  protected override async identifyConfiguration(input: OneBot11EndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveOneBot11Config(input);
    return config.connection === 'ws' ? probeOnebot11Identity(config, signal) : undefined;
  }
  protected createEndpoint(input: OneBot11EndpointConfig, execution: EndpointCreationContext): OneBot11WsEndpoint | OneBot11WssEndpoint {
    const config = resolveOneBot11Config(input);
    return config.connection === 'wss'
      ? new OneBot11WssEndpoint({ id: execution.canonicalId, signal: execution.signal, http: this.#context.use(httpHostToken), config, probeLoginInfo: true })
      : new OneBot11WsEndpoint({ id: execution.canonicalId, signal: execution.signal, config, probeLoginInfo: true });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly onebot11: Onebot11Adapter; }
}
