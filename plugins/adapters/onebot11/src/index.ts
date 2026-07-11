/**
 * OneBot11 适配器入口：单一适配器，支持正向 WS / 反向 WS（connection: ws | wss）
 */
import { usePlugin, type Plugin, type Context, type ISceneManagement, createSceneManagementTools, registerDefaultScenePlatformPermitChecker, type ToolFeature } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { OneBot11Adapter } from './adapter.js';
import { setOnebot11AgentDeps } from './onebot11-agent-deps.js';

export * from './types.js';
export { OneBot11WsClient } from './endpoint-ws-client.js';
export { OneBot11WsServer } from './endpoint-ws-server.js';
export { OneBot11Adapter, type OneBot11Bot } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    onebot11: OneBot11Adapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;
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

useContext('tool', 'onebot11', (toolService: ToolFeature, onebot11: OneBot11Adapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerDefaultScenePlatformPermitChecker('onebot11'));
  setOnebot11AgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = onebot11.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => onebot11,
  });
  const sceneTools = createSceneManagementTools(
    onebot11 as unknown as ISceneManagement,
    'onebot11',
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));
  return () => disposers.forEach(d => d());
});
