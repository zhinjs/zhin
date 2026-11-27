import { LarkClient, type LarkClientEventMap, type LarkFetch } from './client.js';
import { Adapter, type AdapterContext, type ConfigurationIdentityContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { LarkEndpoint } from './endpoint.js';
import { resolveLarkConfig, type LarkEndpointConfig } from './protocol.js';
import { httpHostToken } from '@zhin.js/host-http';
import { larkFailureReason } from './failure-reason.js';

export { larkFailureReason };

export class LarkAdapter extends Adapter<LarkEndpoint, LarkEndpointConfig, LarkClientEventMap> {
  readonly #context: AdapterContext<LarkEndpointConfig>;
  readonly #fetch?: LarkFetch;
  /** `fetch` replaces the identity lookup's transport (tests); Endpoints keep their own. */
  constructor(context: AdapterContext<LarkEndpointConfig>, options: { readonly fetch?: LarkFetch } = {}) {
    super(); this.#context = context; this.#fetch = options.fetch;
  }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appId', 'isFeishu']; }
  override get configurationUpdateFields(): readonly string[] { return ['appSecret', 'encryptKey', 'verificationToken', 'mode', 'webhookPath', 'apiBaseUrl', 'webApiProxy', 'streamProxy', 'streaming', 'streamingIntervalMs']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['appSecret', 'apiBaseUrl']; }
  /**
   * #1250 b115: the identity is the app (appId) on its platform region — the API origin, since Feishu
   * (open.feishu.cn) and Lark Suite (open.larksuite.com) are separate platforms. The saved configuration
   * (`role: 'previous'`) is answered offline: its appSecret may already be reset or revoked, which is why
   * it is being rotated. Only the proposed configuration is proved, by reading the bot with its credentials.
   */
  protected override async identifyConfiguration(input: LarkEndpointConfig, signal: AbortSignal, _changed: readonly string[],
    context?: ConfigurationIdentityContext): Promise<string | undefined> {
    const config = resolveLarkConfig(input);
    signal.throwIfAborted();
    const identity = JSON.stringify(['lark', new URL(config.apiBaseUrl).origin, config.appId]);
    if (context?.role === 'previous') return identity;
    const client = new LarkClient({ id: this.descriptor.id, config, signal, ...(this.#fetch ? { fetch: this.#fetch } : {}) });
    try {
      const response = await client.request<{ code?: number; msg?: unknown; bot?: { open_id?: unknown } }>({ url: `${config.apiBaseUrl}/bot/v3/info`, method: 'GET' });
      // #1250 b111: a refused lookup says why (Lark's code and msg), without credentials.
      if (response.code !== 0) throw new Error(`Lark identity verification failed: ${larkFailureReason(response, [config.appSecret, config.encryptKey, config.verificationToken])}`);
      if (typeof response.bot?.open_id !== 'string' || !response.bot.open_id) throw new Error('Lark identity verification returned no bot open_id');
      return identity;
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
