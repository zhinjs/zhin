import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { BilibiliLiveClient, type BilibiliLiveClientEventMap } from './client.js';
import { BilibiliLiveEndpoint } from './endpoint.js';
import { resolveBilibiliLiveConfig, type BilibiliLiveEndpointConfig } from './protocol.js';

export class BilibiliLiveAdapter extends Adapter<BilibiliLiveEndpoint, BilibiliLiveEndpointConfig, BilibiliLiveClientEventMap> {
  constructor(_context: AdapterContext<BilibiliLiveEndpointConfig>) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['sessdata', 'biliJct', 'apiBaseUrl']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['roomId', 'sessdata', 'biliJct', 'buvid3', 'sendMode', 'maxLength', 'maxChunks', 'minSendIntervalSec', 'apiBaseUrl', 'liveApiBaseUrl'];
  }
  protected override validateConfiguration(config: BilibiliLiveEndpointConfig): void { resolveBilibiliLiveConfig(config); }
  protected override async identifyConfiguration(input: BilibiliLiveEndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveBilibiliLiveConfig(input);
    if (!config.sessdata) return undefined;
    const client = new BilibiliLiveClient(config, globalThis.fetch, undefined, signal);
    const userId = await client.identifySelf();
    signal.throwIfAborted();
    if (userId === undefined) return undefined;
    return `bilibili:${userId}`;
  }
  protected createEndpoint(input: BilibiliLiveEndpointConfig, execution: EndpointCreationContext): BilibiliLiveEndpoint {
    return new BilibiliLiveEndpoint({ id: execution.canonicalId, config: resolveBilibiliLiveConfig(input), signal: execution.signal });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'bilibili-live': BilibiliLiveAdapter; }
}
