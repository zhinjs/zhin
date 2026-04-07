/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
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

useContext('tool', 'qq', (toolService: ToolFeature, qq: QQAdapter) => {
  const groupTools = createGroupManagementTools(
    qq as unknown as IGroupManagement,
    'qq',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, 'qq'));

  // 获取频道列表
  disposers.push(toolService.addTool({
    name: 'qq_list_guilds',
    description: '获取 QQ 频道列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
      },
      required: ['bot'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const guilds = await bot.getGuilds();
      return { guilds, count: guilds.length };
    },
  }, 'qq'));

  // 获取子频道列表
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const channels = await bot.getChannels(args.guild_id);
      return { channels, count: channels.length };
    },
  }, 'qq'));

  // 获取角色列表
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const roles = await bot.getGuildRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  }, 'qq'));

  // 创建角色
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const role = await bot.createGuildRole(args.guild_id, args.name, args.color);
      return { success: !!role, role, message: role ? `角色 "${args.name}" 创建成功` : '创建失败' };
    },
  }, 'qq'));

  // 添加角色
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.addMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已给成员添加角色' : '操作失败' };
    },
  }, 'qq'));

  // 移除角色
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.removeMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已移除成员的角色' : '操作失败' };
    },
  }, 'qq'));

  // 子频道详情
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const info = await bot.getChannelInfo(args.channel_id);
      return info;
    },
  }, 'qq'));

  // 单成员详情
  disposers.push(toolService.addTool({
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
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const bot = qq.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const member = await bot.getGuildMember(args.guild_id, args.user_id);
      return member;
    },
  }, 'qq'));

  return () => disposers.forEach(d => d());
});
