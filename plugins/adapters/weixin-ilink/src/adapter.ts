import { join } from 'node:path';
import { Adapter, type EndpointCreationContext } from 'zhin.js/adapter';
import { WeixinIlinkEndpoint } from './endpoint.js';
import { resolveWeixinIlinkConfig, type WeixinIlinkEndpointConfig } from './protocol.js';
import type { WeixinIlinkClientEventMap } from './client.js';

export class WeixinIlinkAdapter extends Adapter<WeixinIlinkEndpoint, WeixinIlinkEndpointConfig, WeixinIlinkClientEventMap> {
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] { return ['botToken', 'botAgent', 'baseUrl', 'cdnBaseUrl', 'longPollTimeoutMs', 'dataDir']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['botToken', 'baseUrl', 'dataDir']; }
  protected override prepareConfiguration(input: WeixinIlinkEndpointConfig, identity: Readonly<{ instanceId: string }>): WeixinIlinkEndpointConfig {
    const config = resolveWeixinIlinkConfig(input);
    return { ...input, dataDir: join(config.dataDir, 'accounts', identity.instanceId) };
  }
  protected override validateConfiguration(config: WeixinIlinkEndpointConfig): void { resolveWeixinIlinkConfig(config); }
  protected createEndpoint(input: WeixinIlinkEndpointConfig, execution: EndpointCreationContext): WeixinIlinkEndpoint {
    const config = resolveWeixinIlinkConfig(input);
    return new WeixinIlinkEndpoint({ id: execution.canonicalId, config });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'weixin-ilink': WeixinIlinkAdapter; }
}
