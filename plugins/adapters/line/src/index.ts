/**
 * LINE Messaging API 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from 'zhin.js';
import { LineAdapter } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    line: LineAdapter;
  }
}

export * from './types.js';
export { LineEndpoint } from './endpoint.js';
export { LineAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext('router', (router: any) => {
  provide({
    name: 'line',
    description: 'LINE Messaging API Endpoint Adapter',
    mounted: async (p: Plugin) => {
      const adapter = new LineAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LineAdapter) => {
      await adapter.stop();
    },
  });
});
