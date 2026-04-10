/**
 * OneBot11 适配器入口：单一适配器，支持正向 WS / 反向 WS（connection: ws | wss）
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from 'zhin.js';
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
  const groupTools = createGroupManagementTools(
    onebot11 as unknown as IGroupManagement,
    'onebot11',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, plugin.name));

  // Platform-specific tool: set title
  disposers.push(toolService.addTool({
    name: 'onebot11_set_title',
    description: '设置 QQ 群成员的专属头衔。只有群主才能设置。',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        group_id: { type: 'number', description: '目标群号' },
        user_id: { type: 'number', description: '目标成员 QQ号' },
        title: { type: 'string', description: '头衔文字' },
      },
      required: ['bot', 'group_id', 'user_id', 'title'],
    },
    platforms: ['onebot11'],
    tags: ['onebot11'],
    execute: async (args: Record<string, any>) => {
      const bot = onebot11.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setTitle(args.group_id, args.user_id, args.title);
      return { success, message: success ? `已将 ${args.user_id} 的头衔设为 "${args.title}"` : '设置失败' };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});
