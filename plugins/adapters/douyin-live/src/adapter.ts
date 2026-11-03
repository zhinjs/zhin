import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import type { DouyinLiveClientEventMap } from './client.js';
import { DouyinLiveEndpoint } from './endpoint.js';
import { resolveDouyinLiveConfig, type DouyinLiveEndpointConfig } from './protocol.js';

export class DouyinLiveAdapter extends Adapter<DouyinLiveEndpoint, DouyinLiveEndpointConfig, DouyinLiveClientEventMap> {
  constructor(_context: AdapterContext<DouyinLiveEndpointConfig>) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['roomId', 'cookie', 'sendMode', 'maxLength', 'maxChunks', 'minSendIntervalSec', 'signerUrl'];
  }
  protected override validateConfiguration(config: DouyinLiveEndpointConfig): void { resolveDouyinLiveConfig(config); }
  protected createEndpoint(input: DouyinLiveEndpointConfig, execution: EndpointCreationContext): DouyinLiveEndpoint {
    return new DouyinLiveEndpoint({ id: execution.canonicalId, config: resolveDouyinLiveConfig(input), signal: execution.signal });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'douyin-live': DouyinLiveAdapter; }
}
