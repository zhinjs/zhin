/**
 * Slack 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type ISceneManagement, createSceneManagementTools, type ToolFeature } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { SlackAdapter } from './adapter.js';
import { SlackEventDispatcher } from './event-dispatcher.js';
import { SlackHttpTransport } from './transport-http.js';
import {
  registerSlackPlatformPermitChecker,
  slackGroupPermitResolver,
} from './platform-permit.js';
import { setSlackAgentDeps } from './slack-agent-deps.js';

declare module 'zhin.js' {
  interface Adapters {
    slack: SlackAdapter;
  }
}

export * from './types.js';
export { SlackEndpoint } from './endpoint.js';
export { SlackAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: 'slack',
  description: 'Slack Endpoint Adapter',
  mounted: async (p: Plugin) => {
    const adapter = new SlackAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SlackAdapter) => {
    await adapter.stop();
  },
});

useContext('router', 'slack', (router: Router, slack: SlackAdapter) => {
  for (const [, endpoint] of slack.endpoints) {
    if (!endpoint.$config.socketMode) {
      const dispatcher = new SlackEventDispatcher(endpoint);
      const transport = new SlackHttpTransport(endpoint.$config, dispatcher, endpoint.logger);
      transport.registerRoutes(router);
    }
  }
  return () => {};
});

useContext('tool', 'slack', (toolService: ToolFeature, slack: SlackAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerSlackPlatformPermitChecker());

  function getEndpoint(endpointId: string) {
    const endpoint = slack.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint;
  }

  setSlackAgentDeps({ getEndpoint, getAdapter: () => slack });

  const sceneTools = createSceneManagementTools(
    slack as unknown as ISceneManagement,
    'slack',
    { permitResolver: slackGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});
