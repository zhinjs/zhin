/**
 * Milky 适配器入口：单一适配器，支持 WS/SSE/Webhook/反向 WS，依赖 router 注册
 */
import { usePlugin, createSceneManagementTools, registerDefaultScenePlatformPermitChecker, type Plugin, type Context, type ToolFeature, type ISceneManagement } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { MilkyAdapter } from './adapter.js';

import { setMilkyAgentDeps } from './milky-agent-deps.js';

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
  disposers.push(registerDefaultScenePlatformPermitChecker('milky'));
  setMilkyAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = milky.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => milky,
  });
  const sceneTools = createSceneManagementTools(milky as unknown as ISceneManagement, 'milky');
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));
  return () => disposers.forEach(d => d());
});
