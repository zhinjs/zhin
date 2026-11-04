import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import { JuejinClient, type JuejinClientEventMap, type JuejinFetch } from './client.js';
import { JuejinEndpoint } from './endpoint.js';
import { resolveJuejinConfig, type JuejinEndpointConfig } from './protocol.js';
import { juejinNotifierToken } from './juejin-runtime-state.js';
import { formatNotice } from './review.js';

export class JuejinAdapter extends Adapter<JuejinEndpoint, JuejinEndpointConfig, JuejinClientEventMap> {
  readonly #context: AdapterContext<JuejinEndpointConfig>;
  constructor(context: AdapterContext<JuejinEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['cookie', 'apiBaseUrl']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['cookie', 'articles', 'pollIntervalSec', 'sendMode', 'minSendIntervalSec', 'notify', 'apiBaseUrl'];
  }
  protected override validateConfiguration(config: JuejinEndpointConfig): void { resolveJuejinConfig(config); }
  protected override prepareConfiguration(config: JuejinEndpointConfig, identity: Readonly<{ instanceId: string }>): JuejinEndpointConfig {
    return { ...config, stateDirectoryId: identity.instanceId };
  }
  protected override async identifyConfiguration(input: JuejinEndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveJuejinConfig(input);
    if (!config.cookie) return undefined;
    const self = await new JuejinClient(config, globalThis.fetch as unknown as JuejinFetch, signal).getSelf();
    signal.throwIfAborted();
    return self ? `juejin:${self.userId}` : undefined;
  }
  protected createEndpoint(input: JuejinEndpointConfig, execution: EndpointCreationContext): JuejinEndpoint {
    const config = resolveJuejinConfig(input);
    const notifier = this.#context.use(juejinNotifierToken);
    const logger = getAdapterLogger('juejin', config.id);
    return new JuejinEndpoint({ id: execution.canonicalId, config, signal: execution.signal,
      stateDir: config.dataDir,
      notify: async notice => {
        if (!config.notify) return;
        if (!await notifier(config.notify, formatNotice(notice, { formatCommand: path => path }))) {
          logger.info(formatCompact({ op: 'juejin_notify_skipped', kind: notice.kind, hint: '没有可用的出站通道' }));
        }
      },
    });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly juejin: JuejinAdapter; }
}
