/**
 * 企业微信适配器
 */
import { Adapter, Plugin } from 'zhin.js';
import { WecomEndpoint } from './endpoint.js';
import type { WecomEndpointConfig } from './types.js';

export class WecomAdapter extends Adapter<WecomEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  #router: any;

  constructor(plugin: Plugin, router: any) {
    super(plugin, 'wecom', []);
    this.#router = router;
  }

  createEndpoint(config: WecomEndpointConfig): WecomEndpoint {
    return new WecomEndpoint(this, this.#router, config);
  }

  async start(): Promise<void> {
    await super.start();
  }
}
