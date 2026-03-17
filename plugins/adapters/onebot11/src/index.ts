/**
 * OneBot11 适配器入口：单一适配器，支持正向 WS / 反向 WS（connection: ws | wss）
 */
import { usePlugin, type Plugin, type Context } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import { OneBot11Adapter } from './adapter.js';

export * from './types.js';
export { OneBot11WsClient } from './bot-ws-client.js';
export { OneBot11WsServer } from './bot-ws-server.js';
export { OneBot11Adapter, type OneBot11Bot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    onebot11: OneBot11Adapter;
  }
}

const { provide } = usePlugin();
provide({
  name: 'onebot11',
  description: 'OneBot11 协议适配器（正向 WS / 反向 WS）',
  mounted: async (p: Plugin) => {
    const adapter = new OneBot11Adapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: OneBot11Adapter) => {
    await adapter.stop();
  },
} as unknown as Context<'onebot11'>);
