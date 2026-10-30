import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { callApi, resolveMilkyConfig, type MilkyEndpointConfig } from './protocol.js';
import { MilkyWsEndpoint, MilkyWssEndpoint, MilkySseEndpoint, MilkyWebhookEndpoint } from './endpoint.js';
import type { MilkyClientEventMap } from './client.js';

type MilkyEndpoint = MilkyWsEndpoint | MilkyWssEndpoint | MilkySseEndpoint | MilkyWebhookEndpoint;
export class MilkyAdapter extends Adapter<MilkyEndpoint, MilkyEndpointConfig, MilkyClientEventMap> {
  readonly #context: AdapterContext<MilkyEndpointConfig>;
  constructor(context: AdapterContext<MilkyEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['access_token', 'baseUrl']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['connection', 'baseUrl', 'path', 'access_token', 'reconnect_interval', 'heartbeat_interval'];
  }
  protected override validateConfiguration(config: MilkyEndpointConfig): void { resolveMilkyConfig(config); }
  protected override async identifyConfiguration(input: MilkyEndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveMilkyConfig(input);
    signal.throwIfAborted();
    const response = await callApi<{ uin?: unknown }>({ ...config, signal }, 'get_login_info');
    signal.throwIfAborted();
    if (response.status !== 'ok') throw new Error('Milky login identity lookup failed');
    const userId = response.data?.uin;
    if (userId === 0 || userId === '0' || (typeof userId === 'string' && !userId.trim())) return undefined;
    if ((typeof userId !== 'number' && typeof userId !== 'string') || !String(userId).trim()) throw new Error('Milky login identity is unavailable');
    return `qq:${userId}`;
  }
  protected createEndpoint(input: MilkyEndpointConfig, execution: EndpointCreationContext): MilkyEndpoint {
    const config = resolveMilkyConfig(input), id = execution.canonicalId, signal = execution.signal;
    switch (config.connection) {
      case 'wss': return new MilkyWssEndpoint({ id, config, signal, http: this.#context.use(httpHostToken) });
      case 'webhook': return new MilkyWebhookEndpoint({ id, config, signal, http: this.#context.use(httpHostToken) });
      case 'sse': return new MilkySseEndpoint({ id, config, signal });
      case 'ws': return new MilkyWsEndpoint({ id, config, signal });
    }
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly milky: MilkyAdapter; }
}
