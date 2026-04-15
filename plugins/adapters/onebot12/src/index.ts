/**
 * OneBot 12 适配器入口：单一适配器，支持正向 WS / Webhook / 反向 WS
 * 协议文档 https://12.onebot.dev/
 */
import { usePlugin, type Plugin, type Context } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import { OneBot12Adapter } from './adapter.js';

export * from './types.js';
export { callOneBot12Action } from './api.js';
export * from './utils.js';
export { OneBot12WsClient } from './bot-ws.js';
export { OneBot12WebhookBot } from './bot-webhook.js';
export { OneBot12WssServer } from './bot-wss.js';
export { OneBot12Adapter, type OneBot12Bot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    onebot12: OneBot12Adapter;
  }
}

const { provide } = usePlugin();
provide({
  name: 'onebot12',
  description: 'OneBot 12 协议适配器（正向 WS / Webhook / 反向 WS）',
  mounted: async (p: Plugin) => {
    const adapter = new OneBot12Adapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: OneBot12Adapter) => {
    await adapter.stop();
  },
} as unknown as Context<'onebot12'>);
