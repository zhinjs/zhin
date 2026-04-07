/**
 * 钉钉适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type IGroupManagement } from "zhin.js";
import type { McpToolRegistry } from "@zhin.js/mcp";
import { registerGroupManagementMcpTools } from "@zhin.js/mcp/adapter-tools-helper";
import { DingTalkAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    dingtalk: DingTalkAdapter;
  }
}

export * from "./types.js";
export { DingTalkBot } from "./bot.js";
export { DingTalkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext("router", (router: any) => {
  provide({
    name: "dingtalk",
    description: "DingTalk Bot Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new DingTalkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: DingTalkAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('mcp', 'dingtalk', (mcp: McpToolRegistry, dingtalk: DingTalkAdapter) => {
  const disposeGroup = registerGroupManagementMcpTools(
    mcp,
    dingtalk,
    'dingtalk',
  );

  mcp.addTool({
    name: 'dingtalk_get_user',
    description: '获取钉钉用户信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['bot', 'user_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      return await bot.getUserInfo(args.user_id);
    },
  });

  mcp.addTool({
    name: 'dingtalk_get_dept_users',
    description: '获取钉钉部门用户列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        dept_id: { type: 'string', description: '部门 ID' },
      },
      required: ['bot', 'dept_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const users = await bot.getDepartmentUsers(args.dept_id);
      return { users, count: users.length };
    },
  });

  mcp.addTool({
    name: 'dingtalk_list_departments',
    description: '获取钉钉部门列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        dept_id: { type: 'string', description: '父部门 ID，默认 1（根部门）' },
      },
      required: ['bot'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const departments = await bot.getDepartmentList(args.dept_id || '1');
      return { departments, count: departments.length };
    },
  });

  mcp.addTool({
    name: 'dingtalk_send_work_notice',
    description: '向指定用户发送钉钉工作通知',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        user_ids: { type: 'string', description: '用户 ID 列表，逗号分隔' },
        content: { type: 'string', description: '通知内容' },
      },
      required: ['bot', 'user_ids', 'content'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const msgContent = { msgtype: 'text', text: { content: args.content } };
      const success = await bot.sendWorkNotice(args.user_ids.split(','), msgContent);
      return { success, message: success ? '工作通知已发送' : '发送失败' };
    },
  });

  mcp.addTool({
    name: 'dingtalk_create_chat',
    description: '创建钉钉群聊',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        name: { type: 'string', description: '群名' },
        owner: { type: 'string', description: '群主用户 ID' },
        members: { type: 'string', description: '成员用户 ID 列表，逗号分隔' },
      },
      required: ['bot', 'name', 'owner', 'members'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const chatId = await bot.createChat(args.name, args.owner, args.members.split(','));
      return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
    },
  });

  mcp.addTool({
    name: 'dingtalk_add_chat_members',
    description: '向钉钉群聊添加成员',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '要添加的用户 ID 列表，逗号分隔' },
      },
      required: ['bot', 'chat_id', 'user_ids'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.updateChat(args.chat_id, { add_useridlist: args.user_ids.split(',') });
      return { success, message: success ? '成员添加成功' : '添加失败' };
    },
  });

  mcp.addTool({
    name: 'dingtalk_dept_info',
    description: '获取钉钉部门详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        dept_id: { type: 'string', description: '部门 ID' },
      },
      required: ['bot', 'dept_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      return await bot.getDepartmentInfo(Number(args.dept_id));
    },
  });

  mcp.addTool({
    name: 'dingtalk_update_chat',
    description: '更新钉钉群聊设置（改名、换群主、增减成员）',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        chat_id: { type: 'string', description: '群聊 ID' },
        name: { type: 'string', description: '新群名（可选）' },
        owner: { type: 'string', description: '新群主 userId（可选）' },
        add_members: { type: 'string', description: '要添加的成员 userId，逗号分隔（可选）' },
        remove_members: { type: 'string', description: '要移除的成员 userId，逗号分隔（可选）' },
      },
      required: ['bot', 'chat_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = dingtalk.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const options: any = {};
      if (args.name) options.name = args.name;
      if (args.owner) options.owner = args.owner;
      if (args.add_members) options.add_useridlist = args.add_members.split(',').map((s: string) => s.trim());
      if (args.remove_members) options.del_useridlist = args.remove_members.split(',').map((s: string) => s.trim());
      await bot.updateChat(args.chat_id, options);
      return { success: true, message: '群聊设置已更新' };
    },
  });

  return () => {
    disposeGroup();
  };
});
