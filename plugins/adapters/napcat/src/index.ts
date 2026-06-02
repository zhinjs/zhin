/**
 * NapCat 适配器入口
 * 支持 OneBot11 标准 + go-cqhttp 扩展 + NapCat 独有 API
 * 连接方式：正向 WS / 反向 WS / HTTP
 */
import path from 'path';
import {
  usePlugin,
  type Plugin,
  type Context,
  type IGroupManagement,
  createGroupManagementTools,
  type ToolFeature,
  registerAgentPromptContributor,
  unregisterAgentPromptContributor,
} from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { PageManager } from '@zhin.js/host-api';
import { NapCatAdapter } from './adapter.js';
import { createNapCatTools } from './tools.js';
import { createNapCatAgentPromptContributor } from './agent-prompt.js';
import { registerRoutes } from './routes.js';

export * from './types.js';
export { NapCatWsClient } from './bot-ws-client.js';
export { NapCatWsServer } from './bot-ws-server.js';
export { NapCatHttpBot } from './bot-http.js';
export { NapCatAdapter, type NapCatBot } from './adapter.js';
export { NapCatBotBase } from './bot-base.js';
export {
  NapCatTypingIndicatorManager,
  enableTypingIndicator,
  type NapCatTypingIndicatorConfig,
} from './typing-indicator.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: Router;
    }
  }
  interface Adapters {
    napcat: NapCatAdapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

// ── 适配器注册 ─────────────────────────────────────────────────────
provide({
  name: 'napcat',
  description: 'NapCatQQ 适配器（OneBot11 + go-cqhttp + NapCat 扩展，正向/反向 WS + HTTP）',
  mounted: async (p: Plugin) => {
    registerAgentPromptContributor(createNapCatAgentPromptContributor());
    const adapter = new NapCatAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: NapCatAdapter) => {
    unregisterAgentPromptContributor('napcat');
    await adapter.stop();
  },
} as unknown as Context<'napcat'>);

// ── AI 工具注册 ────────────────────────────────────────────────────
useContext('tool', 'napcat', (toolService: ToolFeature, napcat: NapCatAdapter) => {
  const disposers: (() => void)[] = [];

  const groupTools = createGroupManagementTools(
    napcat as unknown as IGroupManagement,
    'napcat',
  );
  disposers.push(...groupTools.map(t => toolService.addTool(t, plugin.name)));

  const napcatTools = createNapCatTools(napcat);
  disposers.push(...napcatTools.map(t => toolService.addTool(t, plugin.name)));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台入口 ─────────────────────────────────────────────────
useContext('web', (pageManager) => {
  pageManager.addEntry({
    id: 'napcat',
    development: path.resolve(import.meta.dirname, '../client/index.tsx'),
    production: path.resolve(import.meta.dirname, '../dist/index.js'),
    meta: { name: 'NapCat' },
  });
});

// ── HTTP 路由 ──────────────────────────────────────────────────────
useContext('router', 'napcat', async (router: Router, napcat: NapCatAdapter) => {
  registerRoutes(router, napcat);
});
