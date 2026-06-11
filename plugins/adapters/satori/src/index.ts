/**
 * Satori 适配器入口：单一适配器，支持 WS / Webhook，协议文档 https://satori.chat/zh-CN/introduction.html
 */
import { usePlugin, type Plugin, type Context } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { SatoriAdapter } from './adapter.js';

export * from './types.js';
export { callSatoriApi } from './api.js';
export * from './utils.js';
export { SatoriWsClient } from './endpoint-ws.js';
export { SatoriWebhookEndpoint } from './endpoint-webhook.js';
export { SatoriAdapter, type SatoriBot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    satori: SatoriAdapter;
  }
}

const { provide } = usePlugin();
provide({
  name: 'satori',
  description: 'Satori 协议适配器（WS 正向 / Webhook）',
  mounted: async (p: Plugin) => {
    const adapter = new SatoriAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SatoriAdapter) => {
    await adapter.stop();
  },
} as unknown as Context<'satori'>);
