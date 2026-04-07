/**
 * 飞书/Lark 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { LarkAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    lark: LarkAdapter;
  }
}

export * from "./types.js";
export { LarkBot } from "./bot.js";
export { LarkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

(useContext as (key: string, fn: (router: any) => void) => void)("router", (router) => {
  provide({
    name: "lark",
    description: "Lark/Feishu Bot Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new LarkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LarkAdapter) => {
      await adapter.stop();
    },
  } as Context<"lark">);
});

useContext('tool', 'lark', (toolService: ToolFeature, lark: LarkAdapter) => {
  const groupTools = createGroupManagementTools(
    lark as unknown as IGroupManagement,
    'lark',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_get_user',
    description: '获取飞书用户信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        user_id: { type: 'string', description: '用户 ID (open_id)' },
      },
      required: ['bot', 'user_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      return await bot.getUserInfo(args.user_id);
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_create_chat',
    description: '创建飞书群聊',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        name: { type: 'string', description: '群名' },
        members: { type: 'string', description: '成员 open_id 列表，逗号分隔' },
        owner: { type: 'string', description: '群主 open_id（可选）' },
      },
      required: ['bot', 'name', 'members'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const chatId = await bot.createChat(args.name, args.members.split(','), args.owner);
      return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_update_chat',
    description: '更新飞书群聊信息（群名、描述）',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        name: { type: 'string', description: '新群名（可选）' },
        description: { type: 'string', description: '新描述（可选）' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.updateChatInfo(args.chat_id, { name: args.name, description: args.description });
      return { success, message: success ? '群信息更新成功' : '更新失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_add_members',
    description: '添加飞书群成员',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['bot', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.addChatMembers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '成员添加成功' : '添加失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_set_managers',
    description: '设置飞书群管理员',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['bot', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.setChatManagers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '管理员设置成功' : '设置失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_remove_managers',
    description: '移除飞书群管理员',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['bot', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.removeChatManagers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '管理员移除成功' : '移除失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_dissolve_chat',
    description: '解散飞书群聊（需要群主权限）',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
      },
      required: ['bot', 'chat_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.dissolveChat(args.chat_id);
      return { success, message: success ? '群聊已解散' : '解散失败' };
    },
  }, 'lark'));

  disposers.push(toolService.addTool({
    name: 'lark_upload_file',
    description: '上传文件到飞书（opus/mp4/pdf/doc/xls/ppt/stream）',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        file_path: { type: 'string', description: '本地文件路径' },
        file_type: { type: 'string', description: '文件类型', enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'] },
      },
      required: ['bot', 'file_path', 'file_type'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const validTypes = ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'];
      if (!validTypes.includes(args.file_type)) {
        throw new Error(`不支持的文件类型: ${args.file_type}，支持: ${validTypes.join(', ')}`);
      }
      const bot = lark.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const result = await bot.uploadFile(args.file_path, args.file_type);
      return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
    },
  }, 'lark'));

  return () => disposers.forEach(d => d());
});
