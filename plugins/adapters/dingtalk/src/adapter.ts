import { Adapter, type AdapterContext, type ConfigurationIdentityContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { DingTalkEndpoint } from './endpoint.js';
import { resolveDingTalkConfig, type DingTalkEndpointConfig } from './protocol.js';
import { requestDingTalkAccessToken, type DingtalkClientEventMap, type DingTalkFetch } from './client.js';
import { httpHostToken } from '@zhin.js/host-http';

export class DingTalkAdapter extends Adapter<DingTalkEndpoint, DingTalkEndpointConfig, DingtalkClientEventMap> {
  readonly #context: AdapterContext<DingTalkEndpointConfig>;
  readonly #fetch: DingTalkFetch;
  constructor(context: AdapterContext<DingTalkEndpointConfig>, options: { readonly fetch?: DingTalkFetch } = {}) {
    super(); this.#context = context; this.#fetch = options.fetch ?? globalThis.fetch;
  }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appKey', 'robotCode']; }
  override get configurationUpdateFields(): readonly string[] { return ['appSecret', 'mode', 'webhookPath', 'apiBaseUrl', 'streamProxy', 'cardTemplateId', 'cardButtonCount']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['appSecret', 'apiBaseUrl']; }
  /**
   * #1250 b115: the identity is the app (appKey) alone. `apiBaseUrl` is only the API entry (it may be a
   * reverse proxy) and does not name another account, so changing it never replaces the account.
   * The saved configuration (`role: 'previous'`) is answered offline: its appSecret may already be reset
   * or revoked, which is why it is being rotated. Only the proposed configuration is proved, with one
   * `gettoken` (appKey + appSecret) on its `apiBaseUrl`; a refusal carries DingTalk's errcode / errmsg,
   * never the secret.
   */
  protected override async identifyConfiguration(input: DingTalkEndpointConfig, signal: AbortSignal, _changed: readonly string[],
    context?: ConfigurationIdentityContext): Promise<string | undefined> {
    const config = resolveDingTalkConfig(input);
    signal.throwIfAborted();
    const identity = JSON.stringify(['dingtalk', config.appKey]);
    if (context?.role === 'previous') return identity;
    try {
      await requestDingTalkAccessToken(config, this.#fetch, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    } catch (error) {
      signal.throwIfAborted();
      const reason = error instanceof Error ? error.message.replace(/^Failed to get access token: /, '') : 'unknown';
      throw new Error(`DingTalk identity verification failed: ${reason}`);
    }
    return identity;
  }
  protected override validateConfiguration(config: DingTalkEndpointConfig): void { resolveDingTalkConfig(config); }
  protected createEndpoint(input: DingTalkEndpointConfig, execution: EndpointCreationContext): DingTalkEndpoint {
    const config = resolveDingTalkConfig(input);
    return new DingTalkEndpoint({ id: execution.canonicalId, config, ...(config.mode === 'stream' ? {} : { http: this.#context.use(httpHostToken) }) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'dingtalk': DingTalkAdapter; }
}
