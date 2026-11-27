import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
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
   * #1250 b115: a rotated appSecret is proved by one `gettoken` with appKey + appSecret; the
   * identity is the app on that API origin. A refusal carries DingTalk's errcode / errmsg, never the secret.
   */
  protected override async identifyConfiguration(input: DingTalkEndpointConfig, signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    const config = resolveDingTalkConfig(input);
    signal.throwIfAborted();
    try {
      await requestDingTalkAccessToken(config, this.#fetch, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    } catch (error) {
      signal.throwIfAborted();
      const reason = error instanceof Error ? error.message.replace(/^Failed to get access token: /, '') : 'unknown';
      throw new Error(`DingTalk identity verification failed: ${reason}`);
    }
    return JSON.stringify(['dingtalk', new URL(config.apiBaseUrl).origin, config.appKey]);
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
