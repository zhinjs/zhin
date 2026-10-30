import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import { BilibiliApiError, BilibiliClient, type BilibiliClientEventMap } from './client.js';
import { BilibiliEndpoint } from './endpoint.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from './protocol.js';
import { bilibiliNotifierToken } from './bilibili-runtime-state.js';
import { formatNotice } from './review.js';

export class BilibiliAdapter extends Adapter<BilibiliEndpoint, BilibiliEndpointConfig, BilibiliClientEventMap> {
  readonly #context: AdapterContext<BilibiliEndpointConfig>;
  constructor(context: AdapterContext<BilibiliEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['sessdata', 'biliJct', 'apiBaseUrl']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['sessdata', 'biliJct', 'videos', 'pollIntervalSec', 'sendMode', 'minSendIntervalSec', 'notifications', 'notificationScope', 'notify', 'apiBaseUrl', 'passportBaseUrl'];
  }
  protected override validateConfiguration(config: BilibiliEndpointConfig): void { resolveBilibiliConfig(config); }
  protected override prepareConfiguration(config: BilibiliEndpointConfig, identity: Readonly<{ instanceId: string }>): BilibiliEndpointConfig {
    return { ...config, stateDirectoryId: identity.instanceId };
  }
  protected override async identifyConfiguration(input: BilibiliEndpointConfig, signal: AbortSignal): Promise<string | undefined> {
    const config = resolveBilibiliConfig(input);
    if (!config.sessdata) return undefined;
    const client = new BilibiliClient(config, globalThis.fetch, signal);
    let nav: { isLogin?: boolean; mid?: unknown } | undefined;
    try { nav = await client.request('/x/web-interface/nav'); }
    catch (error) {
      signal.throwIfAborted();
      // Preserve this platform's existing getNav contract for its logged-out code.
      if (error instanceof BilibiliApiError && error.code === -101) return undefined;
      throw error;
    }
    signal.throwIfAborted();
    if (nav?.isLogin === false) return undefined;
    if (nav?.isLogin !== true || (typeof nav.mid !== 'string' && typeof nav.mid !== 'number')
      || !String(nav.mid).trim() || nav.mid === 0 || nav.mid === '0') throw new Error('Bilibili returned an invalid logged-in identity');
    return `bilibili:${nav.mid}`;
  }
  protected createEndpoint(input: BilibiliEndpointConfig, execution: EndpointCreationContext): BilibiliEndpoint {
    const config = resolveBilibiliConfig(input);
    const notifier = this.#context.use(bilibiliNotifierToken);
    const logger = getAdapterLogger('bilibili', config.id);
    return new BilibiliEndpoint({ id: execution.canonicalId, config, configuration: input, signal: execution.signal,
      stateDir: config.dataDir,
      reconcileLogin: login => this.acceptVerifiedLogin(execution, login),
      notify: async notice => {
        if (!config.notify) return;
        if (!await notifier(config.notify, formatNotice(notice, { formatCommand: path => path }))) {
          logger.info(formatCompact({ op: 'bilibili_notify_skipped', kind: notice.kind, hint: '没有可用的出站通道' }));
        }
      },
    });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly bilibili: BilibiliAdapter; }
}
