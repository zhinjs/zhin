/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type IGroupManagement } from "zhin.js";
import type { McpToolRegistry } from "@zhin.js/mcp";
import { registerGroupManagementMcpTools } from "@zhin.js/mcp/adapter-tools-helper";
import { QQAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

export * from "./types.js";
export { QQBot } from "./bot.js";
export { QQAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: QQAdapter) => {
    await adapter.stop();
  },
});

useContext('mcp' as any, 'qq', (mcp: McpToolRegistry, qq: QQAdapter) => {
  const disposeGroup = registerGroupManagementMcpTools(
    mcp,
    qq as unknown as IGroupManagement & { bots: Map<string, any> },
    'qq',
  );

  // 获取频道列表
  mcp.addTool({
    name: 'qq_list_guilds',
    description: '获取 QQ 频道列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
      },
      required: ['bot'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const guilds = await bot.getGuilds();
      return { guilds, count: guilds.length };
    },
  });

  // 获取子频道列表
  mcp.addTool({
    name: 'qq_list_channels',
    description: '获取 QQ 频道下的子频道列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const channels = await bot.getChannels(args.guild_id);
      return { channels, count: channels.length };
    },
  });

  // 获取角色列表
  mcp.addTool({
    name: 'qq_list_roles',
    description: '获取 QQ 频道角色列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const roles = await bot.getGuildRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  });

  // 创建角色
  mcp.addTool({
    name: 'qq_create_role',
    description: '创建 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        name: { type: 'string', description: '角色名称' },
        color: { type: 'number', description: '颜色（RGB 十进制数值）' },
      },
      required: ['bot', 'guild_id', 'name'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const role = await bot.createGuildRole(args.guild_id, args.name, args.color);
      return { success: !!role, role, message: role ? `角色 "${args.name}" 创建成功` : '创建失败' };
    },
  });

  // 添加角色
  mcp.addTool({
    name: 'qq_add_role',
    description: '给成员添加 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.addMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已给成员添加角色' : '操作失败' };
    },
  });

  // 移除角色
  mcp.addTool({
    name: 'qq_remove_role',
    description: '移除成员的 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.removeMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已移除成员的角色' : '操作失败' };
    },
  });

  // 子频道详情
  mcp.addTool({
    name: 'qq_channel_info',
    description: '获取 QQ 频道中指定子频道的详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '子频道 ID' },
      },
      required: ['bot', 'channel_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const info = await bot.getChannelInfo(args.channel_id);
      return info;
    },
  });

  // 单成员详情
  mcp.addTool({
    name: 'qq_member_detail',
    description: '获取 QQ 频道中指定成员的详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['bot', 'guild_id', 'user_id'],
    },
    handler: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const member = await bot.getGuildMember(args.guild_id, args.user_id);
      return member;
    },
  });

  return () => {
    disposeGroup();
    mcp.removeTool('qq_list_guilds');
    mcp.removeTool('qq_list_channels');
    mcp.removeTool('qq_list_roles');
    mcp.removeTool('qq_create_role');
    mcp.removeTool('qq_add_role');
    mcp.removeTool('qq_remove_role');
    mcp.removeTool('qq_channel_info');
    mcp.removeTool('qq_member_detail');
  };
});
