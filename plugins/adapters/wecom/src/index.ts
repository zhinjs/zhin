/**
 * 企业微信适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type ToolFeature } from 'zhin.js';
import type { Router } from '@zhin.js/host-router/router';
import { WecomAdapter } from './adapter.js';
import {
  registerWecomPlatformPermitChecker,
} from './platform-permit.js';
import { setWecomAgentDeps } from './wecom-agent-deps.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    wecom: WecomAdapter;
  }
}

export * from './types.js';
export { WecomEndpoint } from './endpoint.js';
export { WecomAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext('router', (router: Router) => {
  provide({
    name: 'wecom',
    description: 'WeCom (企业微信) Endpoint Adapter',
    mounted: async (p: Plugin) => {
      const adapter = new WecomAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: WecomAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'wecom', (toolService: ToolFeature, wecom: WecomAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerWecomPlatformPermitChecker());
  setWecomAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = wecom.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => wecom,
  });
  return () => disposers.forEach(d => d());
});
