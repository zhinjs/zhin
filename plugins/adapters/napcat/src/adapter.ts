import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { callNapCatHttpAction, resolveNapCatConfig, type NapCatEndpointConfig } from './protocol.js';
import { NapCatWsEndpoint } from './ws-endpoint.js';
import { NapCatWssEndpoint } from './wss-endpoint.js';
import { NapCatHttpEndpoint } from './http-endpoint.js';
import { probeNapcatIdentity } from './identity.js';
import type { NapcatClientEventMap } from './client.js';

type NapcatEndpoint = NapCatWsEndpoint | NapCatWssEndpoint | NapCatHttpEndpoint;
export class NapcatAdapter extends Adapter<NapcatEndpoint, NapCatEndpointConfig, NapcatClientEventMap> {
  readonly #context: AdapterContext<NapCatEndpointConfig>;
  constructor(context: AdapterContext<NapCatEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['connection', 'access_token', 'url', 'http_url']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['connection', 'url', 'path', 'http_url', 'post_path', 'access_token', 'reconnect_interval', 'heartbeat_interval', 'poll_interval'];
  }
  protected override validateConfiguration(config: NapCatEndpointConfig): void { resolveNapCatConfig(config); }
  protected override async identifyConfiguration(input: NapCatEndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveNapCatConfig(input);
    if (config.connection === 'ws') return probeNapcatIdentity(config, signal);
    if (config.connection === 'wss') return undefined;
    signal.throwIfAborted();
    const response = await callNapCatHttpAction({ ...config, signal }, 'get_login_info');
    signal.throwIfAborted();
    const data = response.data as { user_id?: unknown } | undefined;
    if (data?.user_id === 0 || data?.user_id === '0' || (typeof data?.user_id === 'string' && !data.user_id.trim())) return undefined;
    if ((typeof data?.user_id !== 'string' && typeof data?.user_id !== 'number') || !String(data.user_id).trim()) {
      throw new Error('NapCat login identity is unavailable');
    }
    return `qq:${data.user_id}`;
  }
  protected createEndpoint(input: NapCatEndpointConfig, execution: EndpointCreationContext): NapcatEndpoint {
    const config = resolveNapCatConfig(input), id = execution.canonicalId, signal = execution.signal;
    switch (config.connection) {
      case 'wss': return new NapCatWssEndpoint({ id, signal, config, http: this.#context.use(httpHostToken) });
      case 'http': return new NapCatHttpEndpoint({ id, signal, config, http: this.#context.use(httpHostToken) });
      case 'ws': return new NapCatWsEndpoint({ id, signal, config });
    }
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly napcat: NapcatAdapter; }
}
