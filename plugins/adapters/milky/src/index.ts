/**
 * Milky 适配器入口：单一适配器，支持 WS/SSE/Webhook/反向 WS，依赖 router 注册
 */
import { usePlugin, type Plugin, type Context } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import type { McpToolRegistry } from '@zhin.js/mcp';
import { registerGroupManagementMcpTools } from '@zhin.js/mcp/adapter-tools-helper';
import { MilkyAdapter } from './adapter.js';
import type { IGroupManagement } from 'zhin.js';

export * from './types.js';
export { callApi } from './api.js';
export * from './utils.js';
export { MilkyWsClient } from './bot-ws.js';
export { MilkySseClient } from './bot-sse.js';
export { MilkyWebhookBot } from './bot-webhook.js';
export { MilkyWssServer } from './bot-wss.js';
export { MilkyAdapter, type MilkyBot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
      mcp: McpToolRegistry;
    }
  }
  interface Adapters {
    milky: MilkyAdapter;
  }
}

const { provide, useContext } = usePlugin();
provide({
  name: 'milky',
  description: 'Milky Adapter（WS 正向 / SSE / Webhook / 反向 WS）',
  mounted: async (p: Plugin) => {
    const adapter = new MilkyAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: MilkyAdapter) => {
    await adapter.stop();
  },
} as unknown as Context<'milky'>);

useContext('mcp' as any, 'milky', (mcp: McpToolRegistry, milky: MilkyAdapter) => {
  return registerGroupManagementMcpTools(mcp, milky as unknown as IGroupManagement & { bots: Map<string, any> }, 'milky');
});
