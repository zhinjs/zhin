/**
 * NapCat 适配器入口
 * 支持 OneBot11 标准 + go-cqhttp 扩展 + NapCat 独有 API
 * 连接方式：正向 WS / 反向 WS / HTTP
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from 'zhin.js';
import { NapCatAdapter } from './adapter.js';
import { createNapCatTools } from './tools.js';

export * from './types.js';
export { NapCatWsClient } from './bot-ws-client.js';
export { NapCatWsServer } from './bot-ws-server.js';
export { NapCatHttpBot } from './bot-http.js';
export { NapCatAdapter, type NapCatBot } from './adapter.js';
export { NapCatBotBase } from './bot-base.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    napcat: NapCatAdapter;
  }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: 'napcat',
  description: 'NapCatQQ 适配器（OneBot11 + go-cqhttp + NapCat 扩展，正向/反向 WS + HTTP）',
  mounted: async (p: Plugin) => {
    const adapter = new NapCatAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: NapCatAdapter) => {
    await adapter.stop();
  },
} as unknown as Context<'napcat'>);

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
