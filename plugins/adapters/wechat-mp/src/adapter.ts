import { Adapter, AdapterIdentityUnsupportedError, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { WeChatMpEndpoint } from './endpoint.js';
import { resolveWeChatMpConfig, type WeChatMpEndpointConfig } from './protocol.js';
import type { WeChatMpClientEventMap } from './client.js';
import { httpHostToken } from '@zhin.js/host-http';

export class WeChatMpAdapter extends Adapter<WeChatMpEndpoint, WeChatMpEndpointConfig, WeChatMpClientEventMap> {
  readonly #context: AdapterContext<WeChatMpEndpointConfig>;
  constructor(context: AdapterContext<WeChatMpEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appId']; }
  override get configurationUpdateFields(): readonly string[] { return ['appSecret', 'token', 'encodingAESKey', 'path', 'encrypt', 'encryptMode', 'replyMode', 'passiveReplyTimeoutMs']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['appSecret']; }
  /**
   * #1250 b115: no read-only proof of a rotated appSecret. `cgi-bin/token` starts the running token's expiry
   * countdown and spends the daily quota; the stable_token route could not be confirmed against WeChat's
   * documentation here, so a secret change is refused with a reason instead of the generic one.
   */
  protected override identifyConfiguration(_input: WeChatMpEndpointConfig, _signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    return Promise.reject(new AdapterIdentityUnsupportedError('微信公众号暂不支持只换密钥，请使用替换账号'));
  }
  protected override validateConfiguration(config: WeChatMpEndpointConfig): void { resolveWeChatMpConfig(config); }
  protected createEndpoint(input: WeChatMpEndpointConfig, execution: EndpointCreationContext): WeChatMpEndpoint {
    const config = resolveWeChatMpConfig(input);
    return new WeChatMpEndpoint({ id: execution.canonicalId, config, http: this.#context.use(httpHostToken) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'wechat-mp': WeChatMpAdapter; }
}
