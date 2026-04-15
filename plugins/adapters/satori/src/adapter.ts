/**
 * Satori 适配器：单一适配器支持 WS 正向 / Webhook，由 config.connection 区分
 * 协议文档：https://satori.chat/zh-CN/introduction.html
 */
import type { Router } from '@zhin.js/http';
import { Adapter, Plugin } from 'zhin.js';
import { SatoriWsClient } from './bot-ws.js';
import { SatoriWebhookBot } from './bot-webhook.js';
import type {
  SatoriBotConfig,
  SatoriWsConfig,
  SatoriWebhookConfig,
} from './types.js';
import type { SatoriEventBody } from './types.js';

export type SatoriBot = SatoriWsClient | SatoriWebhookBot;

export class SatoriAdapter extends Adapter<SatoriBot> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'satori', []);
  }

  createBot(config: SatoriBotConfig): SatoriBot {
    switch (config.connection) {
      case 'ws':
        return new SatoriWsClient(this, config as SatoriWsConfig);
      case 'webhook':
        if (!this.#router) {
          throw new Error('Satori connection: webhook 需要 router，请安装并在配置中启用 @zhin.js/http');
        }
        return new SatoriWebhookBot(this, this.#router, config as SatoriWebhookConfig);
      default:
        throw new Error(`Unknown Satori connection: ${(config as SatoriBotConfig).connection}`);
    }
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
    this.plugin.logger.info('Satori 适配器已启动');
  }
}
