/**
 * Milky 适配器入口：单一适配器，支持 WS/SSE/Webhook/反向 WS，依赖 router 注册
 */
import { usePlugin, type Plugin, type Context, createGroupManagementTools, registerDefaultGroupPlatformPermitChecker, type ToolFeature } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { MilkyAdapter } from './adapter.js';
import type { IGroupManagement } from 'zhin.js';

export * from './types.js';
export { callApi } from './api.js';
export * from './utils.js';
export { MilkyWsClient } from './endpoint-ws.js';
export { MilkySseClient } from './endpoint-sse.js';
export { MilkyWebhookEndpoint } from './endpoint-webhook.js';
export { MilkyWssServer } from './endpoint-wss.js';
export { MilkyAdapter, type MilkyBot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    milky: MilkyAdapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;
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

useContext('tool', 'milky', (toolService: ToolFeature, milky: MilkyAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerDefaultGroupPlatformPermitChecker('milky'));
  const groupTools = createGroupManagementTools(milky as unknown as IGroupManagement, 'milky');
  disposers.push(...groupTools.map(t => toolService.addTool(t, plugin.name)));
  return () => disposers.forEach(d => d());
});
