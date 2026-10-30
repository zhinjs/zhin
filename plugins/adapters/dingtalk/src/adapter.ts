import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { DingTalkEndpoint } from './endpoint.js';
import { resolveDingTalkConfig, type DingTalkEndpointConfig } from './protocol.js';
import type { DingtalkClientEventMap } from './client.js';
import { httpHostToken } from '@zhin.js/host-http';

export class DingTalkAdapter extends Adapter<DingTalkEndpoint, DingTalkEndpointConfig, DingtalkClientEventMap> {
  readonly #context: AdapterContext<DingTalkEndpointConfig>;
  constructor(context: AdapterContext<DingTalkEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appKey', 'robotCode']; }
  override get configurationUpdateFields(): readonly string[] { return ['appSecret', 'mode', 'webhookPath', 'apiBaseUrl', 'streamProxy', 'cardTemplateId', 'cardButtonCount']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['appSecret', 'apiBaseUrl']; }
  protected override validateConfiguration(config: DingTalkEndpointConfig): void { resolveDingTalkConfig(config); }
  protected createEndpoint(input: DingTalkEndpointConfig, execution: EndpointCreationContext): DingTalkEndpoint {
    const config = resolveDingTalkConfig(input);
    return new DingTalkEndpoint({ id: execution.canonicalId, config, ...(config.mode === 'stream' ? {} : { http: this.#context.use(httpHostToken) }) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'dingtalk': DingTalkAdapter; }
}
