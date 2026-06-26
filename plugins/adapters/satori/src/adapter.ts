/**
 * Satori 适配器：单一适配器支持 WS 正向 / Webhook，由 config.connection 区分
 * 协议文档：https://satori.chat/zh-CN/introduction.html
 */
import { formatCompact, Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { SatoriWsClient } from './endpoint-ws.js';
import { SatoriWebhookEndpoint } from './endpoint-webhook.js';
import type {
  SatoriEndpointConfig,
  SatoriWsConfig,
  SatoriWebhookConfig,
} from './types.js';
import type { SatoriEventBody } from './types.js';

export type SatoriBot = SatoriWsClient | SatoriWebhookEndpoint;

export class SatoriAdapter extends Adapter<SatoriBot> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;
  static override interactivePolicy = 'text' as const;

  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'satori', []);
  }

  createEndpoint(config: SatoriEndpointConfig): SatoriBot {
    switch (config.connection) {
      case 'ws':
        return new SatoriWsClient(this, config as SatoriWsConfig);
      case 'webhook':
        if (!this.#router) {
          throw new Error('Satori connection: webhook 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        }
        return new SatoriWebhookEndpoint(this, this.#router, config as SatoriWebhookConfig);
      default:
        throw new Error(`Unknown Satori connection: ${(config as SatoriEndpointConfig).connection}`);
    }
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
  }
}
