import { LarkClient, type LarkClientEventMap } from './client.js';
import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { LarkEndpoint } from './endpoint.js';
import { resolveLarkConfig, type LarkEndpointConfig } from './protocol.js';
import { httpHostToken } from '@zhin.js/host-http';

export class LarkAdapter extends Adapter<LarkEndpoint, LarkEndpointConfig, LarkClientEventMap> {
  readonly #context: AdapterContext<LarkEndpointConfig>;
  constructor(context: AdapterContext<LarkEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appId', 'isFeishu']; }
  override get configurationUpdateFields(): readonly string[] { return ['appSecret', 'encryptKey', 'verificationToken', 'mode', 'webhookPath', 'apiBaseUrl', 'webApiProxy', 'streamProxy']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['appSecret', 'apiBaseUrl']; }
  protected override async identifyConfiguration(input: LarkEndpointConfig, signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    const config = resolveLarkConfig(input), client = new LarkClient({ id: this.descriptor.id, config, signal });
    try {
      const response = await client.request<{ code?: number; bot?: { open_id?: unknown } }>({ url: `${config.apiBaseUrl}/bot/v3/info`, method: 'GET' });
      if (response.code !== 0 || typeof response.bot?.open_id !== 'string' || !response.bot.open_id) throw new Error('Lark identity verification returned no bot open_id');
      return JSON.stringify(['lark', new URL(config.apiBaseUrl).origin, response.bot.open_id]);
    } finally { await client[Symbol.asyncDispose](); }
  }
  protected override validateConfiguration(config: LarkEndpointConfig): void { resolveLarkConfig(config); }
  protected createEndpoint(input: LarkEndpointConfig, execution: EndpointCreationContext): LarkEndpoint {
    const config = resolveLarkConfig(input);
    return new LarkEndpoint({ id: execution.canonicalId, config, ...(config.mode === 'websocket' ? {} : { http: this.#context.use(httpHostToken) }) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'lark': LarkAdapter; }
}
