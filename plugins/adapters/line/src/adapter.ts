import { LineApiClient } from './api-client.js';
import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { LineEndpoint } from './endpoint.js';
import { resolveLineConfig, type LineEndpointConfig } from './protocol.js';
import type { LineClientEventMap } from './client.js';
import { httpHostToken } from '@zhin.js/host-http';

export class LineAdapter extends Adapter<LineEndpoint, LineEndpointConfig, LineClientEventMap> {
  readonly #context: AdapterContext<LineEndpointConfig>;
  constructor(context: AdapterContext<LineEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] { return ['channelSecret', 'channelAccessToken', 'webhookPath', 'apiBaseUrl']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['channelAccessToken', 'apiBaseUrl']; }
  protected override async identifyConfiguration(input: LineEndpointConfig, signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    const config = resolveLineConfig(input);
    const response = await new LineApiClient({ config, fetch: globalThis.fetch, signal }).request<{ userId?: unknown }>('/v2/bot/info');
    if (typeof response.userId !== 'string' || !response.userId) throw new Error('LINE identity verification returned no userId');
    return JSON.stringify(['line', new URL(config.apiBaseUrl).origin, response.userId]);
  }
  protected override validateConfiguration(config: LineEndpointConfig): void { resolveLineConfig(config); }
  protected createEndpoint(input: LineEndpointConfig, execution: EndpointCreationContext): LineEndpoint {
    const config = resolveLineConfig(input);
    return new LineEndpoint({ id: execution.canonicalId, config, http: this.#context.use(httpHostToken) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'line': LineAdapter; }
}
