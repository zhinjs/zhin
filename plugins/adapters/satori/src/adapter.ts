import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { callSatoriApi, resolveSatoriConfig, type SatoriEndpointConfig, type SatoriLogin } from './protocol.js';
import { SatoriWsEndpoint, SatoriWebhookEndpoint } from './endpoint.js';
import type { SatoriClientEventMap } from './client.js';

export class SatoriAdapter extends Adapter<SatoriWsEndpoint | SatoriWebhookEndpoint, SatoriEndpointConfig, SatoriClientEventMap> {
  readonly #context: AdapterContext<SatoriEndpointConfig>;
  constructor(context: AdapterContext<SatoriEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'platform', 'userId']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['token', 'baseUrl']; }
  override get configurationUpdateFields(): readonly string[] { return ['connection', 'baseUrl', 'token', 'path', 'heartbeat_interval']; }
  protected override validateConfiguration(config: SatoriEndpointConfig): void { resolveSatoriConfig(config); }
  protected override async identifyConfiguration(input: SatoriEndpointConfig, signal: AbortSignal): Promise<string> {
    const config = resolveSatoriConfig(input);
    signal.throwIfAborted();
    const login = await callSatoriApi<SatoriLogin>({ ...config, signal, resource: 'login', method: 'get' });
    signal.throwIfAborted();
    if (!login?.platform || !login.user?.id) throw new Error('Satori login identity is unavailable');
    if (login.platform !== config.platform || login.user.id !== config.userId) throw new Error('Satori returned another login identity');
    return `satori:${JSON.stringify([login.platform, login.user.id])}`;
  }
  protected createEndpoint(input: SatoriEndpointConfig, execution: EndpointCreationContext): SatoriWsEndpoint | SatoriWebhookEndpoint {
    const config = resolveSatoriConfig(input), id = execution.canonicalId, signal = execution.signal;
    return config.connection === 'webhook'
      ? new SatoriWebhookEndpoint({ id, config, signal, http: this.#context.use(httpHostToken) })
      : new SatoriWsEndpoint({ id, config, signal });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly satori: SatoriAdapter; }
}
