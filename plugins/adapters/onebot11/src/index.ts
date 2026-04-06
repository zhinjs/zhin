/**
 * OneBot11 适配器入口：单一适配器，支持正向 WS / 反向 WS（connection: ws | wss）
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import type { McpToolRegistry } from '@zhin.js/mcp';
import { registerGroupManagementMcpTools } from '@zhin.js/mcp/adapter-tools-helper';
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

const { provide, useContext } = usePlugin();
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

useContext('mcp' as any, 'onebot11', (mcp: McpToolRegistry, onebot11: OneBot11Adapter) => {
  const disposeGroup = registerGroupManagementMcpTools(
    mcp,
    onebot11 as unknown as IGroupManagement & { bots: Map<string, any> },
    'onebot11',
  );

  // Platform-specific tool: set title
  mcp.addTool({
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
    handler: async (args: Record<string, any>) => {
      const bot = onebot11.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setTitle(args.group_id, args.user_id, args.title);
      return { success, message: success ? `已将 ${args.user_id} 的头衔设为 "${args.title}"` : '设置失败' };
    },
  });

  return () => {
    disposeGroup();
    mcp.removeTool('onebot11_set_title');
  };
});
