import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
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
  protected override validateConfiguration(config: WeChatMpEndpointConfig): void { resolveWeChatMpConfig(config); }
  protected createEndpoint(input: WeChatMpEndpointConfig, execution: EndpointCreationContext): WeChatMpEndpoint {
    const config = resolveWeChatMpConfig(input);
    return new WeChatMpEndpoint({ id: execution.canonicalId, config, http: this.#context.use(httpHostToken) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'wechat-mp': WeChatMpAdapter; }
}
