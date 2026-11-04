import { WecomClient, type WecomClientEventMap } from './client.js';
import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { WecomEndpoint } from './endpoint.js';
import { resolveWecomConfig, type WecomEndpointConfig } from './protocol.js';
import { httpHostToken } from '@zhin.js/host-http';

export class WecomAdapter extends Adapter<WecomEndpoint, WecomEndpointConfig, WecomClientEventMap> {
  readonly #context: AdapterContext<WecomEndpointConfig>;
  constructor(context: AdapterContext<WecomEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'corpId', 'agentId']; }
  override get configurationUpdateFields(): readonly string[] { return ['agentSecret', 'token', 'encodingAESKey', 'webhookPath', 'apiBaseUrl']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['agentSecret', 'apiBaseUrl']; }
  protected override async identifyConfiguration(input: WecomEndpointConfig, signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    const config = resolveWecomConfig(input);
    const fetch = async (url: string, init?: Parameters<typeof globalThis.fetch>[1]) => { signal.throwIfAborted(); return globalThis.fetch(url, { ...init, signal }); };
    const client = new WecomClient({ id: this.descriptor.id, config, fetch });
    const response = await client.getApplicationInfo();
    if (typeof response.agentid !== 'string' && typeof response.agentid !== 'number') throw new Error('WeCom identity verification returned no agentid');
    return JSON.stringify(['wecom', new URL(config.apiBaseUrl).origin, config.corpId, String(response.agentid)]);
  }
  protected override validateConfiguration(config: WecomEndpointConfig): void { resolveWecomConfig(config); }
  protected createEndpoint(input: WecomEndpointConfig, execution: EndpointCreationContext): WecomEndpoint {
    const config = resolveWecomConfig(input);
    return new WecomEndpoint({ id: execution.canonicalId, config, http: this.#context.use(httpHostToken) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'wecom': WecomAdapter; }
}
