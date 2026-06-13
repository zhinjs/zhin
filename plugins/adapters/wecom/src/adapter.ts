/**
 * 企业微信适配器
 */
import { Adapter, Plugin } from 'zhin.js';
import type { Router } from '@zhin.js/host-router/router';
import { WecomEndpoint } from './endpoint.js';
import type { WecomEndpointConfig } from './types.js';

export class WecomAdapter extends Adapter<WecomEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  #router: Router;

  constructor(plugin: Plugin, router: Router) {
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
