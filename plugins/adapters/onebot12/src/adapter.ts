/**
 * OneBot 12 适配器：单一适配器支持正向 WS / Webhook / 反向 WS，由 config.connection 区分
 * 协议文档：https://12.onebot.dev/
 */
import { formatCompact, Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { OneBot12WsClient } from './endpoint-ws.js';
import { OneBot12WebhookEndpoint } from './endpoint-webhook.js';
import { OneBot12WssServer } from './endpoint-wss.js';
import type {
  OneBot12EndpointConfig,
  OneBot12WsConfig,
  OneBot12WebhookConfig,
  OneBot12WssConfig,
} from './types.js';

export type OneBot12Bot = OneBot12WsClient | OneBot12WebhookEndpoint | OneBot12WssServer;

export class OneBot12Adapter extends Adapter<OneBot12Bot> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;
  static override interactivePolicy = 'text' as const;

  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'onebot12', []);
  }

  createEndpoint(config: OneBot12EndpointConfig): OneBot12Bot {
    switch (config.connection) {
      case 'ws':
        return new OneBot12WsClient(this, config as OneBot12WsConfig);
      case 'webhook':
        if (!this.#router) {
          throw new Error('OneBot12 connection: webhook 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        }
        return new OneBot12WebhookEndpoint(this, this.#router, config as OneBot12WebhookConfig);
      case 'wss':
        if (!this.#router) {
          throw new Error('OneBot12 connection: wss 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        }
        return new OneBot12WssServer(this, this.#router, config as OneBot12WssConfig);
      default:
        throw new Error(`Unknown OneBot12 connection: ${(config as OneBot12EndpointConfig).connection}`);
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
